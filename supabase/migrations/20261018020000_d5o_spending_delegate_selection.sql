-- Pilot delegation routes existing Work and Design review rights to one active member.
-- A rule never grants a role that the underlying spending command does not permit.
create table d5o_hosted.spending_delegate_positions (
 workspace_id uuid primary key references d5o_hosted.workspaces(id), revision integer not null default 0
);
create table d5o_hosted.spending_delegate_categories (
 workspace_id uuid not null references d5o_hosted.workspaces(id), category text not null
  check (category in ('work_authority','design_authority','design_commitment')),
 configured_at timestamptz not null default now(),
 primary key(workspace_id,category)
);
create table d5o_hosted.spending_delegate_rules (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references d5o_hosted.workspaces(id),
 category text not null check (category in ('work_authority','design_authority','design_commitment')),
 kind text not null check (kind in ('delegate','sponsor')), actor_user_id uuid not null references auth.users(id),
 role_name text not null check (role_name in ('admin','operations_leader')),
 currency text not null check (currency ~ '^[A-Z]{3}$'), max_minor bigint not null check (max_minor>0),
 work_type_key text, priority integer not null default 100 check (priority between 0 and 1000),
 valid_from date not null, valid_until date not null check (valid_until>=valid_from),
 status text not null default 'Active' check (status in ('Active','Revoked')),
 source_reference text not null, configured_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), revoked_at timestamptz,
 unique(workspace_id,id)
);
create unique index spending_delegate_one_sponsor on d5o_hosted.spending_delegate_rules(workspace_id,category,role_name)
 where kind='sponsor' and status='Active';
create table d5o_hosted.spending_delegate_events (
 workspace_id uuid not null, revision integer not null, action text not null,
 command_id text not null, actor_user_id uuid not null references auth.users(id),
 membership_id uuid not null references d5o_hosted.memberships(id), rule_id uuid not null,
 basis jsonb not null, occurred_at timestamptz not null default now(),
 primary key(workspace_id,revision), unique(workspace_id,command_id)
);
create table d5o_hosted.spending_delegate_receipts (
 workspace_id uuid not null, command_id text not null, actor_user_id uuid not null references auth.users(id),
 fingerprint text not null, result jsonb not null, primary key(workspace_id,command_id)
);
alter table d5o_hosted.spending_delegate_positions enable row level security;
alter table d5o_hosted.spending_delegate_categories enable row level security;
alter table d5o_hosted.spending_delegate_rules enable row level security;
alter table d5o_hosted.spending_delegate_events enable row level security;
alter table d5o_hosted.spending_delegate_receipts enable row level security;
revoke all on d5o_hosted.spending_delegate_positions,d5o_hosted.spending_delegate_categories,
 d5o_hosted.spending_delegate_rules,d5o_hosted.spending_delegate_events,
 d5o_hosted.spending_delegate_receipts from public,anon,authenticated,service_role;

-- Null means the category was never enabled and retains its historical role check.
-- Once enabled, even revoking every rule leaves it held until an eligible rule is configured.
create function d5o_hosted.spending_delegate_selected_v1(
 p_workspace uuid,p_work uuid,p_category text,p_role text,p_amount bigint,p_currency text,
 p_preparer uuid,p_required_until date) returns uuid
 language sql stable security definer set search_path='' as $$
 select r.actor_user_id from d5o_hosted.spending_delegate_rules r
 join d5o_hosted.memberships m on m.workspace_id=r.workspace_id and m.actor_user_id=r.actor_user_id
 join d5o_hosted.work_records w on w.workspace_id=r.workspace_id and w.id=p_work
 where r.workspace_id=p_workspace and r.category=p_category and r.status='Active'
  and r.role_name=p_role and m.role=p_role and m.status='active'
  and r.actor_user_id is distinct from p_preparer and r.currency=p_currency
  and r.max_minor>=p_amount and current_date between r.valid_from and r.valid_until
  and r.valid_until>=p_required_until
  and (r.work_type_key is null or r.work_type_key=w.work_type_key)
 order by case r.kind when 'delegate' then 0 else 1 end,r.max_minor,r.priority,r.id
 limit 1;
$$;
revoke all on function d5o_hosted.spending_delegate_selected_v1(uuid,uuid,text,text,bigint,text,uuid,date)
 from public,anon,authenticated,service_role;

