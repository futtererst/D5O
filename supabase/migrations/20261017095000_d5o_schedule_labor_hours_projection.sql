-- The existing schedule writer intentionally stores only its established
-- assignment shape. Keep economic effort in the governed booking intent and
-- project the non-sensitive hours onto scheduler reads after reload.
create function public.d5o_schedule_labor_hours_v1(p_workspace_key text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; role_name text;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then
  raise exception 'scheduling_authority_required' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces
  where workspace_key=p_workspace_key and status='active';
 select role into role_name from d5o_hosted.memberships
  where workspace_id=ws and actor_user_id=actor and status='active';
 if role_name not in ('admin','project_manager','operations_leader') then
  raise exception 'scheduling_authority_required' using errcode='42501'; end if;
 return coalesce((select pg_catalog.jsonb_object_agg(i.assignment_id,i.person_hours_per_worker)
  from d5o_hosted.labor_booking_intents i where i.workspace_id=ws),'{}'::jsonb);
end; $$;
revoke all on function public.d5o_schedule_labor_hours_v1(text) from public,anon,service_role;
grant execute on function public.d5o_schedule_labor_hours_v1(text) to authenticated;
