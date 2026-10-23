-- Revalidate exact accepted scope and all bill reservations at each new billing decision.
-- Historical bills remain unchanged; missing historical basis requires a reviewed correction.
alter table d5o_hosted.connected_job_bills add column basis jsonb;
create table d5o_hosted.connected_job_bill_history (
  workspace_id uuid not null,work_id uuid not null,bill_id uuid not null,
  revision integer not null,status text not null,lines jsonb not null,basis jsonb,
  reviewed_by uuid,review_reason text,
  actor_user_id uuid not null references auth.users(id),recorded_at timestamptz not null default now(),
  primary key(workspace_id,bill_id,revision),
  foreign key(bill_id) references d5o_hosted.connected_job_bills(id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
alter table d5o_hosted.connected_job_bill_history enable row level security;
revoke all on d5o_hosted.connected_job_bill_history from public,anon,authenticated,service_role;

create function d5o_hosted.validate_job_bill_v2(
  p_workspace uuid,p_work uuid,p_lines jsonb,p_exclude_bill uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_design d5o_hosted.connected_design_states%rowtype;
  v_deploy d5o_hosted.connected_deploy_states%rowtype;
  v_award jsonb;v_line jsonb;v_release jsonb;v_completion jsonb;v_turnover jsonb;
  v_evidence jsonb;v_basis jsonb:='[]'::jsonb;v_group record;
  v_quantity numeric;v_reserved numeric;v_mixed boolean;v_capacity numeric;
  v_contract bigint;v_allocated numeric;v_requested numeric;v_index integer:=0;
begin
  if pg_catalog.jsonb_typeof(p_lines)<>'array' or pg_catalog.jsonb_array_length(p_lines) not between 1 and 20 then
    raise exception 'billing_lines_required' using errcode='22023'; end if;
  select * into v_design from d5o_hosted.connected_design_states
    where workspace_id=p_workspace and work_id=p_work;
  select * into v_deploy from d5o_hosted.connected_deploy_states
    where workspace_id=p_workspace and work_id=p_work;
  if v_design.work_id is null or v_deploy.work_id is null then
    raise exception 'accepted_billing_scope_and_evidence_required' using errcode='23514'; end if;
  for v_line in select value from pg_catalog.jsonb_array_elements(p_lines) loop
    v_index:=v_index+1;
    if pg_catalog.jsonb_typeof(v_line)<>'object' or
      coalesce(v_line->>'scopeKind','Package')<>'Package' or
      length(coalesce(v_line->>'packageId',''))<3 then
      -- No separately accepted milestone or whole-scope allocation exists in this pilot.
      raise exception 'billing_scope_kind_unsupported' using errcode='23514'; end if;
    if coalesce(v_line->>'amountMinor','')!~'^\d+$' or
      (v_line->>'amountMinor')::numeric not between 1 and 1000000000000 or
      length(trim(coalesce(v_line->>'description','')))<5 or
      coalesce(v_line->>'evidenceId','')='' or
      coalesce(v_line->>'quantity','')!~'^\d+(\.\d{1,3})?$' or
      coalesce(v_line->>'unit','')='' then
      raise exception 'billing_line_invalid' using errcode='22023'; end if;
    v_quantity:=(v_line->>'quantity')::numeric;
    if v_quantity<=0 or v_quantity>1000000 then
      raise exception 'billing_quantity_invalid' using errcode='22023'; end if;
    select r into v_release from pg_catalog.jsonb_array_elements(
      coalesce(v_design.state->'releases','[]'::jsonb)) r
      where r->>'packageId'=v_line->>'packageId'
      order by r->>'issuedAt' desc limit 1;
    select c into v_completion from pg_catalog.jsonb_array_elements(
      coalesce(v_deploy.state->'completions','[]'::jsonb)) c
      where c->>'packageId'=v_line->>'packageId' and c->>'releaseId'=v_release->>'id'
        and c->>'status'='Reviewed' order by c->>'reviewedAt' desc limit 1;
    select t into v_turnover from pg_catalog.jsonb_array_elements(
      coalesce(v_deploy.state->'turnovers','[]'::jsonb)) t
      where t->>'packageId'=v_line->>'packageId' and t->>'status'='Client accepted'
        and t->>'receipt'='Accepted' and t->>'completionId'=v_completion->>'id'
        and t->'releaseIds' ? (v_release->>'id')
      order by t->>'acceptedAt' desc limit 1;
    select e into v_evidence from pg_catalog.jsonb_array_elements(
      coalesce(v_deploy.state->'evidence','[]'::jsonb)) e
      where e->>'id'=v_line->>'evidenceId' and e->>'packageId'=v_line->>'packageId'
        and e->>'releaseId'=v_release->>'id' and e->>'state'='Reviewed';
    if v_release is null or v_release->>'status'<>'Accepted' or
      v_completion is null or v_turnover is null or v_evidence is null then
      raise exception 'accepted_billing_scope_and_evidence_required' using errcode='23514'; end if;
    if v_release#>>'{snapshot,completionBasis,kind}'='Measured' then
      if v_line->>'unit' is distinct from v_completion->>'unit' or
        coalesce(v_completion->>'reviewedQuantity','')!~'^\d+(\.\d{1,3})?$' then
        raise exception 'billing_unit_or_completion_invalid' using errcode='23514'; end if;
    elsif v_quantity<>1 or v_line->>'unit'<>'scope' then
      raise exception 'billing_qualitative_scope_invalid' using errcode='23514'; end if;
    v_basis:=v_basis||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'lineIndex',v_index,'packageId',v_line->>'packageId','release',v_release,
      'completion',v_completion,'turnover',v_turnover,'evidence',v_evidence));
  end loop;
  for v_group in select line->>'packageId' package_id,
      sum((line->>'quantity')::numeric) quantity,
      min(line->>'unit') unit,count(distinct line->>'unit') unit_count
      from pg_catalog.jsonb_array_elements(p_lines) line group by line->>'packageId'
  loop
    if v_group.unit_count<>1 then
      raise exception 'billing_unit_conflict' using errcode='23514'; end if;
    select coalesce(sum((line->>'quantity')::numeric),0),
      coalesce(bool_or(line->>'unit' is distinct from v_group.unit),false)
      into v_reserved,v_mixed
      from d5o_hosted.connected_job_bills b,
        lateral pg_catalog.jsonb_array_elements(b.lines) line
      where b.workspace_id=p_workspace and b.work_id=p_work and b.status<>'Returned'
        and b.id is distinct from p_exclude_bill and line->>'packageId'=v_group.package_id;
    if v_mixed then raise exception 'billing_unit_conflict' using errcode='23514'; end if;
    select case when basis->'release'#>>'{snapshot,completionBasis,kind}'='Measured'
      then (basis->'completion'->>'reviewedQuantity')::numeric else 1 end
      into v_capacity from pg_catalog.jsonb_array_elements(v_basis) basis
      where basis->>'packageId'=v_group.package_id limit 1;
    if v_capacity is null or v_reserved+v_group.quantity>v_capacity then
      raise exception 'billing_exceeds_accepted_quantity' using errcode='23514'; end if;
  end loop;
  v_award:=d5o_hosted.job_finance_award_v1(p_workspace,p_work);
  if v_award is null or v_award#>>'{pricingBasis,currency}'<>'USD' then
    raise exception 'approved_usd_fixed_price_award_required' using errcode='23514'; end if;
  v_contract:=(v_award#>>'{pricingBasis,priceMinor}')::bigint;
  select v_contract+coalesce(sum(((c.facts#>>'{proposal,priceAmount}')::numeric*100)::bigint),0)
    into v_contract from d5o_hosted.connected_field_changes c
    where c.workspace_id=p_workspace and c.work_id=p_work and c.status='Resolved'
      and c.kind='Scope change' and c.facts ? 'customerAuthorization'
      and c.facts ? 'revisedReleaseId' and c.facts#>>'{proposal,currency}'='USD';
  select coalesce(sum((line->>'amountMinor')::numeric),0) into v_allocated
    from d5o_hosted.connected_job_bills b,lateral pg_catalog.jsonb_array_elements(b.lines) line
    where b.workspace_id=p_workspace and b.work_id=p_work and b.status<>'Returned'
      and b.id is distinct from p_exclude_bill;
  select coalesce(sum((line->>'amountMinor')::numeric),0) into v_requested
    from pg_catalog.jsonb_array_elements(p_lines) line;
  if v_allocated+v_requested>v_contract then
    raise exception 'billing_exceeds_authorized_contract' using errcode='23514'; end if;
  return pg_catalog.jsonb_build_object('currency','USD','contractMinor',v_contract,
    'designRevision',v_design.decision_revision,'deployRevision',v_deploy.decision_revision,
    'lines',v_basis);
end; $$;
revoke all on function d5o_hosted.validate_job_bill_v2(uuid,uuid,jsonb,uuid)
  from public,anon,authenticated,service_role;

alter function public.d5o_hosted_job_finance_command_v1(text,text,text,jsonb,text,integer)
  rename to job_finance_legacy_command_v1;
alter function public.job_finance_legacy_command_v1(text,text,text,jsonb,text,integer)
  set schema d5o_hosted;
revoke all on function d5o_hosted.job_finance_legacy_command_v1(text,text,text,jsonb,text,integer)
  from public,anon,authenticated,service_role;
create function public.d5o_hosted_job_finance_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,
  p_command_id text,p_expected_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_member d5o_hosted.memberships%rowtype;
  v_work d5o_hosted.work_records%rowtype;
  v_state d5o_hosted.connected_job_finance_states%rowtype;
  v_bill d5o_hosted.connected_job_bills%rowtype;
  v_receipt d5o_hosted.connected_job_finance_receipts%rowtype;
  v_fingerprint text;v_basis jsonb;v_result jsonb;v_id uuid;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null or
    p_action not in ('add-cost','set-remaining','draft-bill','revise-bill',
      'submit-bill','review-bill','return-unbilled','record-billed','record-paid') or
    pg_catalog.jsonb_typeof(p_input)<>'object' or
    length(coalesce(p_command_id,'')) not between 8 and 120 or
    p_expected_revision is null or p_expected_revision<0 then
    raise exception 'invalid_job_finance_command' using errcode='22023'; end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and actor_user_id=v_actor and status='active' for share;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id and l.work_id=w.id
    where w.workspace_id=v_workspace and l.presentation_id=p_presentation_id for update of w;
  if v_member.id is null or v_work.id is null or
    v_member.role not in ('project_manager','billing_commercial_lead') then
    raise exception 'job_finance_role_denied' using errcode='42501'; end if;
  select * into v_state from d5o_hosted.connected_job_finance_states
    where workspace_id=v_workspace and work_id=v_work.id for update;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_action,p_input,p_expected_revision)::text);
  select * into v_receipt from d5o_hosted.connected_job_finance_receipts
    where workspace_id=v_workspace and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id<>v_actor or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  if coalesce(v_state.revision,0)<>p_expected_revision then
    raise exception 'stale_job_finance' using errcode='23505'; end if;
  if p_action in ('revise-bill','submit-bill','review-bill','return-unbilled',
    'record-billed','record-paid') then
    if coalesce(p_input->>'billRevision','')!~'^\d+$' then
      raise exception 'bill_revision_required' using errcode='22023'; end if;
    select * into v_bill from d5o_hosted.connected_job_bills
      where workspace_id=v_workspace and work_id=v_work.id
        and id=(p_input->>'billId')::uuid for update;
    if v_bill.id is null then
      raise exception 'billing_record_missing' using errcode='23503'; end if;
    if v_bill.revision<>(p_input->>'billRevision')::integer then
      raise exception 'stale_bill_revision' using errcode='23505'; end if;
  end if;
  if p_action in ('revise-bill','return-unbilled') then
    insert into d5o_hosted.connected_job_bill_history(workspace_id,work_id,bill_id,
      revision,status,lines,basis,reviewed_by,review_reason,actor_user_id)
      values(v_workspace,v_work.id,v_bill.id,v_bill.revision,v_bill.status,
        v_bill.lines,v_bill.basis,v_bill.reviewed_by,v_bill.review_reason,v_actor)
      on conflict do nothing;
    if p_action='revise-bill' then
      if v_bill.prepared_by<>v_actor or v_bill.status not in ('Draft','Returned') or
        exists(select 1 from d5o_hosted.connected_job_cash_events
          where bill_id=v_bill.id) then
        raise exception 'billing_correction_denied' using errcode='42501'; end if;
      v_basis:=d5o_hosted.validate_job_bill_v2(v_workspace,v_work.id,
        p_input->'lines',v_bill.id);
      update d5o_hosted.connected_job_bills set lines=p_input->'lines',basis=v_basis,
        status='Draft',revision=revision+1,reviewed_by=null,review_reason=null
        where id=v_bill.id;
    else
      if v_member.role<>'billing_commercial_lead' or v_bill.status<>'Reviewed' or
        length(trim(coalesce(p_input->>'reason','')))<10 or
        exists(select 1 from d5o_hosted.connected_job_cash_events
          where bill_id=v_bill.id) then
        raise exception 'unbilled_return_denied' using errcode='42501'; end if;
      update d5o_hosted.connected_job_bills set status='Returned',revision=revision+1,
        reviewed_by=v_actor,review_reason=trim(p_input->>'reason') where id=v_bill.id;
    end if;
    update d5o_hosted.connected_job_finance_states set revision=revision+1
      where workspace_id=v_workspace and work_id=v_work.id;
    v_result:=pg_catalog.jsonb_build_object('id',v_bill.id,
      'revision',v_state.revision+1,'action',p_action);
    insert into d5o_hosted.connected_job_finance_events(workspace_id,work_id,revision,
      command_id,actor_user_id,membership_id,action,result)
      values(v_workspace,v_work.id,v_state.revision+1,p_command_id,v_actor,v_member.id,p_action,v_result);
    insert into d5o_hosted.connected_job_finance_receipts(workspace_id,command_id,
      actor_user_id,fingerprint,result)
      values(v_workspace,p_command_id,v_actor,v_fingerprint,v_result);
  else
    if p_action='draft-bill' then
      v_basis:=d5o_hosted.validate_job_bill_v2(v_workspace,v_work.id,p_input->'lines');
    elsif p_action='submit-bill' or
      p_action='review-bill' and p_input->>'decision'='Reviewed' or
      p_action='record-billed' then
      if v_bill.basis is null then
        raise exception 'billing_basis_missing_revise_required' using errcode='23514'; end if;
      v_basis:=d5o_hosted.validate_job_bill_v2(v_workspace,v_work.id,v_bill.lines,v_bill.id);
      if v_basis is distinct from v_bill.basis then
        raise exception 'stale_billing_source_basis' using errcode='23505'; end if;
    end if;
    v_result:=d5o_hosted.job_finance_legacy_command_v1(p_workspace_key,
      p_presentation_id,p_action,p_input,p_command_id,p_expected_revision);
    if p_action='draft-bill' then
      update d5o_hosted.connected_job_bills set basis=v_basis
        where id=(v_result->>'id')::uuid and workspace_id=v_workspace and work_id=v_work.id;
      v_bill.id:=(v_result->>'id')::uuid;
    end if;
  end if;
  if p_action in ('draft-bill','revise-bill','submit-bill','review-bill','return-unbilled') then
    select * into v_bill from d5o_hosted.connected_job_bills
      where id=coalesce(v_bill.id,(v_result->>'id')::uuid) and workspace_id=v_workspace;
    insert into d5o_hosted.connected_job_bill_history(workspace_id,work_id,bill_id,
      revision,status,lines,basis,reviewed_by,review_reason,actor_user_id)
      values(v_workspace,v_work.id,v_bill.id,v_bill.revision,v_bill.status,
        v_bill.lines,v_bill.basis,v_bill.reviewed_by,v_bill.review_reason,v_actor)
      on conflict do nothing;
  end if;
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_job_finance_command_v1(text,text,text,jsonb,text,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_job_finance_command_v1(text,text,text,jsonb,text,integer)
  to authenticated;

-- Read-only history exposes earlier returned and reviewed revisions without mutating them.
create or replace function public.d5o_hosted_job_finance_read_v1(p_workspace_key text,p_presentation_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_member d5o_hosted.memberships%rowtype;
  v_work uuid;v_award jsonb;v_state d5o_hosted.connected_job_finance_states%rowtype;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'membership_required' using errcode='42501'; end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and actor_user_id=v_actor and status='active';
  select work_id into v_work from d5o_hosted.work_identity_links
    where workspace_id=v_workspace and presentation_id=p_presentation_id;
  if v_member.id is null or v_member.role='field_worker' or v_work is null then
    raise exception 'job_finance_scope_denied' using errcode='42501'; end if;
  select * into v_state from d5o_hosted.connected_job_finance_states
    where workspace_id=v_workspace and work_id=v_work;
  v_award:=d5o_hosted.job_finance_award_v1(v_workspace,v_work);
  return pg_catalog.jsonb_build_object('revision',coalesce(v_state.revision,0),
    'currency',coalesce(v_state.currency,v_award#>>'{pricingBasis,currency}'),
    'baseline',v_award,'remainingForecastMinor',v_state.remaining_forecast_minor,
    'forecastSource',v_state.forecast_source,'forecastAt',v_state.forecast_at,
    'changes',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',c.id,'packageId',c.package_id,'revision',c.revision,
      'priceAmount',c.facts#>>'{proposal,priceAmount}',
      'currency',c.facts#>>'{proposal,currency}',
      'customerAuthorization',c.facts->'customerAuthorization',
      'revisedReleaseId',c.facts->>'revisedReleaseId') order by c.updated_at)
      from d5o_hosted.connected_field_changes c where c.workspace_id=v_workspace
        and c.work_id=v_work and c.status='Resolved' and c.kind='Scope change'
        and c.facts ? 'customerAuthorization' and c.facts ? 'revisedReleaseId'),'[]'::jsonb),
    'costs',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.recorded_at)
      from d5o_hosted.connected_job_costs x where x.workspace_id=v_workspace
        and x.work_id=v_work),'[]'::jsonb),
    'bills',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b) order by b.created_at)
      from d5o_hosted.connected_job_bills b where b.workspace_id=v_workspace
        and b.work_id=v_work),'[]'::jsonb),
    'billHistory',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(h) order by h.recorded_at,h.revision)
      from d5o_hosted.connected_job_bill_history h where h.workspace_id=v_workspace
        and h.work_id=v_work),'[]'::jsonb),
    'cashEvents',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) order by c.recorded_at)
      from d5o_hosted.connected_job_cash_events c where c.workspace_id=v_workspace
        and c.work_id=v_work),'[]'::jsonb));
end; $$;
revoke all on function public.d5o_hosted_job_finance_read_v1(text,text) from public,anon,service_role;
grant execute on function public.d5o_hosted_job_finance_read_v1(text,text) to authenticated;
