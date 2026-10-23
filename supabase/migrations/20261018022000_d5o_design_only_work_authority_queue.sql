-- Queue eligibility follows the same approved commercial or funded Design source as the command.
-- An approved BOM remains necessary when a positive purchasing allocation is prepared.
-- This changes no authority, source, revision, tenant or decision command.
CREATE OR REPLACE FUNCTION public.d5o_purchase_authority_actions_pre_delegation_v1(p_workspace_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); ws uuid; role_name text; item record; source jsonb;
 current_authority d5o_hosted.purchase_authorities%rowtype; pending d5o_hosted.purchase_authorities%rowtype;
 actions jsonb:='[]'::jsonb;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select role into role_name from d5o_hosted.memberships where workspace_id=ws and actor_user_id=actor and status='active';
 if role_name is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 if role_name not in ('admin','project_manager') then return actions; end if;
 for item in select w.id,w.title,w.created_by,l.presentation_id,coalesce(p.revision,0) revision
  from d5o_hosted.work_records w
  join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
  left join d5o_hosted.purchase_authority_positions p on p.work_id=w.id and p.workspace_id=w.workspace_id
  where w.workspace_id=ws and exists(select 1 from d5o_hosted.connected_estimate_states e
   where e.workspace_id=ws and e.work_id=w.id and e.status='Approved') loop
  source:=d5o_hosted.purchase_basis_v1(ws,item.id);
  if source is null then continue; end if;
  if exists(select 1 from d5o_hosted.graybar_states g
   cross join lateral pg_catalog.jsonb_array_elements(coalesce(g.state->'orders','[]'::jsonb)) historical
   where g.workspace_id=ws and g.work_id=item.id
    and historical->>'status' in ('Approved','Test submitted','Acknowledged')
    and not exists(select 1 from d5o_hosted.purchase_reservations r
     where r.workspace_id=ws and r.work_id=item.id and r.order_id=historical->>'id')) then
   if role_name='project_manager' and item.created_by=actor then
    actions:=actions||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
     'kind','Historical PO authority transition','phase','Procurement','focus','authority-legacy',
     'workId',item.presentation_id,'workTitle',item.title,'revision',item.revision,
     'status','Waiting','position','waiting','ownership','Workspace administrator',
     'blocker','An earlier approved PO has no reviewed Work reservation. Historical costs remain; new purchasing waits for a governed transition.'));
   end if;
   continue;
  end if;
  select * into current_authority from d5o_hosted.purchase_authorities
   where workspace_id=ws and work_id=item.id and status='Approved' and source_digest=source->>'digest'
    and current_date between valid_from and valid_until order by created_at desc limit 1;
  select * into pending from d5o_hosted.purchase_authorities
   where workspace_id=ws and work_id=item.id and status='Prepared' and source_digest=source->>'digest'
   order by created_at desc limit 1;
  if pending.id is not null and role_name='admin' and pending.prepared_by<>actor then
   actions:=actions||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'kind','Review Work economic authority','phase','Procurement','focus','authority-review',
    'workId',item.presentation_id,'workTitle',item.title,'revision',item.revision,
    'decisionId',pending.id,'status','Prepared','dueDate',pending.valid_until,
    'ownership','Independent workspace administrator',
    'blocker','Review exact Work and purchasing limits, funding source, conditions and expiry.'));
  elsif current_authority.id is null and pending.id is null and role_name='project_manager' and item.created_by=actor then
   actions:=actions||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'kind','Prepare Work economic authority','phase','Procurement','focus','authority-prepare',
    'workId',item.presentation_id,'workTitle',item.title,'revision',item.revision,
    'status','Preparation','ownership','Assigned project manager',
    'blocker','Prepare a reviewed Work cap and applicable category allocation; a draft grants no spending permission.'));
  end if;
 end loop;
 return actions;
end; $function$;

revoke all on function public.d5o_purchase_authority_actions_pre_delegation_v1(text) from public,anon,authenticated,service_role;
