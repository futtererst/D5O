-- The exact-task read must not confuse its local currency with a source column.
-- File 136 was already applied to the isolated clone; preserve forward-only history.
create or replace function public.d5o_spending_delegate_my_review_v1(
 p_workspace_key text,p_presentation_id text,p_category text,p_subject_id uuid) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; w uuid; role_name text; prepared_at timestamptz;
 amount bigint; preparer uuid; needed_until date; v_currency text; required_role text;
 enabled boolean; chosen uuid;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then
  raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select role into role_name from d5o_hosted.memberships where workspace_id=ws and actor_user_id=actor and status='active';
 select work_id into w from d5o_hosted.work_identity_links where workspace_id=ws and presentation_id=p_presentation_id;
 if role_name is null or w is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 if p_category='work_authority' then
  select a.parent_cap_minor,a.prepared_by,a.valid_until,a.currency,'admin',a.created_at
   into amount,preparer,needed_until,v_currency,required_role,prepared_at
   from d5o_hosted.purchase_authorities a
   where a.workspace_id=ws and a.work_id=w and a.id=p_subject_id and a.status='Prepared';
 elsif p_category='design_authority' then
  select a.cap_minor,a.prepared_by,a.valid_until,a.currency,a.source_snapshot->>'approverRole',a.created_at
   into amount,preparer,needed_until,v_currency,required_role,prepared_at
   from d5o_hosted.design_spend_authorities a
   where a.workspace_id=ws and a.work_id=w and a.id=p_subject_id and a.status='Prepared';
 elsif p_category='design_commitment' then
  select c.amount_minor,c.prepared_by,a.valid_until,c.currency,a.source_snapshot->>'approverRole',c.created_at
   into amount,preparer,needed_until,v_currency,required_role,prepared_at
   from d5o_hosted.design_spend_commitments c
   join d5o_hosted.design_spend_authorities a on a.id=c.authority_id
   where c.workspace_id=ws and c.work_id=w and c.id=p_subject_id and c.status='Prepared';
 else raise exception 'invalid_spending_category' using errcode='22023'; end if;
 if amount is null then return pg_catalog.jsonb_build_object('pending',false,'canReview',false); end if;
 select exists(select 1 from d5o_hosted.spending_delegate_categories c
  where c.workspace_id=ws and c.category=p_category and c.configured_at<=prepared_at) into enabled;
 chosen:=case when enabled then d5o_hosted.spending_delegate_selected_v1(ws,w,p_category,
  required_role,amount,v_currency,preparer,needed_until) else null end;
 return pg_catalog.jsonb_build_object('pending',true,'configured',enabled,
  'canReview',case when enabled then coalesce(chosen=actor,false) else role_name=required_role and actor<>preparer end,
  'held',enabled and chosen is null,
  'route',case when enabled and chosen is null then 'No eligible delegate or sponsor is configured.'
   when enabled and chosen=actor then 'This exact decision is assigned to you.'
   when enabled then 'Waiting for the configured independent reviewer.'
   else 'Existing role-based review applies until delegation is configured.' end);
end; $$;
revoke all on function public.d5o_spending_delegate_my_review_v1(text,text,text,uuid) from public,anon,service_role;
grant execute on function public.d5o_spending_delegate_my_review_v1(text,text,text,uuid) to authenticated;
