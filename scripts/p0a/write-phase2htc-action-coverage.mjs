import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";

const json=(path)=>JSON.parse(readFileSync(path,"utf8"));
const core=json("docs/architecture/D5O_PHASE2HS_ACTION_INVENTORY.json");
const journey=json("docs/architecture/evidence/phase2htc-two-tenant-results.json");
assert.equal(journey.summary.failed,0,"connected_browser_failed");
assert.equal(journey.summary.cleanupVerified,true,"fixture_cleanup_missing");
assert.equal(journey.gateBJobs?.length,2,"two_jobs_missing");
const expected={tenant_a_test:["open-request","approve-agreement","triage-request",
  "prepare-estimate","approve-pricing","request-approval","decide-approval",
  "authorize-service","create-job"],
tenant_b_test:["open-request","approve-agreement","triage-request",
  "prepare-estimate","approve-pricing","authorize-service","create-job"]};
const tenants=Object.fromEntries(Object.entries(expected).map(([tenant,actions])=>{
  const rows=(journey.serviceTaskNavigation??[]).filter((row)=>row.tenant===tenant);
  assert.deepEqual(rows.map((row)=>row.action),actions,`${tenant}:task_chain`);
  assert(rows.every((row)=>row.origin==="my_work_link"&&row.resolved),`${tenant}:task_resolution`);
  assert(rows.find((row)=>row.action==="create-job")?.urlReplayDenied,
    `${tenant}:job_task_url_replay`);
  const job=journey.gateBJobs.find((item)=>item.tenant===tenant);
  assert(job?.jobId,`${tenant}:job_id`);
  return [tenant,{requiredMyWorkEntries:actions.length,browserQualifiedMyWorkEntries:rows.length,
    actions:rows.map(({action,actor,id,workId,resolved,urlReplayDenied})=>({
      action,actor,taskId:id,workId,browserQualified:true,resolved,
      ...(urlReplayDenied?{urlReplayDenied}:{} )})),
    approvalRequired:job.approvalRequired,jobId:job.jobId,
    customerAuthorizationEvidenceId:job.customerEvidenceId}];
}));
const output={sourceCommit:journey.baseline,generatedAt:new Date().toISOString(),
  sourceEvidence:"docs/architecture/evidence/phase2htc-two-tenant-results.json",
  coreOperatingLifecycle:{source:"docs/architecture/D5O_PHASE2HS_ACTION_INVENTORY.json",
    requiredInventoryRows:core.totals.requiredActions,
    browserQualifiedInventoryRows:core.totals["BROWSER QUALIFIED"],
    duplicateInventoryRows:core.totals["DUPLICATE INVENTORY ENTRY"],
    note:"Connected-service extension entries are excluded from this denominator."},
  connectedServiceExtension:{tenantA:tenants.tenant_a_test,tenantB:tenants.tenant_b_test,
    totalRequiredMyWorkEntries:16,totalBrowserQualifiedMyWorkEntries:16,
    note:"Customer PDF upload and pricing submission are browser decisions inside an actionable task; they do not create additional My Work entries."}};
writeFileSync("docs/architecture/evidence/phase2htc-action-coverage.json",
  JSON.stringify(output,null,2)+"\n");
process.stdout.write(JSON.stringify({core:output.coreOperatingLifecycle,
  serviceTaskEntries:[tenants.tenant_a_test.actions.length,
    tenants.tenant_b_test.actions.length]})+"\n");
