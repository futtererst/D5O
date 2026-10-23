-- A sourced Work cost forecast can precede customer award. It conveys no
-- billing, purchasing or field authority and never changes an award fact.
alter function public.d5o_hosted_design_cost_command_v1(text,text,text,jsonb,text,integer,text)
 rename to d5o_hosted_design_cost_command_pre_forecast_v1;
revoke all on function public.d5o_hosted_design_cost_command_pre_forecast_v1(text,text,text,jsonb,text,integer,text)
 from public,anon,authenticated,service_role;

create function public.d5o_hosted_design_cost_command_v1(
 p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,p_command_id text,
 p_expected_revision integer,p_expected_source_digest text) returns jsonb
 language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; member d5o_hosted.memberships%rowtype;
 work d5o_hosted.work_records%rowtype; pos d5o_hosted.design_cost_positions%rowtype;
 receipt d5o_hosted.design_cost_receipts%rowtype; src jsonb; fingerprint text;
 result jsonb; amount bigint; changed_date date;
begin
 if p_action<>'set-work-forecast' then
  return public.d5o_hosted_design_cost_command_pre_forecast_v1(p_workspace_key,p_presentation_id,
   p_action,p_input,p_command_id,p_expected_revision,p_expected_source_digest);
 end if;
 if current_setting('role',true)<>'authenticated' or actor is null
  or pg_catalog.jsonb_typeof(p_input)<>'object' or length(coalesce(p_command_id,'')) not between 8 and 120
  or p_expected_revision is null or p_expected_revision<0 then raise exception 'invalid_work_forecast_command' using errcode='22023'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select * into member from d5o_hosted.memberships where workspace_id=ws and actor_user_id=actor and status='active' for share;
 if member.id is null or member.role<>'billing_commercial_lead' then raise exception 'finance_forecast_role_required' using errcode='42501'; end if;
 select r.* into work from d5o_hosted.work_records r join d5o_hosted.work_identity_links l
  on l.workspace_id=r.workspace_id and l.work_id=r.id where r.workspace_id=ws and l.presentation_id=p_presentation_id for update of r;
 if work.id is null then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
 fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_presentation_id,p_action,p_input,p_expected_revision,p_expected_source_digest)::text);
 select * into receipt from d5o_hosted.design_cost_receipts where workspace_id=ws and command_id=p_command_id;
 if receipt.command_id is not null then
  if receipt.work_id<>work.id or receipt.actor_user_id<>actor or receipt.fingerprint<>fingerprint then
   raise exception 'command_reuse_conflict' using errcode='23505'; end if;
  return receipt.result; end if;
 insert into d5o_hosted.design_cost_positions(workspace_id,work_id) values(ws,work.id) on conflict do nothing;
 select * into pos from d5o_hosted.design_cost_positions where workspace_id=ws and work_id=work.id for update;
 if pos.revision<>p_expected_revision then raise exception 'stale_design_cost_revision' using errcode='23505'; end if;
 src:=d5o_hosted.outlook_source_v1(ws,work.id);
 if src->>'digest' is distinct from p_expected_source_digest then raise exception 'outlook_source_changed' using errcode='23514'; end if;
 if exists(select 1 from d5o_hosted.connected_operate_states o where o.workspace_id=ws and o.work_id=work.id
   and o.state#>>'{finance,status}'='Closed') then raise exception 'finance_closed_requires_reopen' using errcode='23514'; end if;
 if coalesce(p_input->>'amountMinor','') !~ '^(0|[1-9][0-9]*)$'
  or coalesce(p_input->>'forecastAt','') !~ '^\d{4}-\d{2}-\d{2}$'
  or length(trim(coalesce(p_input->>'source','')))<8 then raise exception 'sourced_work_forecast_required' using errcode='22023'; end if;
 amount:=(p_input->>'amountMinor')::bigint; changed_date:=(p_input->>'forecastAt')::date;
 if amount>1000000000000 or changed_date>current_date then raise exception 'work_forecast_amount_or_date_invalid' using errcode='23514'; end if;
 insert into d5o_hosted.connected_job_finance_states(workspace_id,work_id,currency)
  values(ws,work.id,'USD') on conflict do nothing;
 update d5o_hosted.connected_job_finance_states set revision=revision+1,
  remaining_forecast_minor=amount,forecast_source=trim(p_input->>'source'),forecast_at=changed_date
  where workspace_id=ws and work_id=work.id and currency='USD';
 if not found then raise exception 'forecast_currency_mismatch' using errcode='23514'; end if;
 update d5o_hosted.design_cost_positions set revision=revision+1 where workspace_id=ws and work_id=work.id;
 result:=pg_catalog.jsonb_build_object('revision',pos.revision+1,'action',p_action,'amountMinor',amount);
 insert into d5o_hosted.design_cost_events(workspace_id,work_id,revision,action,command_id,actor_user_id,membership_id,subject_id,basis)
  values(ws,work.id,pos.revision+1,p_action,p_command_id,actor,member.id,work.id,
   pg_catalog.jsonb_build_object('sourceDigest',src->>'digest','amountMinor',amount,'forecastAt',changed_date,'source',trim(p_input->>'source')));
 insert into d5o_hosted.design_cost_receipts(workspace_id,command_id,work_id,actor_user_id,fingerprint,result)
  values(ws,p_command_id,work.id,actor,fingerprint,result);
 return result;
end; $$;
revoke all on function public.d5o_hosted_design_cost_command_v1(text,text,text,jsonb,text,integer,text) from public,anon,service_role;
grant execute on function public.d5o_hosted_design_cost_command_v1(text,text,text,jsonb,text,integer,text) to authenticated;
