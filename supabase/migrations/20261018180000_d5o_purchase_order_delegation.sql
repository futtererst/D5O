-- Extend the existing, actor-level spending delegation to prepared Graybar POs.
-- The existing admin role, independent review, exact source and Work/category caps remain authoritative.
alter table d5o_hosted.spending_delegate_categories drop constraint spending_delegate_categories_category_check;
alter table d5o_hosted.spending_delegate_categories add constraint spending_delegate_categories_category_check
 check(category in ('work_authority','design_authority','design_commitment','purchase_order'));
alter table d5o_hosted.spending_delegate_rules drop constraint spending_delegate_rules_category_check;
alter table d5o_hosted.spending_delegate_rules add constraint spending_delegate_rules_category_check
 check(category in ('work_authority','design_authority','design_commitment','purchase_order'));

create or replace function public.d5o_spending_delegate_command_v1(
 p_workspace_key text,p_action text,p_input jsonb,p_command_id text,p_expected_revision integer)
 returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; member d5o_hosted.memberships%rowtype;
 pos d5o_hosted.spending_delegate_positions%rowtype; prior d5o_hosted.spending_delegate_receipts%rowtype;
 rule d5o_hosted.spending_delegate_rules%rowtype; target d5o_hosted.memberships%rowtype;
 fp text; result jsonb; category text; role_name text;
begin
 if current_setting('role',true)<>'authenticated' or actor is null or p_action not in ('add','revoke')
  or pg_catalog.jsonb_typeof(p_input)<>'object' or length(coalesce(p_command_id,'')) not between 8 and 120
  or p_expected_revision is null or p_expected_revision<0 then
  raise exception 'invalid_spending_delegate_command' using errcode='22023'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select * into member from d5o_hosted.memberships where workspace_id=ws and actor_user_id=actor
  and status='active' for share;
 if member.id is null or member.role<>'admin' then
  raise exception 'spending_configuration_admin_required' using errcode='42501'; end if;
 fp:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_action,p_input,p_expected_revision)::text);
 select * into prior from d5o_hosted.spending_delegate_receipts where workspace_id=ws and command_id=p_command_id;
 if prior.command_id is not null then
  if prior.actor_user_id<>actor or prior.fingerprint<>fp then
   raise exception 'command_reuse_conflict' using errcode='23505'; end if;
  return prior.result; end if;
 insert into d5o_hosted.spending_delegate_positions(workspace_id) values(ws) on conflict do nothing;
 select * into pos from d5o_hosted.spending_delegate_positions where workspace_id=ws for update;
 if pos.revision<>p_expected_revision then raise exception 'stale_spending_delegate_revision' using errcode='23505'; end if;
 if p_action='add' then
  category:=p_input->>'category'; role_name:=p_input->>'role';
  if category not in ('work_authority','design_authority','design_commitment','purchase_order')
   or role_name not in ('admin','operations_leader')
   or (category in ('work_authority','purchase_order') and role_name<>'admin')
   or p_input->>'kind' not in ('delegate','sponsor')
   or coalesce(p_input->>'maxMinor','') !~ '^[1-9][0-9]*$'
   or coalesce(p_input->>'currency','') !~ '^[A-Z]{3}$'
   or coalesce(p_input->>'validFrom','') !~ '^\d{4}-\d{2}-\d{2}$'
   or coalesce(p_input->>'validUntil','') !~ '^\d{4}-\d{2}-\d{2}$'
   or length(trim(coalesce(p_input->>'sourceReference','')))<8
   or coalesce(p_input->>'priority','100') !~ '^\d{1,4}$' then
   raise exception 'invalid_spending_delegate_rule' using errcode='22023'; end if;
  if (p_input->>'validUntil')::date<current_date
   or (p_input->>'validFrom')::date>(p_input->>'validUntil')::date
   or (p_input->>'maxMinor')::bigint>1000000000000 then
   raise exception 'spending_delegate_rule_range_invalid' using errcode='23514'; end if;
  select * into target from d5o_hosted.memberships where workspace_id=ws
   and actor_user_id=(p_input->>'actorId')::uuid and status='active' for share;
  if target.id is null or target.role<>role_name then
   raise exception 'delegate_existing_role_required' using errcode='42501'; end if;
  insert into d5o_hosted.spending_delegate_categories(workspace_id,category)
   values(ws,category) on conflict do nothing;
  insert into d5o_hosted.spending_delegate_rules(workspace_id,category,kind,actor_user_id,
   role_name,currency,max_minor,work_type_key,priority,valid_from,valid_until,source_reference,configured_by)
   values(ws,category,p_input->>'kind',target.actor_user_id,role_name,p_input->>'currency',
    (p_input->>'maxMinor')::bigint,nullif(trim(coalesce(p_input->>'workTypeKey','')),''),
    coalesce((p_input->>'priority')::integer,100),(p_input->>'validFrom')::date,
    (p_input->>'validUntil')::date,trim(p_input->>'sourceReference'),actor) returning * into rule;
 else
  select * into rule from d5o_hosted.spending_delegate_rules
   where workspace_id=ws and id=(p_input->>'ruleId')::uuid and status='Active' for update;
  if rule.id is null or length(trim(coalesce(p_input->>'reason','')))<10 then
   raise exception 'active_rule_and_reason_required' using errcode='23514'; end if;
  update d5o_hosted.spending_delegate_rules set status='Revoked',revoked_at=now()
   where id=rule.id;
 end if;
 update d5o_hosted.spending_delegate_positions set revision=revision+1 where workspace_id=ws;
 insert into d5o_hosted.spending_delegate_events(workspace_id,revision,action,command_id,
  actor_user_id,membership_id,rule_id,basis)
  values(ws,pos.revision+1,p_action,p_command_id,actor,member.id,rule.id,p_input);
 result:=pg_catalog.jsonb_build_object('revision',pos.revision+1,'ruleId',rule.id,'action',p_action);
 insert into d5o_hosted.spending_delegate_receipts(workspace_id,command_id,actor_user_id,fingerprint,result)
  values(ws,p_command_id,actor,fp,result);
 return result;
