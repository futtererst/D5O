-- An administrator client may fetch bytes only after the authenticated caller
-- has been checked against the exact Work owner or independent Finance role.
create function public.d5o_hosted_design_cost_evidence_read_v2(
 p_workspace_key text,p_presentation_id text,p_claim_id uuid,p_actor_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ws uuid; w d5o_hosted.work_records%rowtype; member d5o_hosted.memberships%rowtype;
begin
 if current_setting('role',true)<>'service_role' or p_actor_id is null
  then raise exception 'server_only' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select r.* into w from d5o_hosted.work_records r join d5o_hosted.work_identity_links l
  on l.workspace_id=r.workspace_id and l.work_id=r.id
  where r.workspace_id=ws and l.presentation_id=p_presentation_id;
 select * into member from d5o_hosted.memberships where workspace_id=ws
  and actor_user_id=p_actor_id and status='active';
 if w.id is null or member.id is null or not (member.role='billing_commercial_lead'
  or (member.role='project_manager' and w.created_by=p_actor_id))
  or not exists(select 1 from d5o_hosted.design_cost_claims c where c.id=p_claim_id
   and c.workspace_id=ws and c.work_id=w.id)
  then raise exception 'design_cost_evidence_scope_denied' using errcode='42501'; end if;
 return public.d5o_hosted_design_cost_evidence_read_v1(p_workspace_key,p_presentation_id,p_claim_id);
end; $$;
revoke all on function public.d5o_hosted_design_cost_evidence_read_v1(text,text,uuid)
 from public,anon,authenticated,service_role;
revoke all on function public.d5o_hosted_design_cost_evidence_read_v2(text,text,uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.d5o_hosted_design_cost_evidence_read_v2(text,text,uuid,uuid)
 to service_role;
