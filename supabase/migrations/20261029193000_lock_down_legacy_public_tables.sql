-- Legacy public tables predate the hosted D5O schema. They must not be
-- reachable directly through PostgREST by anon or authenticated clients.
-- Server-owned legacy operations continue through service_role.
begin;

do $$
declare
  table_name text;
  privileged_function regprocedure;
  authenticated_was_allowed boolean;
begin
  foreach table_name in array array[
    'activity_events',
    'attachments',
    'budget_baseline_items',
    'budget_baselines',
    'comments',
    'contract_baselines',
    'd5o_gates',
    'entity_attachments',
    'flow_down_obligations',
    'gate_artifacts',
    'go_no_go_score_dimensions',
    'go_no_go_scores',
    'notice_requirements',
    'opportunity_documents',
    'opportunity_reviews',
    'organizations',
    'project_decisions',
    'project_issues',
    'project_risks',
    'project_setup_artifacts',
    'schedule_baselines',
    'schedule_milestones',
    'scope_matrix_items',
    'status_history',
    'workflow_evidence_requirements',
    'workflow_instances',
    'workflow_signals',
    'workflow_source_links',
    'workflow_transactions'
  ] loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise exception 'Expected legacy public table % is absent', table_name;
    end if;
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all privileges on table public.%I to service_role', table_name);
  end loop;

  -- PostgreSQL grants EXECUTE to PUBLIC on new functions by default. The
  -- legacy SECURITY DEFINER functions must require at least an authenticated
  -- caller, while service_role remains available to server-owned code.
  for privileged_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    authenticated_was_allowed := has_function_privilege('authenticated', privileged_function, 'EXECUTE');
    execute format('revoke execute on function %s from public, anon', privileged_function);
    if authenticated_was_allowed then
      execute format('grant execute on function %s to authenticated', privileged_function);
    end if;
    execute format('grant execute on function %s to service_role', privileged_function);
  end loop;
end
$$;

commit;
