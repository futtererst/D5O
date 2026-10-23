-- Select a named administrator for each workspace-wide internal Design cost rate review.
alter table d5o_hosted.spending_delegate_categories drop constraint spending_delegate_categories_category_check;
alter table d5o_hosted.spending_delegate_categories add constraint spending_delegate_categories_category_check
 check(category in ('work_authority','design_authority','design_commitment','purchase_order','subcontract_allocation','subcontract_agreement','subcontract_variation','field_labor_authority','internal_design_rate'));
alter table d5o_hosted.spending_delegate_rules drop constraint spending_delegate_rules_category_check;
alter table d5o_hosted.spending_delegate_rules add constraint spending_delegate_rules_category_check
 check(category in ('work_authority','design_authority','design_commitment','purchase_order','subcontract_allocation','subcontract_agreement','subcontract_variation','field_labor_authority','internal_design_rate'));

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
  if category not in ('work_authority','design_authority','design_commitment','purchase_order','subcontract_allocation','subcontract_agreement','subcontract_variation','field_labor_authority','internal_design_rate')
   or role_name not in ('admin','operations_leader')
   or (category in ('work_authority','purchase_order','subcontract_allocation','subcontract_agreement','subcontract_variation','field_labor_authority','internal_design_rate') and role_name<>'admin')
   or (category='internal_design_rate' and nullif(trim(coalesce(p_input->>'workTypeKey','')),'') is not null)
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

-- Workspace-wide rates have no Work Type. Reuse the established delegate/sponsor
-- ordering without inventing a Work Record to carry their approval.
create function d5o_hosted.spending_delegate_selected_workspace_v1(
 p_workspace uuid,p_category text,p_role text,p_amount bigint,p_currency text,
 p_preparer uuid,p_required_until date) returns uuid
 language sql stable security definer set search_path='' as $$
 select r.actor_user_id from d5o_hosted.spending_delegate_rules r
 join d5o_hosted.memberships m on m.workspace_id=r.workspace_id and m.actor_user_id=r.actor_user_id
 where r.workspace_id=p_workspace and r.category=p_category and r.status='Active'
  and r.role_name=p_role and m.role=p_role and m.status='active'
  and r.work_type_key is null and r.actor_user_id is distinct from p_preparer
  and r.currency=p_currency and r.max_minor>=p_amount
  and current_date between r.valid_from and r.valid_until
  and r.valid_until>=p_required_until
 order by case r.kind when 'delegate' then 0 else 1 end,r.max_minor,r.priority,r.id
 limit 1;
$$;
revoke all on function d5o_hosted.spending_delegate_selected_workspace_v1(uuid,text,text,bigint,text,uuid,date)
 from public,anon,authenticated,service_role;

-- The rate command still enforces the existing administrator role, independence,
-- currency, effective dates, overlap, revision and replay. Approval/return actor
-- selection runs in that same command transaction; retirement remains the
-- existing administrator safety action.
create function d5o_hosted.guard_internal_design_rate_delegate_v1() returns trigger
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); enabled_at timestamptz; chosen uuid; valued_minor bigint;
begin
 if old.status<>'Prepared' or new.status not in ('Approved','Returned') then return new; end if;
 select configured_at into enabled_at from d5o_hosted.spending_delegate_categories
  where workspace_id=new.workspace_id and category='internal_design_rate';
 if enabled_at is null or old.created_at<enabled_at then return new; end if;
 -- Compare the fully burdened cost per person-hour, rounded upward to a cent.
 valued_minor:=pg_catalog.ceil(old.base_rate_minor::numeric *
  (10000+old.burden_basis_points)::numeric / 10000)::bigint;
 chosen:=d5o_hosted.spending_delegate_selected_workspace_v1(new.workspace_id,
  'internal_design_rate','admin',valued_minor,old.currency,old.prepared_by,old.effective_until);
 if chosen is null then raise exception 'spending_delegate_or_sponsor_required' using errcode='23514'; end if;
 if actor is distinct from chosen then
  raise exception 'selected_spending_reviewer_required' using errcode='42501'; end if;
 return new;
end; $$;
revoke all on function d5o_hosted.guard_internal_design_rate_delegate_v1() from public,anon,authenticated,service_role;
create trigger guard_internal_design_rate_delegate before update on d5o_hosted.design_internal_rates
 for each row execute function d5o_hosted.guard_internal_design_rate_delegate_v1();

create function public.d5o_internal_design_rate_my_review_v1(
 p_workspace_key text,p_rate_id uuid) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; role_name text;
 rate d5o_hosted.design_internal_rates%rowtype; enabled_at timestamptz;
 chosen uuid; enabled boolean; valued_minor bigint;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then
  raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select role into role_name from d5o_hosted.memberships
  where workspace_id=ws and actor_user_id=actor and status='active';
 if role_name is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 if role_name<>'admin' then
  return pg_catalog.jsonb_build_object('pending',false,'canReview',false); end if;
 select * into rate from d5o_hosted.design_internal_rates
  where workspace_id=ws and id=p_rate_id;
 if rate.id is null or rate.status<>'Prepared' then
  return pg_catalog.jsonb_build_object('pending',false,'canReview',false); end if;
 select configured_at into enabled_at from d5o_hosted.spending_delegate_categories
  where workspace_id=ws and category='internal_design_rate';
 enabled:=enabled_at is not null and rate.created_at>=enabled_at;
 valued_minor:=pg_catalog.ceil(rate.base_rate_minor::numeric *
  (10000+rate.burden_basis_points)::numeric / 10000)::bigint;
 if enabled then
  chosen:=d5o_hosted.spending_delegate_selected_workspace_v1(ws,'internal_design_rate',
   'admin',valued_minor,rate.currency,rate.prepared_by,rate.effective_until); end if;
 return pg_catalog.jsonb_build_object('pending',true,'configured',enabled,
  'fullyBurdenedRateMinor',valued_minor,
  'canReview',case when enabled then coalesce(chosen=actor,false)
   else rate.prepared_by<>actor end,
  'held',enabled and chosen is null,
  'route',case when enabled and chosen is null then 'No eligible internal-rate delegate or sponsor is configured.'
   when enabled and chosen=actor then 'This exact internal-rate review is assigned to you.'
   when enabled then 'Waiting for the configured independent internal-rate reviewer.'
   else 'Existing independent administrator review applies to this earlier rate.' end);
end; $$;
revoke all on function public.d5o_internal_design_rate_my_review_v1(text,uuid)
 from public,anon,service_role;
grant execute on function public.d5o_internal_design_rate_my_review_v1(text,uuid) to authenticated;
