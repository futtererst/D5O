-- Field-labor preparation is actionable only on an awarded delivery basis.
-- Keep already-prepared reviews visible; typed authority and field-start commands are unchanged.
create or replace function public.d5o_labor_authority_actions_v1(p_workspace_key text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; role_name text; item record; source jsonb;
 parent d5o_hosted.purchase_authorities%rowtype;
 approved d5o_hosted.labor_authorities%rowtype; pending d5o_hosted.labor_authorities%rowtype;
 actions jsonb:='[]'::jsonb;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then
  raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select role into role_name from d5o_hosted.memberships
  where workspace_id=ws and actor_user_id=actor and status='active';
 if role_name is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 if role_name not in ('admin','project_manager') then return actions; end if;
 for item in select w.id,w.title,w.created_by,l.presentation_id,coalesce(p.revision,0) revision
  from d5o_hosted.work_records w
  join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id and l.work_id=w.id
  left join d5o_hosted.labor_authority_positions p on p.workspace_id=w.workspace_id and p.work_id=w.id
  where w.workspace_id=ws loop
  source:=d5o_hosted.purchase_basis_v1(ws,item.id);
  if source is null then continue; end if;
  select * into parent from d5o_hosted.purchase_authorities
   where workspace_id=ws and work_id=item.id and status='Approved'
    and source_digest=source->>'digest' and current_date between valid_from and valid_until
   order by created_at desc limit 1;
  if parent.id is null then continue; end if;
  select * into approved from d5o_hosted.labor_authorities
   where workspace_id=ws and work_id=item.id and status='Approved'
    and parent_authority_id=parent.id and source_digest=source->>'digest'
    and current_date between valid_from and valid_until
   order by created_at desc limit 1;
  select * into pending from d5o_hosted.labor_authorities
   where workspace_id=ws and work_id=item.id and status='Prepared'
    and parent_authority_id=parent.id and source_digest=source->>'digest'
   order by created_at desc limit 1;
  if pending.id is not null and role_name='admin' and pending.prepared_by<>actor then
   actions:=actions||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'kind','Review field labor authority','phase','Labor','focus','review',
    'workId',item.presentation_id,'workTitle',item.title,'revision',item.revision,
    'decisionId',pending.id,'status','Prepared','dueDate',pending.valid_until,
    'ownership','Independent workspace administrator',
    'blocker','Review the Work and labor caps, rate source, scope, conditions and expiry.'));
  elsif approved.id is null and pending.id is null and role_name='project_manager' and item.created_by=actor
   and source->>'kind'='Awarded work' then
   actions:=actions||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'kind','Prepare field labor authority','phase','Labor','focus','prepare',
    'workId',item.presentation_id,'workTitle',item.title,'revision',item.revision,
    'status','Preparation','position','preparation','ownership','Assigned project manager',
    'blocker','Published worker assignments require a reviewed rate and labor allocation. Draft booking remains available.'));
  end if;
 end loop;
 return actions;
end; $$;
revoke all on function public.d5o_labor_authority_actions_v1(text) from public,anon,service_role;
grant execute on function public.d5o_labor_authority_actions_v1(text) to authenticated;

