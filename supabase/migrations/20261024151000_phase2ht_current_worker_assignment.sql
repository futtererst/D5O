-- Keep superseded publications in schedule audit history, but expose only the
-- latest publication for each week as an employee's actionable assignment.
alter function public.d5o_hosted_worker_schedule_read_v1(text)
  rename to d5o_hosted_worker_schedule_read_pre_current_v1;
revoke all on function public.d5o_hosted_worker_schedule_read_pre_current_v1(text)
  from public,anon,authenticated,service_role;
create function public.d5o_hosted_worker_schedule_read_v1(p_workspace_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;v_workspace uuid;v_state jsonb;v_publications jsonb;
begin
  -- The existing read checks the authenticated worker, active membership,
  -- tenant status and current binding before any unscoped schedule is loaded.
  v_result:=public.d5o_hosted_worker_schedule_read_pre_current_v1(p_workspace_key);
  if pg_catalog.jsonb_typeof(v_result->'state')<>'object' then return v_result; end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select state into v_state from d5o_hosted.connected_schedule_states
    where workspace_id=v_workspace;
  select coalesce(pg_catalog.jsonb_agg(pub.value),'[]'::jsonb)
    into v_publications
    from pg_catalog.jsonb_array_elements(
      coalesce(v_result#>'{state,publications}','[]'::jsonb)) pub(value)
    where not exists(select 1 from pg_catalog.jsonb_array_elements(
      coalesce(v_state->'publications','[]'::jsonb)) newer(value)
      where newer.value->>'week'=pub.value->>'week'
        and newer.value->>'publishedAt'>pub.value->>'publishedAt');
  return pg_catalog.jsonb_set(v_result,'{state,publications}',v_publications);
end; $$;
revoke all on function public.d5o_hosted_worker_schedule_read_v1(text)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_worker_schedule_read_v1(text)
  to authenticated;

-- Preserve the original function OID's security checks and return contract for
-- existing PostgREST plans. Filter superseded weeks there too, so a cached
-- legacy plan cannot expose a stale task after reassignment.
create or replace function public.d5o_hosted_worker_schedule_read_pre_current_v1(
  p_workspace_key text) returns jsonb language plpgsql stable security definer
  set search_path='' as $$
declare v_actor uuid:=auth.uid();v_binding d5o_hosted.crew_bindings%rowtype;
  v_state d5o_hosted.connected_schedule_states%rowtype;v_scoped jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'worker_auth_required' using errcode='42501'; end if;
  select b.* into v_binding from d5o_hosted.crew_bindings b
    join d5o_hosted.workspaces w on w.id=b.workspace_id
    join d5o_hosted.memberships m on m.workspace_id=w.id
      and m.actor_user_id=v_actor and m.status='active' and m.role='field_worker'
    where w.workspace_key=p_workspace_key and w.status='active'
      and b.actor_user_id=v_actor and b.active;
  if not found then raise exception 'worker_binding_required' using errcode='42501'; end if;
  select * into v_state from d5o_hosted.connected_schedule_states
    where workspace_id=v_binding.workspace_id;
  if not found then return pg_catalog.jsonb_build_object('revision',0,'state',null); end if;
  v_scoped:=pg_catalog.jsonb_build_object('workspace',p_workspace_key,
    'schemaVersion',1,'anchorDate',v_state.state->'anchorDate',
    'revision',v_state.decision_revision,
    'draftRevision',v_state.state->'draftRevision',
    'assignments',(select coalesce(pg_catalog.jsonb_agg(a),'[]'::jsonb)
      from pg_catalog.jsonb_array_elements(v_state.state->'assignments') a
      where a->'people' ? v_binding.person
        and a->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
        and a->>'date'>=to_char(v_binding.created_at,'YYYY-MM-DD')),
    'availabilityBlocks','[]'::jsonb,'packageDemands','[]'::jsonb,
    'publications',(select coalesce(pg_catalog.jsonb_agg(
      (pub-'packageDemands')||pg_catalog.jsonb_build_object('assignments',
        (select pg_catalog.jsonb_agg(a) from pg_catalog.jsonb_array_elements(
          pub->'assignments') a where a->'people' ? v_binding.person))),
      '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(v_state.state->'publications') pub
      where (pub->>'publishedAt')::timestamptz>=v_binding.created_at
        and exists(select 1 from pg_catalog.jsonb_array_elements(
          pub->'assignments') a where a->'people' ? v_binding.person)
        and not exists(select 1 from pg_catalog.jsonb_array_elements(
          v_state.state->'publications') later
          where later->>'week'=pub->>'week'
            and (later->>'publishedAt')::timestamptz >
              (pub->>'publishedAt')::timestamptz)),
    'receipts',(select coalesce(pg_catalog.jsonb_agg(r),'[]'::jsonb)
      from pg_catalog.jsonb_array_elements(v_state.state->'receipts') r
      where r->>'recipient'=v_binding.person
        and r#>>'{recordedBy,id}'=v_actor::text));
  return pg_catalog.jsonb_build_object('person',v_binding.person,
    'revision',v_state.decision_revision,'state',v_scoped);
end; $$;
revoke all on function public.d5o_hosted_worker_schedule_read_pre_current_v1(text)
  from public,anon,authenticated,service_role;
