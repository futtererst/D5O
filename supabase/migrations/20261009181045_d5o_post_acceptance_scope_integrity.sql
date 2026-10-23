-- Whole-work acceptance freezes the exact package set. Historical expanded
-- records remain untouched, but their old receipt cannot govern new scope.
create function d5o_hosted.current_work_acceptance_scope_v1(
  p_workspace uuid, p_work uuid, p_acceptance jsonb,
  p_require_receipts boolean
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_design jsonb; v_deploy jsonb; v_catalog jsonb; v_presentation text;
  v_package text; v_detail jsonb; v_release jsonb; v_turnover jsonb;
  v_ids text[] := array[]::text[]; v_count integer := 0;
begin
  if p_acceptance is null or p_acceptance->>'id' is null
    or pg_catalog.jsonb_typeof(p_acceptance->'releaseIds') <> 'array'
    or pg_catalog.jsonb_typeof(p_acceptance->'turnoverIds') <> 'array' then
    return false;
  end if;
  select state into v_design from d5o_hosted.connected_design_states
    where workspace_id=p_workspace and work_id=p_work;
  select state into v_deploy from d5o_hosted.connected_deploy_states
    where workspace_id=p_workspace and work_id=p_work;
  select presentation_id into v_presentation from d5o_hosted.work_identity_links
    where workspace_id=p_workspace and work_id=p_work limit 1;
  select state_json into v_catalog from d5o_hosted.prototype_states
    where workspace_id=p_workspace and state_key='catalog';
  if v_design is null or v_deploy is null or v_presentation is null then return false; end if;

  for v_package in
    select id from (
      select package_id as id from d5o_hosted.connected_package_states
        where workspace_id=p_workspace and work_id=p_work
      union
      select item->>'id' from pg_catalog.jsonb_array_elements(
        coalesce(v_catalog->'packages','[]'::jsonb)) item
        where item->>'workId'=v_presentation
    ) packages where id is not null
  loop
    v_count := v_count + 1;
    v_ids := pg_catalog.array_append(v_ids,v_package);
    select item into v_detail from pg_catalog.jsonb_array_elements(
      coalesce(v_design->'packages','[]'::jsonb)) item
      where item->>'packageId'=v_package;
    select item into v_release from pg_catalog.jsonb_array_elements(
      coalesce(v_design->'releases','[]'::jsonb)) item
      where item->>'packageId'=v_package
      order by item->>'issuedAt' desc limit 1;
    select item into v_turnover from pg_catalog.jsonb_array_elements(
      coalesce(v_deploy->'turnovers','[]'::jsonb)) item
      where item->>'packageId'=v_package and item->>'status'='Client accepted'
        and item->'releaseIds' ? (v_release->>'id')
        and p_acceptance->'turnoverIds' ? (item->>'id')
      order by item->>'acceptedAt' desc limit 1;
    if v_detail is null or v_release is null or v_turnover is null
      or v_release->>'status'<>'Accepted'
      or v_release->>'packageRevision' is distinct from v_detail->>'revision'
      or not (p_acceptance->'releaseIds' ? (v_release->>'id'))
      or (p_require_receipts and v_turnover->>'receipt'<>'Accepted') then return false; end if;
  end loop;
  if v_count=0 or v_count<>pg_catalog.jsonb_array_length(p_acceptance->'releaseIds')
    or v_count<>pg_catalog.jsonb_array_length(p_acceptance->'turnoverIds')
    or v_count<>(select count(*) from pg_catalog.jsonb_array_elements(
      coalesce(v_design->'packages','[]'::jsonb)) item) then return false; end if;
  return true;
end; $$;
revoke all on function d5o_hosted.current_work_acceptance_scope_v1(uuid,uuid,jsonb,boolean)
  from public,anon,authenticated,service_role;

create function d5o_hosted.freeze_accepted_package_set_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_workspace uuid; v_work uuid; v_acceptance jsonb;
begin
  if tg_op='UPDATE' and (old.workspace_id,old.work_id,old.package_id)
    is distinct from (new.workspace_id,new.work_id,new.package_id) then
    raise exception 'connected_package_identity_immutable' using errcode='23514';
  end if;
  v_workspace:=coalesce(new.workspace_id,old.workspace_id);
  v_work:=coalesce(new.work_id,old.work_id);
  -- The same Work row is locked by package, acceptance and Finance commands.
  perform 1 from d5o_hosted.work_records where id=v_work and workspace_id=v_workspace for update;
  select state->'workAcceptance' into v_acceptance
    from d5o_hosted.connected_deploy_states
    where workspace_id=v_workspace and work_id=v_work;
  if v_acceptance is not null then
    raise exception 'post_acceptance_package_set_frozen' using errcode='23514';
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;
revoke all on function d5o_hosted.freeze_accepted_package_set_v1()
  from public,anon,authenticated,service_role;
create trigger d5o_freeze_accepted_package_set
  before insert or update or delete on d5o_hosted.connected_package_states
  for each row execute function d5o_hosted.freeze_accepted_package_set_v1();

create function d5o_hosted.check_work_receipt_scope_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.state->'workAcceptance' is not null
    and (tg_op='INSERT' or old.state->'workAcceptance' is null)
    and not d5o_hosted.current_work_acceptance_scope_v1(
      new.workspace_id,new.work_id,new.state->'workAcceptance',false) then
    raise exception 'work_acceptance_scope_changed' using errcode='23514';
  end if;
  if new.state#>>'{workAcceptance,receipt}'='Accepted'
    and (tg_op='INSERT' or old.state#>>'{workAcceptance,receipt}' is distinct from 'Accepted')
    and not d5o_hosted.current_work_acceptance_scope_v1(
      new.workspace_id,new.work_id,new.state->'workAcceptance',true) then
    raise exception 'work_acceptance_scope_changed' using errcode='23514';
  end if;
  return new;
end; $$;
revoke all on function d5o_hosted.check_work_receipt_scope_v1()
  from public,anon,authenticated,service_role;
create trigger d5o_check_work_receipt_scope
  before insert or update on d5o_hosted.connected_deploy_states
  for each row execute function d5o_hosted.check_work_receipt_scope_v1();

create function d5o_hosted.check_finance_acceptance_scope_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_acceptance jsonb;
begin
  if new.state#>>'{source,kind}'='Accepted Deploy'
    and new.state#>>'{source,workAcceptanceId}' is not null
    and (tg_op='INSERT' or new.state->'source' is distinct from old.state->'source'
      or (new.state#>>'{activation,status}'='Active' and
        old.state#>>'{activation,status}' is distinct from 'Active')) then
    select state->'workAcceptance' into v_acceptance
      from d5o_hosted.connected_deploy_states
      where workspace_id=new.workspace_id and work_id=new.work_id;
    if v_acceptance->>'receipt' is distinct from 'Accepted'
      or v_acceptance->>'id' is distinct from new.state#>>'{source,workAcceptanceId}'
      or not d5o_hosted.current_work_acceptance_scope_v1(
        new.workspace_id,new.work_id,v_acceptance,true) then
      raise exception 'work_acceptance_scope_changed' using errcode='23514';
    end if;
  end if;
  if new.state#>>'{finance,status}'='Closed'
    and (tg_op='INSERT' or new.state->'finance' is distinct from old.state->'finance') then
    select state->'workAcceptance' into v_acceptance
      from d5o_hosted.connected_deploy_states
      where workspace_id=new.workspace_id and work_id=new.work_id;
    if v_acceptance->>'receipt' is distinct from 'Accepted'
      or not d5o_hosted.current_work_acceptance_scope_v1(
        new.workspace_id,new.work_id,v_acceptance,true) then
      raise exception 'work_acceptance_scope_changed' using errcode='23514';
    end if;
  end if;
  return new;
end; $$;
revoke all on function d5o_hosted.check_finance_acceptance_scope_v1()
  from public,anon,authenticated,service_role;
create trigger d5o_check_finance_acceptance_scope
  before insert or update on d5o_hosted.connected_operate_states
  for each row execute function d5o_hosted.check_finance_acceptance_scope_v1();