create function public.d5o_spending_delegate_read_v1(p_workspace_key text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; rev integer;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then
  raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 if not exists(select 1 from d5o_hosted.memberships where workspace_id=ws and actor_user_id=actor
   and status='active' and role='admin') then
  raise exception 'spending_configuration_admin_required' using errcode='42501'; end if;
 select revision into rev from d5o_hosted.spending_delegate_positions where workspace_id=ws;
 return pg_catalog.jsonb_build_object('revision',coalesce(rev,0),
  'members',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'actorId',m.actor_user_id,'role',m.role,'email',u.email) order by u.email)
   from d5o_hosted.memberships m join auth.users u on u.id=m.actor_user_id
   where m.workspace_id=ws and m.status='active' and m.role in ('admin','operations_leader')),'[]'::jsonb),
  'categories',coalesce((select pg_catalog.jsonb_agg(category order by category)
   from d5o_hosted.spending_delegate_categories where workspace_id=ws),'[]'::jsonb),
  'rules',coalesce((select pg_catalog.jsonb_agg(to_jsonb(r) order by r.created_at,r.id)
   from d5o_hosted.spending_delegate_rules r where r.workspace_id=ws),'[]'::jsonb));
end; $$;
revoke all on function public.d5o_spending_delegate_read_v1(text) from public,anon,service_role;
grant execute on function public.d5o_spending_delegate_read_v1(text) to authenticated;

