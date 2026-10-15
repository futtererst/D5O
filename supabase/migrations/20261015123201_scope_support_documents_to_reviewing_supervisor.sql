-- A field-supervisor membership alone does not confer custody responsibility
-- for every accepted turnover in the tenant. For this bounded prototype the
-- independently reviewed report on the exact package/release is the retained
-- supplier relationship. Project managers keep their existing preparation path.
create function d5o_hosted.support_document_supervisor_scope_v1(
  p_workspace_key text,p_presentation_id text,p_turnover_id text,
  p_kind text,p_actor uuid
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_workspace uuid;v_work uuid;v_basis jsonb;v_allowed boolean;
begin
  if p_actor is null then return false; end if;
  select w.id,l.work_id into v_workspace,v_work
    from d5o_hosted.workspaces w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and l.presentation_id=p_presentation_id;
  if v_work is null then return false; end if;
  v_basis:=d5o_hosted.support_document_basis_v1(
    v_workspace,v_work,p_turnover_id,p_kind);
  if v_basis is null then return false; end if;
  select exists (
    select 1 from d5o_hosted.connected_deploy_states d,
      pg_catalog.jsonb_array_elements(coalesce(d.state->'reports','[]'::jsonb)) r
    where d.workspace_id=v_workspace and d.work_id=v_work
      and r->>'packageId'=v_basis->>'packageId'
      and r->>'releaseId'=v_basis->>'releaseId'
      and r->>'status'='Reviewed'
      and r->>'reviewerId'=p_actor::text
  ) into v_allowed;
  return coalesce(v_allowed,false);
end; $$;
revoke all on function d5o_hosted.support_document_supervisor_scope_v1(
  text,text,text,text,uuid) from public,anon,authenticated,service_role;

-- Enforce the same supplier relation before the service-only custody writer
-- registers a private object and before the authenticated submission command
-- can change the exact Operate obligation. Their original typed checks remain.
alter function public.d5o_hosted_register_support_document_v1(
  text,text,uuid,text,text,jsonb,text,text,uuid)
  rename to d5o_hosted_register_support_document_internal_v1;
revoke all on function public.d5o_hosted_register_support_document_internal_v1(
  text,text,uuid,text,text,jsonb,text,text,uuid)
  from public,anon,authenticated,service_role;
create function public.d5o_hosted_register_support_document_v1(
  p_workspace_key text,p_presentation_id text,p_evidence_id uuid,
  p_turnover_id text,p_kind text,p_basis jsonb,p_checksum_sha256 text,
  p_filename text,p_uploader_id uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_role text;
begin
  if current_setting('role',true)<>'service_role' then
    raise exception 'support_document_supplier_required' using errcode='42501'; end if;
  select m.role into v_role from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=p_uploader_id and m.status='active';
  if v_role='field_supervisor' and not
    d5o_hosted.support_document_supervisor_scope_v1(
      p_workspace_key,p_presentation_id,p_turnover_id,p_kind,p_uploader_id) then
    raise exception 'support_document_package_assignment_required'
      using errcode='42501'; end if;
  return public.d5o_hosted_register_support_document_internal_v1(
    p_workspace_key,p_presentation_id,p_evidence_id,p_turnover_id,p_kind,
    p_basis,p_checksum_sha256,p_filename,p_uploader_id);
end; $$;
revoke all on function public.d5o_hosted_register_support_document_v1(
  text,text,uuid,text,text,jsonb,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_register_support_document_v1(
  text,text,uuid,text,text,jsonb,text,text,uuid) to service_role;

alter function public.d5o_hosted_support_document_command_v1(
  text,text,text,text,text,uuid,text,text,text,bigint,integer,integer)
  rename to d5o_hosted_support_document_command_internal_v1;
revoke all on function public.d5o_hosted_support_document_command_internal_v1(
  text,text,text,text,text,uuid,text,text,text,bigint,integer,integer)
  from public,anon,authenticated,service_role;
create function public.d5o_hosted_support_document_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,
  p_turnover_id text,p_kind text,p_evidence_id uuid,p_decision text,
  p_note text,p_command_id text,p_expected_source_revision bigint,
  p_expected_deploy_revision integer,p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_role text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'support_document_membership_required' using errcode='42501'; end if;
  if p_action='submit' then
    select m.role into v_role from d5o_hosted.workspaces w
      join d5o_hosted.memberships m on m.workspace_id=w.id
      where w.workspace_key=p_workspace_key and w.status='active'
        and m.actor_user_id=v_actor and m.status='active';
    if v_role='field_supervisor' and not
      d5o_hosted.support_document_supervisor_scope_v1(
        p_workspace_key,p_presentation_id,p_turnover_id,p_kind,v_actor) then
      raise exception 'support_document_package_assignment_required'
        using errcode='42501'; end if;
  end if;
  return public.d5o_hosted_support_document_command_internal_v1(
    p_workspace_key,p_presentation_id,p_action,p_turnover_id,p_kind,
    p_evidence_id,p_decision,p_note,p_command_id,p_expected_source_revision,
    p_expected_deploy_revision,p_expected_operate_revision);
end; $$;
revoke all on function public.d5o_hosted_support_document_command_v1(
  text,text,text,text,text,uuid,text,text,text,bigint,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_support_document_command_v1(
  text,text,text,text,text,uuid,text,text,text,bigint,integer,integer)
  to authenticated;

-- The ordinary authenticated Work read is directly callable. Redact other
-- suppliers' support-document metadata there, not only in a React component.
alter function public.d5o_hosted_prototype_read_v1(text,text)
  rename to d5o_hosted_prototype_read_internal_v1;
revoke all on function public.d5o_hosted_prototype_read_internal_v1(text,text)
  from public,anon,authenticated,service_role;
create function public.d5o_hosted_prototype_read_v1(
  p_workspace_key text,p_state_key text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_role text;v_result jsonb;v_records jsonb:='[]'::jsonb;
  v_record jsonb;v_docs jsonb;v_packages jsonb;v_work uuid;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'prototype_scope_forbidden' using errcode='42501'; end if;
  v_result:=public.d5o_hosted_prototype_read_internal_v1(
    p_workspace_key,p_state_key);
  if p_state_key<>'work' or v_result#>'{state,records}' is null then
    return v_result; end if;
  select m.role into v_role from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=v_actor and m.status='active';
  if v_role<>'field_supervisor' then return v_result; end if;
  for v_record in select value from pg_catalog.jsonb_array_elements(
    v_result#>'{state,records}') loop
    if pg_catalog.jsonb_typeof(v_record#>'{operate,documentationObligations}')='array' then
      select coalesce(pg_catalog.jsonb_agg(
        case when d->>'uploadedByActorId'=v_actor::text then d
          else pg_catalog.jsonb_build_object(
            'id','','turnoverId',d->>'turnoverId','kind',d->>'kind',
            'basis',d->'basis','status',d->>'status','restricted',true)
        end order by n),'[]'::jsonb)
        into v_docs from pg_catalog.jsonb_array_elements(
          v_record#>'{operate,documentationObligations}')
          with ordinality as entries(d,n);
      v_record:=pg_catalog.jsonb_set(v_record,
        '{operate,documentationObligations}',v_docs);
    end if;
    select l.work_id into v_work from d5o_hosted.work_identity_links l
      join d5o_hosted.workspaces w on w.id=l.workspace_id
      where w.workspace_key=p_workspace_key and w.status='active'
        and l.presentation_id=v_record->>'id';
    select coalesce(pg_catalog.jsonb_agg(distinct r->>'packageId'),
      '[]'::jsonb) into v_packages
      from d5o_hosted.connected_deploy_states s,
        pg_catalog.jsonb_array_elements(coalesce(s.state->'reports','[]'::jsonb)) r
      where s.work_id=v_work and r->>'status'='Reviewed'
        and r->>'reviewerId'=v_actor::text;
    v_records:=v_records||pg_catalog.jsonb_build_array(
      v_record||pg_catalog.jsonb_build_object(
        'supportDocumentSupplierPackageIds',coalesce(v_packages,'[]'::jsonb)));
  end loop;
  return pg_catalog.jsonb_set(v_result,'{state,records}',v_records);
end; $$;
revoke all on function public.d5o_hosted_prototype_read_v1(text,text)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_prototype_read_v1(text,text)
  to authenticated;

-- Command replay receipts can contain a past Work projection. Apply the same
-- redaction to the receipt result without changing its recorded revision.
create function d5o_hosted.redact_support_document_read_v1(
  p_workspace_key text,p_actor uuid,p_result jsonb
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_role text;v_records jsonb:='[]'::jsonb;v_record jsonb;
  v_docs jsonb;v_packages jsonb;v_work uuid;
begin
  if p_actor is null or p_result#>'{state,records}' is null then
    return p_result; end if;
  select m.role into v_role from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=p_actor and m.status='active';
  if v_role<>'field_supervisor' then return p_result; end if;
  for v_record in select value from pg_catalog.jsonb_array_elements(
    p_result#>'{state,records}') loop
    if pg_catalog.jsonb_typeof(v_record#>'{operate,documentationObligations}')='array' then
      select coalesce(pg_catalog.jsonb_agg(
        case when d->>'uploadedByActorId'=p_actor::text then d
          else pg_catalog.jsonb_build_object(
            'id','','turnoverId',d->>'turnoverId','kind',d->>'kind',
            'basis',d->'basis','status',d->>'status','restricted',true)
        end order by n),'[]'::jsonb)
        into v_docs from pg_catalog.jsonb_array_elements(
          v_record#>'{operate,documentationObligations}')
          with ordinality as entries(d,n);
      v_record:=pg_catalog.jsonb_set(v_record,
        '{operate,documentationObligations}',v_docs);
    end if;
    select l.work_id into v_work from d5o_hosted.work_identity_links l
      join d5o_hosted.workspaces w on w.id=l.workspace_id
      where w.workspace_key=p_workspace_key and w.status='active'
        and l.presentation_id=v_record->>'id';
    select coalesce(pg_catalog.jsonb_agg(distinct r->>'packageId'),
      '[]'::jsonb) into v_packages
      from d5o_hosted.connected_deploy_states s,
        pg_catalog.jsonb_array_elements(coalesce(s.state->'reports','[]'::jsonb)) r
      where s.work_id=v_work and r->>'status'='Reviewed'
        and r->>'reviewerId'=p_actor::text;
    v_records:=v_records||pg_catalog.jsonb_build_array(
      v_record||pg_catalog.jsonb_build_object(
        'supportDocumentSupplierPackageIds',coalesce(v_packages,'[]'::jsonb)));
  end loop;
  return pg_catalog.jsonb_set(p_result,'{state,records}',v_records);
end; $$;
revoke all on function d5o_hosted.redact_support_document_read_v1(
  text,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.d5o_hosted_prototype_read_v1(
  p_workspace_key text,p_state_key text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_result jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'prototype_scope_forbidden' using errcode='42501'; end if;
  v_result:=public.d5o_hosted_prototype_read_internal_v1(
    p_workspace_key,p_state_key);
  if p_state_key<>'work' then return v_result; end if;
  return d5o_hosted.redact_support_document_read_v1(
    p_workspace_key,v_actor,v_result);
end; $$;

create or replace function public.d5o_hosted_support_document_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,
  p_turnover_id text,p_kind text,p_evidence_id uuid,p_decision text,
  p_note text,p_command_id text,p_expected_source_revision bigint,
  p_expected_deploy_revision integer,p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_role text;v_result jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'support_document_membership_required' using errcode='42501'; end if;
  if p_action='submit' then
    select m.role into v_role from d5o_hosted.workspaces w
      join d5o_hosted.memberships m on m.workspace_id=w.id
      where w.workspace_key=p_workspace_key and w.status='active'
        and m.actor_user_id=v_actor and m.status='active';
    if v_role='field_supervisor' and not
      d5o_hosted.support_document_supervisor_scope_v1(
        p_workspace_key,p_presentation_id,p_turnover_id,p_kind,v_actor) then
      raise exception 'support_document_package_assignment_required'
        using errcode='42501'; end if;
  end if;
  v_result:=public.d5o_hosted_support_document_command_internal_v1(
    p_workspace_key,p_presentation_id,p_action,p_turnover_id,p_kind,
    p_evidence_id,p_decision,p_note,p_command_id,p_expected_source_revision,
    p_expected_deploy_revision,p_expected_operate_revision);
  return d5o_hosted.redact_support_document_read_v1(
    p_workspace_key,v_actor,v_result);
end; $$;
