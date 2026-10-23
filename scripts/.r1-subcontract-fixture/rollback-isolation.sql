BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','df7c6bac-cf3f-4777-9547-7b62d503f441',true);
DO $$ BEGIN
 BEGIN
 PERFORM public.d5o_subcontract_command_v1('other-tenant','rybex-a19c324a519d413da82304cbb0ac3547','register-company','{"name":"FICTIONAL Wrong Tenant","contactName":"Fictional Contact","contactReference":"fictional@example.test"}'::jsonb,'sub-cross-tenant-20261017',15,'a5d39607e70701931a0ee9bfc7d34a71');
 RAISE NOTICE 'cross tenant UNEXPECTED';
 EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'cross tenant %',SQLERRM; END;
 BEGIN
 UPDATE d5o_hosted.subcontract_states SET revision=revision+1 WHERE work_id='a19c324a-519d-413d-a823-04cbb0ac3547';
 RAISE NOTICE 'protected write UNEXPECTED';
 EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'protected write %',SQLERRM; END;
END $$;
ROLLBACK;
