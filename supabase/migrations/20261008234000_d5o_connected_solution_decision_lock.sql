-- A server-only replacement writer does not confer solution-approval authority.
-- The current Develop UI may keep editing draft options, while a connected
-- solution review must move to an authenticated typed command.
create or replace function d5o_hosted.protected_work_record_v1(p_record jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'id',p_record->'id','workspace',p_record->'workspace',
    'stage',p_record->'stage','status',p_record->'status',
    'progress',p_record->'progress',
    'phaseConfigurationVersionId',p_record->'phaseConfigurationVersionId',
    'prototypeDecisionRights',p_record->'prototypeDecisionRights',
    'heldFrom',p_record->'heldFrom',
    'heldNextAction',p_record->'heldNextAction',
    'heldNextActionDue',p_record->'heldNextActionDue',
    'heldNextActionImpact',p_record->'heldNextActionImpact',
    'definitionStatus',case when p_record#>>'{definition,status}'='Draft'
      then null else p_record#>'{definition,status}' end,
    'definitionReviews',p_record#>'{definition,reviews}',
    'definitionBaselines',p_record#>'{definition,approvedBaselines}',
    'definitionReceipt',p_record#>'{definition,developHandoff}',
    'definitionDecisions',p_record#>'{definition,decisions}',
    'definitionLocked',case when p_record#>>'{definition,status}' is distinct from 'Draft'
      then p_record->'definition' else null end,
    'pursuit',p_record#>'{discovery,pursuitControl}',
    'solutionReview',p_record#>'{develop,review}',
    'estimateStatus',p_record#>'{discovery,estimate,status}',
    'estimateReview',p_record#>'{discovery,estimate,review}',
    'estimateHistory',p_record#>'{discovery,estimate,pricingHistory}',
    'proposalStatus',p_record#>'{discovery,proposal,status}',
    'proposalReview',p_record#>'{discovery,proposal,review}',
    'proposalSubmission',p_record#>'{discovery,proposal,submission}',
    'proposalSubmissionHistory',p_record#>'{discovery,proposal,submissionHistory}',
    'proposalResponses',p_record#>'{discovery,proposal,responseEvents}',
    'customerOutcome',p_record#>'{discovery,outcome}',
    'designReceipt',p_record#>'{discovery,designHandoff}',
    'design',p_record->'design','deploy',p_record->'deploy',
    'operate',p_record->'operate','serviceSource',p_record->'serviceSource');
$$;
revoke all on function d5o_hosted.protected_work_record_v1(jsonb)
  from public,anon,authenticated,service_role;
