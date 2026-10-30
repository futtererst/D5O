-- Early customer-tenant configuration pins a timezone and response hours but
-- predates responseCalendar. Use the existing legacy Business hours calendar
-- for those versions; explicit agreement or policy calendars still win.
do $migration$
declare
  v_original text;
  v_definition text;
  v_anchor text := 'coalesce(v_agreement->>''calendar'',v_policy->>''responseCalendar'')';
begin
  select pg_get_functiondef(
    'public.d5o_hosted_operate_command_internal_v1(text,text,text,jsonb,text,bigint,integer,integer)'::regprocedure)
    into v_original;
  if v_original is null then
    raise exception 'connected_operate_command_missing';
  end if;
  v_definition := replace(v_original, v_anchor,
    'coalesce(v_agreement->>''calendar'',v_policy->>''responseCalendar'',''Business hours'')');
  if v_definition = v_original then
    raise exception 'connected_operate_calendar_fallback_anchor_missing';
  end if;
  execute v_definition;
end $migration$;
