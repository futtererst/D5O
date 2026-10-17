\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;
DO $$ DECLARE v jsonb; d uuid; i uuid; x uuid; basis text:='a5d39607e70701931a0ee9bfc7d34a71'; ag text:='6f3457af-6379-424e-92e1-19fb8c0c9003'; BEGIN
 PERFORM set_config('request.jwt.claim.sub','df7c6bac-cf3f-4777-9547-7b62d503f441',true);
 v:=public.d5o_subcontract_command_v1('rybex','rybex-a19c324a519d413da82304cbb0ac3547','submit-deliverable',jsonb_build_object('agreementId',ag,'amountMinor',100000,'description','Fictional second independently reviewable technical appendix.','documentId','63ad0e78-bec3-45b4-a326-467c1bb62d31'),'sub-stale-delivery-20261017',15,basis); d:=(v->>'subjectId')::uuid;
 PERFORM set_config('request.jwt.claim.sub','17fa7a73-5fe4-4b32-a6ae-9f2762a2347f',true);
 v:=public.d5o_subcontract_command_v1('rybex','rybex-a19c324a519d413da82304cbb0ac3547','review-deliverable',jsonb_build_object('agreementId',ag,'deliverableId',d,'decision','Accepted','reason','Independent review accepts this fictional second technical appendix.'),'sub-stale-delivery-review-20261017',16,basis);
 PERFORM set_config('request.jwt.claim.sub','9dceac71-3f67-465b-89dc-41c935da52e6',true);
 v:=public.d5o_subcontract_command_v1('rybex','rybex-a19c324a519d413da82304cbb0ac3547','record-invoice',jsonb_build_object('agreementId',ag,'deliverableId',d,'amountMinor',100000,'invoiceNumber','FICTIONAL-INV-PROBE-002','documentId','3f7f46a6-81c3-49a3-8548-ec4ef5bdeddf'),'sub-stale-invoice-20261017',17,basis); i:=(v->>'subjectId')::uuid;
 PERFORM set_config('request.jwt.claim.sub','df7c6bac-cf3f-4777-9547-7b62d503f441',true);
 v:=public.d5o_subcontract_command_v1('rybex','rybex-a19c324a519d413da82304cbb0ac3547','prepare-variation',jsonb_build_object('agreementId',ag,'deltaMinor',10000,'scopeDifference','Fictional additional analysis appendix, not field work.','scheduleImpact','One day later','rationale','Fictional revision checks pending invoice matching.','documentId','1b0deef7-27e2-42a5-8511-894b29182bf0'),'sub-stale-var-20261017',18,basis); x:=(v->>'subjectId')::uuid;
 PERFORM set_config('request.jwt.claim.sub','e39648ff-1693-45f7-9ecf-368ac9ad6c22',true);
 v:=public.d5o_subcontract_command_v1('rybex','rybex-a19c324a519d413da82304cbb0ac3547','review-variation',jsonb_build_object('agreementId',ag,'variationId',x,'decision','Approved','reason','Independent fictional variation source revision probe.'),'sub-stale-var-review-20261017',19,basis);
 BEGIN
  PERFORM public.d5o_subcontract_command_v1('rybex','rybex-a19c324a519d413da82304cbb0ac3547','review-invoice',jsonb_build_object('agreementId',ag,'invoiceId',i,'decision','Matched','reason','Independent invoice review against revised basis.'),'sub-stale-invoice-review-20261017',20,basis);
  RAISE NOTICE 'stale_invoice UNEXPECTED_SUCCESS';
 EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'stale_invoice %',SQLERRM; END;
END $$;
ROLLBACK;
