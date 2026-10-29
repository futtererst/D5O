-- Run after the full migration chain. A raised exception fails the gate.
do $$
declare
  unsafe_count integer;
  legacy_count integer;
  anon_definer_count integer;
begin
  select count(*) into unsafe_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity
    and (
      has_table_privilege('anon', c.oid, 'SELECT')
      or has_table_privilege('anon', c.oid, 'INSERT')
      or has_table_privilege('authenticated', c.oid, 'SELECT')
      or has_table_privilege('authenticated', c.oid, 'INSERT')
    );

  if unsafe_count <> 0 then
    raise exception '% public tables are reachable without RLS', unsafe_count;
  end if;

  select count(*) into legacy_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname = any(array[
      'activity_events', 'attachments', 'budget_baseline_items', 'budget_baselines',
      'comments', 'contract_baselines', 'd5o_gates', 'entity_attachments',
      'flow_down_obligations', 'gate_artifacts', 'go_no_go_score_dimensions',
      'go_no_go_scores', 'notice_requirements', 'opportunity_documents',
      'opportunity_reviews', 'organizations', 'project_decisions', 'project_issues',
      'project_risks', 'project_setup_artifacts', 'schedule_baselines',
      'schedule_milestones', 'scope_matrix_items', 'status_history',
      'workflow_evidence_requirements', 'workflow_instances', 'workflow_signals',
      'workflow_source_links', 'workflow_transactions'
    ])
    and c.relrowsecurity
    and not has_table_privilege('anon', c.oid, 'SELECT')
    and not has_table_privilege('anon', c.oid, 'INSERT')
    and not has_table_privilege('authenticated', c.oid, 'SELECT')
    and not has_table_privilege('authenticated', c.oid, 'INSERT')
    and has_table_privilege('service_role', c.oid, 'SELECT')
    and has_table_privilege('service_role', c.oid, 'INSERT');

  if legacy_count <> 29 then
    raise exception 'Only % of 29 legacy public tables have the required role boundary', legacy_count;
  end if;

  select count(*) into anon_definer_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if anon_definer_count <> 0 then
    raise exception '% public SECURITY DEFINER functions allow anonymous execution', anon_definer_count;
  end if;
end
$$;
