-- Rollback-only typed-command and reviewer-route probe on fictional Hall S.
-- The local disposable target must be verified before execution.
begin;
set local role authenticated;
-- Use the retained fictional active administrator for configuration.
select pg_catalog.set_config('request.jwt.claim.sub','2c32b7d1-da29-47e5-ba4c-b61d4447c148',true);
select public.d5o_spending_delegate_command_v1('rybex','add',
 pg_catalog.jsonb_build_object('category','field_labor_authority','role','admin',
  'kind','delegate','actorId','e39648ff-1693-45f7-9ecf-368ac9ad6c22',
  'maxMinor','100000','currency','USD','priority','100',
  'validFrom',current_date,'validUntil',date '2026-12-31',
  'sourceReference','FICTIONAL-FIELD-LABOR-DELEGATION-PROBE'),
 'fictional-labor-delegate-rule-20261018',8);
select pg_catalog.set_config('request.jwt.claim.sub','df7c6bac-cf3f-4777-9547-7b62d503f441',true);
select pg_catalog.set_config('probe.subject',(public.d5o_labor_authority_command_v1('rybex',
 'rybex-a19c324a519d413da82304cbb0ac3547','prepare',
 pg_catalog.jsonb_build_object('capMinor','50000','rateMinor','7500',
  'rateVersion','FICTIONAL-75-V1','rateSource','Fictional local rate source',
  'rateBasis','Fictional fully burdened USD 75 per person-hour; no premium.',
  'scope','Fictional Hall S scheduled field effort for bounded review.',
  'conditions','Only current released scope and qualified published bookings.',
  'validFrom',current_date,'validUntil',date '2026-12-31'),
 'fictional-labor-delegate-prepare-20261018',0,
 'a5d39607e70701931a0ee9bfc7d34a71')->>'subjectId'),true);
do $$
declare subject uuid:=current_setting('probe.subject')::uuid; route jsonb; queue jsonb; position jsonb;
begin
 perform pg_catalog.set_config('request.jwt.claim.sub','2c32b7d1-da29-47e5-ba4c-b61d4447c148',true);
 route:=public.d5o_field_labor_my_review_v1('rybex',
  'rybex-a19c324a519d413da82304cbb0ac3547',subject);
 if route->>'canReview'<>'false' then raise exception 'wrong admin route %',route; end if;
 queue:=public.d5o_labor_authority_actions_v1('rybex');
 if exists(select 1 from pg_catalog.jsonb_array_elements(queue) x where x->>'decisionId'=subject::text)
  then raise exception 'wrong admin queue'; end if;
 begin
  perform public.d5o_labor_authority_command_v1('rybex',
   'rybex-a19c324a519d413da82304cbb0ac3547','return',
   pg_catalog.jsonb_build_object('authorityId',subject,'reason','Fictional wrong reviewer probe.'),
   'fictional-labor-delegate-wrong-20261018',1,
   'a5d39607e70701931a0ee9bfc7d34a71');
  raise exception 'wrong actor decided';
 exception when insufficient_privilege then
  raise notice 'wrong actor rejected by selected reviewer guard';
 end;
 position:=public.d5o_labor_authority_read_v1('rybex',
  'rybex-a19c324a519d413da82304cbb0ac3547');
 if position->>'revision'<>'1' then raise exception 'denial_mutated_revision %',position->>'revision'; end if;
 perform pg_catalog.set_config('request.jwt.claim.sub','e39648ff-1693-45f7-9ecf-368ac9ad6c22',true);
 route:=public.d5o_field_labor_my_review_v1('rybex',
  'rybex-a19c324a519d413da82304cbb0ac3547',subject);
 if route->>'canReview'<>'true' then raise exception 'selected route %',route; end if;
 queue:=public.d5o_labor_authority_actions_v1('rybex');
 if not exists(select 1 from pg_catalog.jsonb_array_elements(queue) x where x->>'decisionId'=subject::text)
  then raise exception 'selected review queue missing'; end if;
 perform public.d5o_labor_authority_command_v1('rybex',
  'rybex-a19c324a519d413da82304cbb0ac3547','return',
  pg_catalog.jsonb_build_object('authorityId',subject,'reason','Fictional selected reviewer returned this basis.'),
  'fictional-labor-delegate-return-20261018',1,
  'a5d39607e70701931a0ee9bfc7d34a71');
 route:=public.d5o_field_labor_my_review_v1('rybex',
  'rybex-a19c324a519d413da82304cbb0ac3547',subject);
 if route->>'pending'<>'false' then raise exception 'selected return missing'; end if;
 raise notice 'selected route, queue, decision and rollback-only history checks passed';
end $$;
rollback;
