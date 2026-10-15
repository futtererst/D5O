-- A reviewed field report is evidence of review, not an assignment to supply
-- post-delivery documents. Operations assigns a confirmed supervisor to the
-- exact accepted turnover. Previous assignments remain in the event trail.
create or replace function d5o_hosted.support_document_supervisor_scope_v1(
  p_workspace_key text,p_presentation_id text,p_turnover_id text,
  p_kind text,p_actor uuid
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_workspace uuid;v_work uuid;v_basis jsonb;v_assignment jsonb;
begin
  if p_actor is null then return false; end if;
  select w.id,l.work_id into v_workspace,v_work
    from d5o_hosted.workspaces w join d5o_hosted.work_identity_links l
      on l.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and l.presentation_id=p_presentation_id;
  if v_work is null then return false; end if;
  v_basis:=d5o_hosted.support_document_basis_v1(
    v_workspace,v_work,p_turnover_id,p_kind);
  if v_basis is null then return false; end if;
  select a into v_assignment from d5o_hosted.connected_operate_states s,
    pg_catalog.jsonb_array_elements(coalesce(s.state->'supportDocumentAssignments','[]'::jsonb))
      with ordinality as entries(a,n)
    where s.workspace_id=v_workspace and s.work_id=v_work
      and a->>'turnoverId'=p_turnover_id order by n desc limit 1;
  return coalesce(v_assignment->>'status'='Assigned'
    and v_assignment->>'actorId'=p_actor::text
    and v_assignment->>'packageId'=v_basis->>'packageId'
    and v_assignment->>'releaseId'=v_basis->>'releaseId',false);
end; $$;

create function public.d5o_hosted_assign_support_document_supplier_v1(
  p_workspace_key text,p_presentation_id text,p_turnover_id text,
  p_action text,p_supervisor_email text,p_reason text,p_command_id text,
  p_expected_source_revision bigint,p_expected_deploy_revision integer,
  p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_target d5o_hosted.memberships%rowtype;
  v_work d5o_hosted.work_records%rowtype;v_raw d5o_hosted.prototype_states%rowtype;
  v_deploy d5o_hosted.connected_deploy_states%rowtype;
  v_operate d5o_hosted.connected_operate_states%rowtype;
  v_receipt d5o_hosted.connected_operate_receipts%rowtype;
  v_basis jsonb;v_previous jsonb;v_entry jsonb;v_state jsonb;v_result jsonb;
  v_fingerprint text;v_email text:=pg_catalog.lower(pg_catalog.btrim(coalesce(p_supervisor_email,'')));
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'support_assignment_membership_required' using errcode='42501'; end if;
  if p_action not in ('assign','revoke') or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or length(pg_catalog.btrim(coalesce(p_reason,'')))<10
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_deploy_revision is null
    or p_expected_operate_revision is null then
    raise exception 'invalid_support_assignment' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role<>'operations_leader' then
    raise exception 'support_assignment_authority_required' using errcode='42501'; end if;
  select m.* into v_target from d5o_hosted.memberships m
    join auth.users u on u.id=m.actor_user_id
    where m.workspace_id=v_workspace.id and m.status='active'
      and m.role='field_supervisor' and pg_catalog.lower(u.email)=v_email for share of m;
  if not found then raise exception 'active_supervisor_account_required' using errcode='23514'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id and l.work_id=w.id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_presentation_id,p_turnover_id,p_action,v_email,
    pg_catalog.btrim(p_reason),p_expected_source_revision,p_expected_deploy_revision,
    p_expected_operate_revision)::text);
  select * into v_receipt from d5o_hosted.connected_operate_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_deploy from d5o_hosted.connected_deploy_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_operate from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_raw.revision is distinct from p_expected_source_revision
    or v_deploy.decision_revision is distinct from p_expected_deploy_revision
    or v_operate.decision_revision is distinct from p_expected_operate_revision then
    raise exception 'stale_support_assignment_basis' using errcode='23505'; end if;
  v_basis:=d5o_hosted.support_document_basis_v1(
    v_workspace.id,v_work.id,p_turnover_id,'as-built');
  if v_basis is null then v_basis:=d5o_hosted.support_document_basis_v1(
    v_workspace.id,v_work.id,p_turnover_id,'inspection'); end if;
  if v_basis is null then raise exception 'accepted_support_obligation_required' using errcode='23514'; end if;
  select a into v_previous from pg_catalog.jsonb_array_elements(
    coalesce(v_operate.state->'supportDocumentAssignments','[]'::jsonb))
    with ordinality as entries(a,n)
    where a->>'turnoverId'=p_turnover_id order by n desc limit 1;
  if p_action='revoke' and (v_previous is null or v_previous->>'status'<>'Assigned'
    or v_previous->>'actorId'<>v_target.actor_user_id::text) then
    raise exception 'current_support_assignment_required' using errcode='23514'; end if;
  if p_action='assign' and v_previous->>'status'='Assigned'
    and v_previous->>'actorId'=v_target.actor_user_id::text then
    raise exception 'support_supplier_already_assigned' using errcode='23505'; end if;
  v_entry:=pg_catalog.jsonb_build_object('id',gen_random_uuid(),'turnoverId',p_turnover_id,
    'packageId',v_basis->>'packageId','releaseId',v_basis->>'releaseId',
    'actorId',v_target.actor_user_id,'email',v_email,
    'status',case when p_action='assign' then 'Assigned' else 'Revoked' end,
    'previousAssignmentId',v_previous->>'id','byActorId',v_actor,
    'byMembershipId',v_member.id,'at',now(),'reason',pg_catalog.btrim(p_reason));
  v_state:=v_operate.state||pg_catalog.jsonb_build_object(
    'supportDocumentAssignments',coalesce(v_operate.state->'supportDocumentAssignments','[]'::jsonb)
      ||pg_catalog.jsonb_build_array(v_entry),
    'authorityRevision',v_operate.decision_revision+1,
    'events',coalesce(v_operate.state->'events','[]'::jsonb)
      ||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id',gen_random_uuid(),'commandId',p_command_id,'fingerprint',v_fingerprint,
        'at',now(),'actorId',v_actor,'membershipId',v_member.id,
        'action','support-supplier-'||p_action,
        'detail',p_turnover_id||' · '||v_email)));
  update d5o_hosted.connected_operate_states set
    decision_revision=decision_revision+1,state=v_state,updated_at=now()
    where workspace_id=v_workspace.id and work_id=v_work.id;
  insert into d5o_hosted.connected_operate_events(
    workspace_id,work_id,decision_revision,command_id,action,actor_user_id,
    membership_id,deploy_revision,snapshot)
  values(v_workspace.id,v_work.id,v_operate.decision_revision+1,p_command_id,
    'support-supplier-'||p_action,v_actor,v_member.id,v_deploy.decision_revision,v_state);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_operate_receipts(
    workspace_id,command_id,work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_assign_support_document_supplier_v1(
  text,text,text,text,text,text,text,bigint,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_assign_support_document_supplier_v1(
  text,text,text,text,text,text,text,bigint,integer,integer) to authenticated;

-- Reuse the existing per-actor redaction for private document metadata. Only
-- the currently assigned, active supervisor receives supply controls.
create or replace function d5o_hosted.redact_support_document_read_v1(
  p_workspace_key text,p_actor uuid,p_result jsonb
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_role text;v_records jsonb:='[]'::jsonb;v_record jsonb;
  v_docs jsonb;v_packages jsonb;v_work uuid;v_assignments jsonb;v_events jsonb;
begin
  if p_actor is null or p_result#>'{state,records}' is null then return p_result; end if;
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
          else pg_catalog.jsonb_build_object('id','','turnoverId',d->>'turnoverId',
            'kind',d->>'kind','basis',d->'basis','status',d->>'status','restricted',true)
        end order by n),'[]'::jsonb) into v_docs
        from pg_catalog.jsonb_array_elements(v_record#>'{operate,documentationObligations}')
          with ordinality as entries(d,n);
      v_record:=pg_catalog.jsonb_set(v_record,'{operate,documentationObligations}',v_docs);
    end if;
    select l.work_id into v_work from d5o_hosted.work_identity_links l
      join d5o_hosted.workspaces w on w.id=l.workspace_id
      where w.workspace_key=p_workspace_key and w.status='active'
        and l.presentation_id=v_record->>'id';
    select coalesce(s.state->'supportDocumentAssignments','[]'::jsonb)
      into v_assignments from d5o_hosted.connected_operate_states s
      join d5o_hosted.workspaces w on w.id=s.workspace_id
      where w.workspace_key=p_workspace_key and s.work_id=v_work;
    select coalesce(pg_catalog.jsonb_agg(a->>'packageId'),'[]'::jsonb)
      into v_packages from pg_catalog.jsonb_array_elements(coalesce(v_assignments,'[]'::jsonb))
        with ordinality as entries(a,n)
      where a->>'status'='Assigned' and a->>'actorId'=p_actor::text
        and (d5o_hosted.support_document_supervisor_scope_v1(
          p_workspace_key,v_record->>'id',a->>'turnoverId','as-built',p_actor)
          or d5o_hosted.support_document_supervisor_scope_v1(
            p_workspace_key,v_record->>'id',a->>'turnoverId','inspection',p_actor))
        and not exists(select 1 from pg_catalog.jsonb_array_elements(v_assignments)
          with ordinality as later(b,m)
          where b->>'turnoverId'=a->>'turnoverId' and m>n);
    -- Other suppliers' assignment identity and email are not a supervisor read.
    if v_record#>'{operate,supportDocumentAssignments}' is not null then
      v_record:=pg_catalog.jsonb_set(v_record,'{operate,supportDocumentAssignments}',
        coalesce((select pg_catalog.jsonb_agg(a order by n)
          from pg_catalog.jsonb_array_elements(v_assignments) with ordinality as entries(a,n)
          where a->>'actorId'=p_actor::text),'[]'::jsonb));
    end if;
    if pg_catalog.jsonb_typeof(v_record#>'{operate,events}')='array' then
      select coalesce(pg_catalog.jsonb_agg(
        case when e->>'actorId'=p_actor::text or
          (e->>'action' not like 'support-document-%' and
           e->>'action' not like 'support-supplier-%') then e
          else pg_catalog.jsonb_build_object('id',e->>'id','at',e->>'at',
            'action',e->>'action','detail','Restricted support document action')
        end order by n),'[]'::jsonb) into v_events
        from pg_catalog.jsonb_array_elements(v_record#>'{operate,events}')
          with ordinality as entries(e,n);
      v_record:=pg_catalog.jsonb_set(v_record,'{operate,events}',v_events);
    end if;
    v_records:=v_records||pg_catalog.jsonb_build_array(
      v_record||pg_catalog.jsonb_build_object(
        'supportDocumentSupplierPackageIds',coalesce(v_packages,'[]'::jsonb)));
  end loop;
  return pg_catalog.jsonb_set(p_result,'{state,records}',v_records);
end; $$;
