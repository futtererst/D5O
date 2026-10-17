-- Current economics use the latest independently reviewed revision of each
-- field report. Earlier reviews remain visible in actuals as history.
create or replace function public.d5o_labor_authority_read_v1(p_workspace_key text,p_presentation_id text)
 returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; w uuid; role_name text; source jsonb;
 parent d5o_hosted.purchase_authorities%rowtype; labor d5o_hosted.labor_authorities%rowtype;
 used bigint; design_used bigint; po_used bigint; sub_used bigint;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then
  raise exception 'labor_scope_denied' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select role into role_name from d5o_hosted.memberships
  where workspace_id=ws and actor_user_id=actor and status='active';
 select work_id into w from d5o_hosted.work_identity_links
  where workspace_id=ws and presentation_id=p_presentation_id;
 if w is null or role_name not in ('admin','project_manager','operations_leader','billing_commercial_lead') then
  raise exception 'labor_scope_denied' using errcode='42501'; end if;
 source:=d5o_hosted.purchase_basis_v1(ws,w);
 select * into parent from d5o_hosted.purchase_authorities
  where workspace_id=ws and work_id=w and status='Approved'
   and source_digest=source->>'digest' and current_date between valid_from and valid_until
  order by created_at desc limit 1;
 select * into labor from d5o_hosted.labor_authorities
  where workspace_id=ws and work_id=w and status='Approved'
   and parent_authority_id=parent.id and source_digest=source->>'digest'
   and current_date between valid_from and valid_until
  order by created_at desc limit 1;
 used:=d5o_hosted.labor_exposure_v1(ws,w);
 select coalesce(sum(amount_minor),0) into design_used from d5o_hosted.design_spend_commitments
  where workspace_id=ws and work_id=w and status='Approved';
 select coalesce(sum(amount_minor),0) into po_used from d5o_hosted.purchase_reservations
  where workspace_id=ws and work_id=w and status='Reserved';
 select coalesce(sum(amount_minor),0) into sub_used from d5o_hosted.subcontract_reservations
  where workspace_id=ws and work_id=w;
 return pg_catalog.jsonb_build_object(
  'revision',coalesce((select revision from d5o_hosted.labor_authority_positions
    where workspace_id=ws and work_id=w),0),
  'source',source,'parentAuthorityId',parent.id,'parentCapMinor',parent.parent_cap_minor,
  'parentRemainingMinor',case when parent.id is null then null
    else parent.parent_cap_minor-design_used-po_used-sub_used-used end,
  'laborAuthorityId',labor.id,'laborCapMinor',labor.cap_minor,
  'laborRemainingMinor',case when labor.id is null then null else labor.cap_minor-used end,
  'laborExposureMinor',used,'designConsumedMinor',design_used,
  'purchaseConsumedMinor',po_used,'subcontractConsumedMinor',sub_used,
  'authorities',coalesce((select pg_catalog.jsonb_agg(to_jsonb(a) order by a.created_at)
    from d5o_hosted.labor_authorities a where a.workspace_id=ws and a.work_id=w),'[]'::jsonb),
  'reservations',coalesce((select pg_catalog.jsonb_agg(
    to_jsonb(r)||pg_catalog.jsonb_build_object(
     'reviewedHours',coalesce((select sum(latest.reviewed_hours) from (
       select distinct on (a.report_id) a.report_id,a.reviewed_hours
       from d5o_hosted.labor_actuals a where a.reservation_id=r.id
       order by a.report_id,a.report_revision desc) latest),0),
     'incurredMinor',coalesce((select sum(latest.amount_minor) from (
       select distinct on (a.report_id) a.report_id,a.amount_minor
       from d5o_hosted.labor_actuals a where a.reservation_id=r.id
       order by a.report_id,a.report_revision desc) latest),0))
    order by r.approved_at) from d5o_hosted.labor_reservations r
    where r.workspace_id=ws and r.work_id=w),'[]'::jsonb),
  'actuals',coalesce((select pg_catalog.jsonb_agg(to_jsonb(a) order by a.reviewed_at)
    from d5o_hosted.labor_actuals a where a.workspace_id=ws and a.work_id=w),'[]'::jsonb));
end; $$;
revoke all on function public.d5o_labor_authority_read_v1(text,text) from public,anon,service_role;
grant execute on function public.d5o_labor_authority_read_v1(text,text) to authenticated;