end; $$;

-- Select the one configured reviewer at the actual PO approval mutation. A rejection
-- rolls back the entire command, including its financial reservation and receipt.
create function d5o_hosted.guard_purchase_order_delegate_v1() returns trigger
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); item jsonb; previous jsonb; enabled_at timestamptz;
 chosen uuid; prepared_at timestamptz;
begin
 for item in select value from pg_catalog.jsonb_array_elements(coalesce(new.state->'orders','[]'::jsonb)) loop
  select value into previous from pg_catalog.jsonb_array_elements(coalesce(old.state->'orders','[]'::jsonb))
   where value->>'id'=item->>'id';
  if previous is null or previous->>'status'<>'Prepared' or item->>'status'<>'Approved' then continue; end if;
  select configured_at into enabled_at from d5o_hosted.spending_delegate_categories
   where workspace_id=new.workspace_id and category='purchase_order';
  prepared_at:=nullif(previous->>'preparedAt','')::timestamptz;
  -- An existing draft retains its original administrator review contract.
  if enabled_at is null or prepared_at is null or prepared_at<enabled_at then continue; end if;
  chosen:=d5o_hosted.spending_delegate_selected_v1(new.workspace_id,new.work_id,
   'purchase_order','admin',(previous->>'amountMinor')::bigint,previous->>'currency',
   (previous->>'preparedBy')::uuid,current_date);
  if chosen is null then raise exception 'spending_delegate_or_sponsor_required' using errcode='23514'; end if;
  if actor is distinct from chosen then raise exception 'selected_spending_reviewer_required' using errcode='42501'; end if;
 end loop;
 return new;
