\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','df7c6bac-cf3f-4777-9547-7b62d503f441',true);
DO $$ DECLARE v jsonb; BEGIN
 v:=public.d5o_subcontract_command_v1('rybex','rybex-a19c324a519d413da82304cbb0ac3547','register-company',
 '{"name":"FICTIONAL Replay Probe Company","contactName":"Fictional Probe Contact","contactReference":"fictional-probe@example.test"}'::jsonb,
 'sub-race-replay-20261017',15,'a5d39607e70701931a0ee9bfc7d34a71');
 RAISE NOTICE 'first subject %',v->>'subjectId';
 v:=public.d5o_subcontract_command_v1('rybex','rybex-a19c324a519d413da82304cbb0ac3547','register-company',
 '{"name":"FICTIONAL Replay Probe Company","contactName":"Fictional Probe Contact","contactReference":"fictional-probe@example.test"}'::jsonb,
 'sub-race-replay-20261017',15,'a5d39607e70701931a0ee9bfc7d34a71');
 RAISE NOTICE 'identical replay %',v->>'subjectId';
 BEGIN
 PERFORM public.d5o_subcontract_command_v1('rybex','rybex-a19c324a519d413da82304cbb0ac3547','register-company',
 '{"name":"FICTIONAL Different Probe Company","contactName":"Fictional Probe Contact","contactReference":"fictional-probe@example.test"}'::jsonb,
 'sub-race-replay-20261017',15,'a5d39607e70701931a0ee9bfc7d34a71');
 RAISE NOTICE 'conflicting replay UNEXPECTED';
 EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'conflicting replay %',SQLERRM; END;
 BEGIN
 PERFORM public.d5o_subcontract_command_v1('rybex','rybex-a19c324a519d413da82304cbb0ac3547','register-company',
 '{"name":"FICTIONAL Other Probe Company","contactName":"Fictional Probe Contact","contactReference":"fictional-probe@example.test"}'::jsonb,
 'sub-stale-revision-20261017',14,'a5d39607e70701931a0ee9bfc7d34a71');
 RAISE NOTICE 'stale UNEXPECTED';
 EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'stale %',SQLERRM; END;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','17fa7a73-5fe4-4b32-a6ae-9f2762a2347f',true);
DO $$ BEGIN
 PERFORM public.d5o_subcontract_command_v1('rybex','rybex-a19c324a519d413da82304cbb0ac3547','register-company',
 '{"name":"FICTIONAL Wrong Role Probe","contactName":"Fictional Probe Contact","contactReference":"fictional-probe@example.test"}'::jsonb,
 'sub-wrong-role-20261017',15,'a5d39607e70701931a0ee9bfc7d34a71');
 RAISE NOTICE 'wrong role UNEXPECTED';
 EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'wrong role %',SQLERRM; END $$;
ROLLBACK;
