-- The connected service job command must resolve the pinned work type by its
-- stable key. The published template labels it "Lifecycle Service", whereas
-- the historical command compared the mutable display name using a different
-- capital letter and denied a role that has a valid create right.
do $migration$
declare
  v_original text;
  v_definition text;
begin
  select pg_get_functiondef(
    'public.d5o_hosted_service_job_command_pre_approval_v1(text,text,text,date,text,text,bigint,bigint,integer)'::regprocedure)
    into v_original;
  v_definition := replace(v_original,
    'display_name=''Lifecycle service'' and status=''active''',
    'work_type_key=''lifecycle-service'' and status=''active''');
  if v_definition = v_original then
    raise exception 'connected_service_job_work_type_anchor_not_found';
  end if;
  execute v_definition;
end $migration$;
