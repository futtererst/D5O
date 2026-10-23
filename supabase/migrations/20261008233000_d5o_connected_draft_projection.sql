-- A member reads controlled decisions as a projection over the draft snapshot.
-- On an ordinary draft save, compare the submitted protected fields to that
-- exact current projection, then retain the raw protected fields. This does
-- not authorize or persist a decision supplied by the browser. The existing
-- snapshot trigger remains active and checks the resulting raw draft.
create function d5o_hosted.connected_draft_snapshot_v1(
  p_workspace uuid, p_raw jsonb, p_submitted jsonb, p_next_revision bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_old jsonb; v_new jsonb; v_expected jsonb; v_rebased jsonb;
  v_records jsonb := '[]'::jsonb; v_link record; v_pursuit record; v_define record;
begin
  if pg_catalog.jsonb_typeof(p_raw->'records') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_submitted->'records') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_raw->'records') <>
       pg_catalog.jsonb_array_length(p_submitted->'records') then
    raise exception 'draft_record_set_changed' using errcode='42501'; end if;
  for v_new in select value from pg_catalog.jsonb_array_elements(p_submitted->'records') loop
    select value into v_old from pg_catalog.jsonb_array_elements(p_raw->'records')
      where value->>'id'=v_new->>'id';
    if v_old is null then raise exception 'draft_record_set_changed' using errcode='42501'; end if;
    v_expected:=coalesce(d5o_hosted.connected_pursuit_record_v1(p_workspace,v_old),v_old);
    select p.projection,p.fit,p.next_action into v_pursuit
      from d5o_hosted.work_identity_links l
      join d5o_hosted.connected_pursuit_states p on p.workspace_id=l.workspace_id
        and p.work_id=l.work_id
      where l.workspace_id=p_workspace and l.presentation_id=v_old->>'id';
    select d.projection,d.next_action into v_define
      from d5o_hosted.work_identity_links l
      join d5o_hosted.connected_define_states d on d.workspace_id=l.workspace_id
        and d.work_id=l.work_id
      where l.workspace_id=p_workspace and l.presentation_id=v_old->>'id';
    if v_define.projection is not null then
      v_expected:=v_expected||pg_catalog.jsonb_build_object(
        'definition',v_define.projection,'nextAction',v_define.next_action);
    end if;
    if d5o_hosted.protected_work_record_v1(v_new) is distinct from
       d5o_hosted.protected_work_record_v1(v_expected)
      or ((v_pursuit.projection is not null or v_define.projection is not null)
        and v_new->>'nextAction' is distinct from v_expected->>'nextAction') then
      raise exception 'typed_command_required' using errcode='42501'; end if;
    if v_define.projection->>'status'='Draft'
      and (v_define.projection->>'revision')::integer >
        coalesce((v_old#>>'{definition,revision}')::integer,0) then
      if v_new#>>'{definition,status}'<>'Draft'
        or v_new#>>'{definition,revision}'<>v_define.projection->>'revision'
        or pg_catalog.jsonb_typeof(v_new#>'{definition,history}')<>'array'
        or pg_catalog.jsonb_array_length(v_new#>'{definition,history}') <
          pg_catalog.jsonb_array_length(coalesce(v_define.projection->'history','[]'::jsonb))
        or (select coalesce(pg_catalog.jsonb_agg(item order by ordinal),'[]'::jsonb)
          from pg_catalog.jsonb_array_elements(v_new#>'{definition,history}')
            with ordinality as prior(item,ordinal)
          where ordinal <= pg_catalog.jsonb_array_length(
            coalesce(v_define.projection->'history','[]'::jsonb)))
          is distinct from coalesce(v_define.projection->'history','[]'::jsonb) then
        raise exception 'define_draft_history_changed' using errcode='42501'; end if;
      update d5o_hosted.connected_define_states set
        projection=v_new->'definition',source_digest=pg_catalog.md5((v_new->'definition')::text),
        source_revision=p_next_revision,updated_at=now()
        where workspace_id=p_workspace and work_id=(
          select work_id from d5o_hosted.work_identity_links
          where workspace_id=p_workspace and presentation_id=v_old->>'id')
          and status='Draft';
    end if;
    v_rebased:=v_new;
    if v_pursuit.projection is not null then
      v_rebased:=pg_catalog.jsonb_set(v_rebased,'{discovery,pursuitControl}',
        v_old#>'{discovery,pursuitControl}');
      v_rebased:=pg_catalog.jsonb_set(v_rebased,'{discovery,fit}',
        v_old#>'{discovery,fit}');
    end if;
    if v_define.projection is not null then
      v_rebased:=v_rebased||pg_catalog.jsonb_build_object('definition',v_old->'definition');
    end if;
    if v_pursuit.projection is not null or v_define.projection is not null then
      v_rebased:=v_rebased||pg_catalog.jsonb_build_object('nextAction',v_old->'nextAction');
    end if;
    v_records:=v_records||pg_catalog.jsonb_build_array(v_rebased);
  end loop;
  return pg_catalog.jsonb_set(p_submitted,'{records}',v_records);
end; $$;
revoke all on function d5o_hosted.connected_draft_snapshot_v1(uuid,jsonb,jsonb,bigint)
  from public,anon,authenticated,service_role;

create or replace function public.d5o_hosted_prototype_save_v1(
  p_workspace_key text,p_state_key text,p_expected_revision bigint,p_state jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_workspace uuid; v_membership d5o_hosted.memberships%rowtype;
  v_prior d5o_hosted.prototype_states%rowtype; v_state jsonb; v_revision bigint;
begin
  if auth.uid() is null or p_state_key is distinct from 'work'
    or p_expected_revision is null or p_expected_revision < 1 or p_state is null
    or pg_catalog.jsonb_typeof(p_state) <> 'object'
    or p_state->>'workspace' is distinct from p_workspace_key
    or p_state->>'schemaVersion' is distinct from '1'
    or pg_catalog.octet_length(p_state::text)>2000000 then
    raise exception 'invalid_prototype_state' using errcode='22023'; end if;
  select m.* into v_membership from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=auth.uid() and m.status='active';
  v_workspace:=v_membership.workspace_id;
  if v_workspace is null or v_membership.role not in
    ('admin','operations_leader','project_manager','field_supervisor') then
    raise exception 'prototype_write_forbidden' using errcode='42501'; end if;
  select * into v_prior from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key='work' for update;
  if not found or v_prior.revision<>p_expected_revision then
    raise exception 'stale_prototype_state' using errcode='23505'; end if;
  v_state:=d5o_hosted.connected_draft_snapshot_v1(
    v_workspace,v_prior.state_json,p_state,v_prior.revision+1);
  update d5o_hosted.prototype_states set revision=revision+1,state_json=v_state,
    updated_by=auth.uid(),updated_at=now()
    where workspace_id=v_workspace and state_key='work'
    returning revision into v_revision;
  insert into d5o_hosted.prototype_state_revisions(
    workspace_id,state_key,revision,state_json,actor_user_id,membership_id)
    values(v_workspace,'work',v_revision,v_state,auth.uid(),v_membership.id);
  return pg_catalog.jsonb_build_object('revision',v_revision,'state',
    d5o_hosted.connected_define_projection_v1(v_workspace,v_state));
end; $$;
revoke all on function public.d5o_hosted_prototype_save_v1(text,text,bigint,jsonb)
  from public,anon;
grant execute on function public.d5o_hosted_prototype_save_v1(text,text,bigint,jsonb)
  to authenticated;
