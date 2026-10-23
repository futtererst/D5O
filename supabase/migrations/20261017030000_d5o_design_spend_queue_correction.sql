-- LEAST is a PostgreSQL expression, not a schema-qualified function.
create or replace function public.d5o_hosted_design_spend_actions_v1(p_workspace_key text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; role_name text; item record; src jsonb;
 authority d5o_hosted.design_spend_authorities%rowtype;
 pending_authority d5o_hosted.design_spend_authorities%rowtype;
 pending_commit d5o_hosted.design_spend_commitments%rowtype;
 used bigint; remaining bigint; result jsonb:='[]'::jsonb;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select role into role_name from d5o_hosted.memberships where workspace_id=ws and actor_user_id=actor and status='active';
 if role_name is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 if role_name not in ('admin','project_manager','operations_leader') then return result; end if;
 for item in select w.id,w.title,w.created_by,l.presentation_id,coalesce(p.revision,0) revision
  from d5o_hosted.connected_rom_design_states r
  join d5o_hosted.work_records w on w.id=r.work_id and w.workspace_id=r.workspace_id
  join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
  left join d5o_hosted.design_spend_positions p on p.work_id=w.id and p.workspace_id=w.workspace_id
  where r.workspace_id=ws and r.status='Design authorized' loop
  src:=d5o_hosted.design_spend_source_v1(ws,item.id);
  if src is null then continue; end if;
  select * into authority from d5o_hosted.design_spend_authorities
   where workspace_id=ws and work_id=item.id and status='Approved' and source_digest=src->>'digest'
   order by created_at desc limit 1;
  select * into pending_authority from d5o_hosted.design_spend_authorities
   where workspace_id=ws and work_id=item.id and status='Prepared' and source_digest=src->>'digest'
   order by created_at desc limit 1;
  if pending_authority.id is not null and role_name=src->>'approverRole' and pending_authority.prepared_by<>actor then
   result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Review Design spending window',
    'phase','Develop','focus','design-spend-authority-review','workId',item.presentation_id,'workTitle',item.title,
    'revision',item.revision,'decisionId',pending_authority.id,'dueDate',pending_authority.valid_until,
    'status','Prepared','ownership','Eligible independent Design spending authority',
    'blocker','Confirm activity, funding source, expiry and cap against the approved Design permission.'));
  elsif authority.id is null and pending_authority.id is null and role_name='project_manager' and item.created_by=actor then
   result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Prepare Design spending window',
    'phase','Develop','focus','design-spend-authority-prep','workId',item.presentation_id,'workTitle',item.title,
    'revision',item.revision,'status','Preparation','ownership','Assigned project manager',
    'blocker','Propose the permitted activity and expiry within the independently approved Design cap.'));
  end if;
  if authority.id is not null and current_date between authority.valid_from and authority.valid_until then
   select coalesce(sum(amount_minor),0) into used from d5o_hosted.design_spend_commitments
    where workspace_id=ws and work_id=item.id and status='Approved';
   remaining:=least(authority.cap_minor,(src#>>'{authorization,spendCapMinor}')::bigint)-used;
   select * into pending_commit from d5o_hosted.design_spend_commitments
    where workspace_id=ws and work_id=item.id and authority_id=authority.id and status='Prepared'
    order by created_at desc limit 1;
   if pending_commit.id is not null and role_name=src->>'approverRole' and pending_commit.prepared_by<>actor then
    result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Review Design effort commitment',
     'phase','Develop','focus','design-spend-commitment-review','workId',item.presentation_id,'workTitle',item.title,
     'revision',item.revision,'decisionId',pending_commit.id,'dueDate',authority.valid_until,
     'status','Prepared','ownership','Eligible independent Design spending authority',
     'blocker',case when pending_commit.amount_minor>remaining then 'Prepared amount exceeds the remaining authorized cap; return for correction.' else null end));
   elsif pending_commit.id is null and remaining>0 and role_name='project_manager' and item.created_by=actor then
    result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Prepare Design effort commitment',
     'phase','Develop','focus','design-spend-commitment-prep','workId',item.presentation_id,'workTitle',item.title,
     'revision',item.revision,'decisionId',authority.id,'dueDate',authority.valid_until,
     'status','Preparation','ownership','Assigned project manager',
     'blocker','A draft does not commit spend; independent approval consumes the cap.'));
   end if;
  end if;
 end loop;
 return result;
end; $$;
revoke all on function public.d5o_hosted_design_spend_actions_v1(text) from public,anon,service_role;
grant execute on function public.d5o_hosted_design_spend_actions_v1(text) to authenticated;

