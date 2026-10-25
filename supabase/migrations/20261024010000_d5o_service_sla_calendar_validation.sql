-- Preserve the existing authoritative connected Operate command and its grants.
-- A missing holiday list previously made the business-hours predicate NULL,
-- so every candidate hour was skipped until sla_calendar_unresolvable.
do $migration$
declare
  v_definition text;
  v_original text;
  v_calendar text := 'coalesce(v_agreement->>''calendar'',v_policy->>''responseCalendar'')';
begin
  select pg_get_functiondef('public.d5o_hosted_operate_command_internal_v1(text,text,text,jsonb,text,bigint,integer,integer)'::regprocedure)
    into v_original;
  v_definition := replace(v_original,
    'not (v_policy->''holidayDates'' ? v_local::date::text)',
    'not (coalesce(v_policy->''holidayDates'',''[]''::jsonb) ? v_local::date::text)');
  if v_definition = v_original then
    raise exception 'connected_operate_calendar_guard_not_found';
  end if;
  v_original := v_definition;
  v_definition := replace(v_definition,
    'v_hours:=coalesce((v_agreement->>''responseHours'')::integer,',
    'if ' || v_calendar || ' is distinct from ''Continuous'' and '
      || v_calendar || ' is distinct from ''Business hours'' then '
      || 'raise exception ''service_calendar_invalid'' using errcode=''23514''; end if; '
      || 'if v_policy->''holidayDates'' is not null and '
      || 'jsonb_typeof(v_policy->''holidayDates'') <> ''array'' then '
      || 'raise exception ''service_calendar_invalid'' using errcode=''23514''; end if; '
      || 'v_hours:=coalesce((v_agreement->>''responseHours'')::integer,');
  if v_definition = v_original then
    raise exception 'connected_operate_calendar_validation_anchor_not_found';
  end if;
  execute v_definition;
end $migration$;
