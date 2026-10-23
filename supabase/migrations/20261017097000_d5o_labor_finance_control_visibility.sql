-- Keep Finance's manual-cost controls aligned with the authoritative
-- reviewed-field-labor guard. No rate or worker compensation is exposed.
alter function public.d5o_hosted_job_finance_read_v1(text,text)
 rename to d5o_hosted_job_finance_read_pre_labor_visibility_v1;
revoke all on function public.d5o_hosted_job_finance_read_pre_labor_visibility_v1(text,text)
 from public,anon,authenticated,service_role;

create function public.d5o_hosted_job_finance_read_v1(
 p_workspace_key text,p_presentation_id text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare base jsonb; ws uuid; w uuid;
begin
 base:=public.d5o_hosted_job_finance_read_pre_labor_visibility_v1(
  p_workspace_key,p_presentation_id);
 select id into ws from d5o_hosted.workspaces
  where workspace_key=p_workspace_key and status='active';
 select work_id into w from d5o_hosted.work_identity_links
  where workspace_id=ws and presentation_id=p_presentation_id;
 return base||pg_catalog.jsonb_build_object(
  'governedLabor',exists(select 1 from d5o_hosted.labor_authorities
   where workspace_id=ws and work_id=w and status='Approved'));
end; $$;
revoke all on function public.d5o_hosted_job_finance_read_v1(text,text)
 from public,anon,service_role;
grant execute on function public.d5o_hosted_job_finance_read_v1(text,text)
 to authenticated;