end; $$;
revoke all on function d5o_hosted.guard_purchase_order_delegate_v1() from public,anon,authenticated,service_role;
create trigger guard_purchase_order_delegate before update on d5o_hosted.graybar_states
 for each row execute function d5o_hosted.guard_purchase_order_delegate_v1();

-- Exact, private decision route shared by the queue and the focused PO surface.
create function public.d5o_purchase_order_my_review_v1(
 p_workspace_key text,p_presentation_id text,p_order_id uuid) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; w uuid; role_name text; state jsonb; item jsonb;
 enabled_at timestamptz; prepared_at timestamptz; chosen uuid; enabled boolean;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then
  raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select role into role_name from d5o_hosted.memberships
  where workspace_id=ws and actor_user_id=actor and status='active';
 select work_id into w from d5o_hosted.work_identity_links
  where workspace_id=ws and presentation_id=p_presentation_id;
 if role_name is null or w is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 if role_name<>'admin' then return pg_catalog.jsonb_build_object('pending',false,'canReview',false); end if;
 select s.state into state from d5o_hosted.graybar_states s where s.workspace_id=ws and s.work_id=w;
 select value into item from pg_catalog.jsonb_array_elements(coalesce(state->'orders','[]'::jsonb))
  where value->>'id'=p_order_id::text;
 if item is null or item->>'status'<>'Prepared' then
  return pg_catalog.jsonb_build_object('pending',false,'canReview',false); end if;
 prepared_at:=nullif(item->>'preparedAt','')::timestamptz;
 select configured_at into enabled_at from d5o_hosted.spending_delegate_categories
  where workspace_id=ws and category='purchase_order';
 enabled:=enabled_at is not null and prepared_at>=enabled_at;
 if enabled then
  chosen:=d5o_hosted.spending_delegate_selected_v1(ws,w,'purchase_order','admin',
   (item->>'amountMinor')::bigint,item->>'currency',(item->>'preparedBy')::uuid,current_date);
 end if;
 return pg_catalog.jsonb_build_object('pending',true,'configured',enabled,
  'canReview',case when enabled then coalesce(chosen=actor,false)
   else role_name='admin' and item->>'preparedBy'<>actor::text end,
  'held',enabled and chosen is null,
  'route',case when enabled and chosen is null then 'No eligible purchasing delegate or sponsor is configured.'
   when enabled and chosen=actor then 'This exact purchase decision is assigned to you.'
   when enabled then 'Waiting for the configured independent purchasing reviewer.'
   else 'Existing independent administrator review applies to this earlier draft.' end);
end; $$;
revoke all on function public.d5o_purchase_order_my_review_v1(text,text,uuid) from public,anon,service_role;
grant execute on function public.d5o_purchase_order_my_review_v1(text,text,uuid) to authenticated;

alter function public.d5o_graybar_actions_v1(text) rename to d5o_graybar_actions_pre_purchase_delegation_v1;
revoke all on function public.d5o_graybar_actions_pre_purchase_delegation_v1(text) from public,anon,authenticated,service_role;
create function public.d5o_graybar_actions_v1(p_workspace_key text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare raw jsonb; entry jsonb; output jsonb:='[]'::jsonb; route jsonb;
begin
 raw:=public.d5o_graybar_actions_pre_purchase_delegation_v1(p_workspace_key);
 for entry in select value from pg_catalog.jsonb_array_elements(raw) loop
  if entry->>'kind'='Approve Graybar PO' then
   route:=public.d5o_purchase_order_my_review_v1(p_workspace_key,entry->>'workId',
    (entry->>'decisionId')::uuid);
   if not coalesce((route->>'canReview')::boolean,false) then continue; end if;
  end if;
  output:=output||pg_catalog.jsonb_build_array(entry);
 end loop;
 return output;
end; $$;
revoke all on function public.d5o_graybar_actions_v1(text) from public,anon,service_role;
grant execute on function public.d5o_graybar_actions_v1(text) to authenticated;
