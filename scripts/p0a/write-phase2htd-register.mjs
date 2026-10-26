import {readFileSync,writeFileSync} from "node:fs";
import {phase2htdCases} from "./phase2htd-case-contract.mjs";
const path="docs/architecture/evidence/phase2htd-closure-register.json";
let prior=[];
try {prior=JSON.parse(readFileSync(path,"utf8")).cases??[];} catch { /* initial register */ }
const byId=new Map(prior.map((item)=>[item.id,item]));
const cases=phase2htdCases.map((item)=>({...item,...byId.get(item.id)}));
let run=null;
try {run=JSON.parse(readFileSync("docs/architecture/evidence/phase2htd-targeted-results.json","utf8"));}
catch { /* pending first run */ }
const test=(name)=>run?.tests?.find((item)=>item.name===name&&item.status==="PASS");
const evidencePath="docs/architecture/evidence/phase2htd-targeted-results.json";
const resultMap=new Map((run?.tdCases??[]).map((item)=>[item.id,item]));
const aliases={
  A01:"ID-SUSPENDED-SESSION",D02:"ID-SUSPENDED-SESSION",
  A02:"ID-REMOVED-STALE-SESSION",A08:"ID-REMOVED-STALE-SESSION",
  D03:"ID-REMOVED-STALE-SESSION",A03:"TENANT-SUSPENDED-SERVICE",
  D04:"TENANT-SUSPENDED-SERVICE",A04:"ENTITLEMENT-SERVICE-API",
  A05:"FLAG-DIRECT-API-RPC",D05:"FLAG-DIRECT-API-RPC",
  A07:"CROSS-TENANT-AUTH-BOTH-WAYS",D01:"TASK-OTHER-ACTOR-COMPLETED"
};
for(const item of cases) {
  const result=resultMap.get(aliases[item.id]??item.id);
  if(result?.status==="PASS"&&run?.cleanup?.clean) {
    item.status="PASS";item.actual=result.actual;item.evidence=[evidencePath];
  }
}
if(test("both tenants authorize priced service and create one executable job through authenticated browser controls")
  && run?.cleanup?.clean) {
  const jobs=run.gateBJobs??[];
  if(jobs.length===2 && jobs[0].thresholdMinor===1000000
    && jobs[0].approvalRows===1 && jobs[1].thresholdMinor===2500000
    && jobs[1].approvalRows===0 && jobs.every((item)=>item.jobHttp===200)) {
    for(const [id,job] of [["R01",jobs[0]],["R02",jobs[1]]]) {
      const item=cases.find((entry)=>entry.id===id);
      item.status="PASS";item.actual={workId:job.workId,requestId:job.requestId,
        jobId:job.jobId,approvalRows:job.approvalRows,
        configurationVersionId:job.configurationVersionId};item.evidence=[evidencePath];
    }
  }
  if(run.serviceWrongRoleDenial==="42501") {
    const item=cases.find((entry)=>entry.id==="A06");
    item.status="PASS";item.actual={rpc:"42501"};item.evidence=[evidencePath];
  }
  if(jobs.every((item)=>item.forgedEvidenceHttp===409)) {
    const item=cases.find((entry)=>entry.id==="B12");
    item.status="PASS";item.actual={apiDenials:jobs.map((entry)=>entry.forgedEvidenceHttp)};
    item.evidence=[evidencePath];
  }
  if(jobs.every((item)=>item.myWorkCreationTaskResolved)) {
    const item=cases.find((entry)=>entry.id==="D10");
    item.status="PASS";item.actual={completedJobTasksRemoved:true};item.evidence=[evidencePath];
  }
}
const replay=test("service adapters reject forgery and replay without additional jobs")?.detail;
if(replay && run?.cleanup?.clean
  && replay.concurrentPostJob?.length===2
  && replay.concurrentPostJob.every((status)=>status===409)
  && replay.unchangedJobs?.every((count)=>count===1)) {
  const item=cases.find((entry)=>entry.id==="D09");
  item.status="PASS";item.actual={postJobHttp:replay.concurrentPostJob,
    primaryJobCounts:replay.unchangedJobs};item.evidence=[evidencePath];
}
const featureScope=(run?.gateASecurity??[]).find((item)=>item.case==="feature_scope");
if(featureScope && run?.cleanup?.clean && Object.values(featureScope)
  .filter((value)=>value==="allowed").length===5
  && featureScope.connectedMutation==="denied"
  && featureScope.directConnectedRpc==="denied") {
  const item=cases.find((entry)=>entry.id==="A09");
  item.status="PASS";item.actual=featureScope;item.evidence=[evidencePath];
}
// Connected-service tasks are derived from role and authoritative Work state.
// They have no employee-assignment transfer command; membership revocation and
// another authorized actor's completion are exercised separately in A08/D01.
const reassignment=cases.find((entry)=>entry.id==="D11");
reassignment.status="NOT APPLICABLE";
reassignment.actual="Connected-service My Work tasks have no assignee or reassignment command; role and active membership determine visibility.";
reassignment.evidence=["lib/d5o/hosted/customer-work-tasks.ts",evidencePath];
const source=JSON.parse(readFileSync("docs/architecture/evidence/phase2htc-closure-register.json","utf8"));
const regression=JSON.parse(readFileSync("docs/architecture/evidence/phase2htd-regression-summary.json","utf8"));
const inheritedCaseIds={
  "unauthenticated, wrong role, nonmember, suspended or removed member, stale session":["A01","A02","A06","A08"],
  "suspended tenant, disabled entitlement, disabled flag, assigned task without command role":["A03","A04","A05","A06"],
  "cross-tenant child request, authorization, approval, pricing, evidence, job in both directions":["A07","B04","B05","B09","B10","B11"],
  "forged workspace, parent Work, child request and job IDs":["A07","B12"],
  "missing, rejected, other-request, other-Work and other-tenant approval":["B04","B05","B15"],
  "changed estimate amount, scope, currency, config version and revoked approver":["B01","B02","B03","B14"],
  "forged, missing, deleted and foreign customer evidence":["B07","B08","B09","B10","B11","B12","B13"],
  "duplicate pricing, customer authorization, threshold approval, service authorization and job":["C01","C02","C04","C05","C06","C07"],
  "concurrent conflicting approval, authorization and job":["C01","C03","C04","C05"],
  "feature boundary for provisioning, organization, membership, configuration and ordinary Work":["A09"],
  "completed task, revised request, changed amount or scope, removed or suspended actor, suspended tenant, disabled feature, existing job and replayed task URL":["D01","D02","D03","D04","D05","D06","D07","D08","D09","D10","D11"]
};
const inheritedGroups=source.gates.filter((gate)=>["B","C","D"].includes(gate.id))
  .flatMap((gate)=>gate.cases.filter((item)=>item.status==="BLOCKED")
    .map((item)=>{
      const ids=inheritedCaseIds[item.name]??[];
      const results=ids.map((id)=>cases.find((entry)=>entry.id===id));
      const allResolved=ids.length>0&&results.every((entry)=>["PASS","NOT APPLICABLE"].includes(entry.status));
      const suiteRow=item.name==="inherited administration and six-phase checks";
      const suitesPassed=regression.suites.every((suite)=>suite.status==="PASS");
      // The inherited full-suite row is completed only when separate regression
      // results are recorded. No original historical M1 fixture is implied.
      const disposition=allResolved||suiteRow&&suitesPassed?"PASS":"BLOCKED";
      return {gate:gate.id,name:item.name,sourceStatus:item.status,
        atomicCaseIds:ids,disposition,
        reason:allResolved?"All mapped local atomic assertions executed; see case evidence and final regression report"
          :ids.length?"One or more mapped local assertions remain unverified"
          :suiteRow?"Phase 2H-TB Gate B remains 50/51: connected Work browser creation receipt absent; see final attempt evidence"
          :"Inherited regression suites require separate execution and results"};
    }));
if(run?.finishedAt) for(const item of cases) if(item.status==="PENDING") {
  item.status="BLOCKED";item.actual="No complete targeted assertion executed in this disposable run";
}
writeFileSync(path,JSON.stringify({sourceCommit:"88381435a965050402dcd423b4856115246459a3",
  sourceRegister:"docs/architecture/evidence/phase2htc-closure-register.json",
  inheritedGroups,cases},null,2)+"\n");
process.stdout.write(JSON.stringify({cases:cases.length,passed:cases.filter((item)=>item.status==="PASS").length,
  pending:cases.filter((item)=>item.status==="PENDING").length,
  inheritedBlocked:inheritedGroups.filter((item)=>item.disposition==="BLOCKED").length})+"\n");