create function public.d5o_spending_delegate_command_v1(
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
  if category not in ('work_authority','design_authority','design_commitment')
   or role_name not in ('admin','operations_leader')
   or (category='work_authority' and role_name<>'admin')
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
revoke all on function public.d5o_spending_delegate_command_v1(text,text,jsonb,text,integer)
 from public,anon,service_role;
grant execute on function public.d5o_spending_delegate_command_v1(text,text,jsonb,text,integer)
 to authenticated;

-- Existing command roles and independence checks run first. This trigger adds
-- actor-level selection to the consequential decision, including direct RPC use.
create function d5o_hosted.spending_delegate_decision_guard_v1() returns trigger
 language plpgsql security definer set search_path='' as $$
declare v_category text; required_role text; amount bigint; preparer uuid; needed_until date;
 enabled_at timestamptz;
 chosen uuid; decision_actor uuid:=auth.uid();
begin
 if old.status<>'Prepared' or new.status not in ('Approved','Returned') then return new; end if;
 if tg_table_name='purchase_authorities' then
  v_category:='work_authority'; required_role:='admin'; amount:=new.parent_cap_minor;
  preparer:=new.prepared_by; needed_until:=new.valid_until;
 elsif tg_table_name='design_spend_authorities' then
  v_category:='design_authority'; required_role:=new.source_snapshot->>'approverRole';
  amount:=new.cap_minor; preparer:=new.prepared_by; needed_until:=new.valid_until;
 else
  v_category:='design_commitment'; amount:=new.amount_minor; preparer:=new.prepared_by;
  select a.source_snapshot->>'approverRole',a.valid_until into required_role,needed_until
   from d5o_hosted.design_spend_authorities a where a.id=new.authority_id;
 end if;
 select c.configured_at into enabled_at from d5o_hosted.spending_delegate_categories c
  where c.workspace_id=new.workspace_id and c.category=v_category;
 -- A decision prepared before this feature was configured keeps its original role contract.
 if enabled_at is null or new.created_at<enabled_at then return new; end if;
 chosen:=d5o_hosted.spending_delegate_selected_v1(new.workspace_id,new.work_id,v_category,
  required_role,amount,new.currency,preparer,needed_until);
 if chosen is null then raise exception 'spending_delegate_or_sponsor_required' using errcode='23514'; end if;
 if decision_actor is distinct from chosen then
  raise exception 'selected_spending_reviewer_required' using errcode='42501'; end if;
 return new;
end; $$;
revoke all on function d5o_hosted.spending_delegate_decision_guard_v1() from public,anon,authenticated,service_role;
create trigger spending_delegate_work_review before update of status on d5o_hosted.purchase_authorities
 for each row execute function d5o_hosted.spending_delegate_decision_guard_v1();
create trigger spending_delegate_design_window_review before update of status on d5o_hosted.design_spend_authorities
 for each row execute function d5o_hosted.spending_delegate_decision_guard_v1();
create trigger spending_delegate_design_commitment_review before update of status on d5o_hosted.design_spend_commitments
 for each row execute function d5o_hosted.spending_delegate_decision_guard_v1();

-- A caller may learn only whether their own exact pending decision is routed to them.
create function public.d5o_spending_delegate_my_review_v1(
 p_workspace_key text,p_presentation_id text,p_category text,p_subject_id uuid) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; w uuid; role_name text; prepared_at timestamptz;
 amount bigint; preparer uuid; needed_until date; currency text; required_role text;
 enabled boolean; chosen uuid;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then
  raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select role into role_name from d5o_hosted.memberships where workspace_id=ws and actor_user_id=actor and status='active';
 select work_id into w from d5o_hosted.work_identity_links where workspace_id=ws and presentation_id=p_presentation_id;
 if role_name is null or w is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 if p_category='work_authority' then
  select parent_cap_minor,prepared_by,valid_until,currency,'admin',created_at into amount,preparer,needed_until,currency,required_role,prepared_at
   from d5o_hosted.purchase_authorities where workspace_id=ws and work_id=w and id=p_subject_id and status='Prepared';
 elsif p_category='design_authority' then
  select cap_minor,prepared_by,valid_until,currency,source_snapshot->>'approverRole',created_at
   into amount,preparer,needed_until,currency,required_role,prepared_at from d5o_hosted.design_spend_authorities
   where workspace_id=ws and work_id=w and id=p_subject_id and status='Prepared';
 elsif p_category='design_commitment' then
  select c.amount_minor,c.prepared_by,a.valid_until,c.currency,a.source_snapshot->>'approverRole',c.created_at
   into amount,preparer,needed_until,currency,required_role,prepared_at from d5o_hosted.design_spend_commitments c
   join d5o_hosted.design_spend_authorities a on a.id=c.authority_id
   where c.workspace_id=ws and c.work_id=w and c.id=p_subject_id and c.status='Prepared';
 else raise exception 'invalid_spending_category' using errcode='22023'; end if;
 if amount is null then return pg_catalog.jsonb_build_object('pending',false,'canReview',false); end if;
 select exists(select 1 from d5o_hosted.spending_delegate_categories
  where workspace_id=ws and category=p_category and configured_at<=prepared_at) into enabled;
 chosen:=case when enabled then d5o_hosted.spending_delegate_selected_v1(ws,w,p_category,
  required_role,amount,currency,preparer,needed_until) else null end;
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

-- The established queue still derives canonical tasks. Filter only decision cards
-- after role eligibility, using the same exact current selection as the trigger.
alter function public.d5o_purchase_authority_actions_v1(text) rename to d5o_purchase_authority_actions_pre_delegation_v1;
revoke all on function public.d5o_purchase_authority_actions_pre_delegation_v1(text) from public,anon,authenticated,service_role;
create function public.d5o_purchase_authority_actions_v1(p_workspace_key text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare raw jsonb; entry jsonb; output jsonb:='[]'::jsonb; route jsonb;
begin
 raw:=public.d5o_purchase_authority_actions_pre_delegation_v1(p_workspace_key);
 for entry in select value from pg_catalog.jsonb_array_elements(raw) loop
  if entry->>'focus'='authority-review' then
   route:=public.d5o_spending_delegate_my_review_v1(p_workspace_key,entry->>'workId',
    'work_authority',(entry->>'decisionId')::uuid);
   if not coalesce((route->>'canReview')::boolean,false) then continue; end if;
  end if;
  output:=output||pg_catalog.jsonb_build_array(entry);
 end loop;
 return output;
end; $$;
revoke all on function public.d5o_purchase_authority_actions_v1(text) from public,anon,service_role;
grant execute on function public.d5o_purchase_authority_actions_v1(text) to authenticated;

alter function public.d5o_hosted_design_spend_actions_v1(text) rename to d5o_hosted_design_spend_actions_pre_delegation_v1;
revoke all on function public.d5o_hosted_design_spend_actions_pre_delegation_v1(text) from public,anon,authenticated,service_role;
create function public.d5o_hosted_design_spend_actions_v1(p_workspace_key text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare raw jsonb; entry jsonb; output jsonb:='[]'::jsonb; route jsonb; category text;
begin
 raw:=public.d5o_hosted_design_spend_actions_pre_delegation_v1(p_workspace_key);
 for entry in select value from pg_catalog.jsonb_array_elements(raw) loop
  category:=case entry->>'focus' when 'design-spend-authority-review' then 'design_authority'
   when 'design-spend-commitment-review' then 'design_commitment' else null end;
  if category is not null then
   route:=public.d5o_spending_delegate_my_review_v1(p_workspace_key,entry->>'workId',
    category,(entry->>'decisionId')::uuid);
   if not coalesce((route->>'canReview')::boolean,false) then continue; end if;
  end if;
  output:=output||pg_catalog.jsonb_build_array(entry);
 end loop;
 return output;
end; $$;
revoke all on function public.d5o_hosted_design_spend_actions_v1(text) from public,anon,service_role;
grant execute on function public.d5o_hosted_design_spend_actions_v1(text) to authenticated;
