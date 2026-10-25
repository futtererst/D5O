import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";

const path="docs/architecture/evidence/phase2htc-closure-register.json";
const register=JSON.parse(readFileSync(path,"utf8"));
const calendar=JSON.parse(readFileSync(
  "docs/architecture/evidence/phase2htc-calendar-results.json","utf8"));
const journey=JSON.parse(readFileSync(
  "docs/architecture/evidence/phase2htc-two-tenant-results.json","utf8"));
const approval=JSON.parse(readFileSync(
  "docs/architecture/evidence/phase2htc-approval-integrity-results.json","utf8"));
const inherited=JSON.parse(readFileSync(
  "docs/architecture/evidence/phase2htc-inherited-gate-a-results.json","utf8"));
const coverage=JSON.parse(readFileSync(
  "docs/architecture/evidence/phase2htc-action-coverage.json","utf8"));
assert.equal(calendar.summary.failed,0);
assert.equal(journey.summary.failed,0);
assert.equal(approval.summary.failed,0);
assert.equal(inherited.summary.failed,0);
assert.equal(coverage.connectedServiceExtension.totalBrowserQualifiedMyWorkEntries,16);
const evidence={calendar:"docs/architecture/evidence/phase2htc-calendar-results.json",
  journey:"docs/architecture/evidence/phase2htc-two-tenant-results.json",
  approval:"docs/architecture/evidence/phase2htc-approval-integrity-results.json",
  inherited:"docs/architecture/evidence/phase2htc-inherited-gate-a-results.json",
  coverage:"docs/architecture/evidence/phase2htc-action-coverage.json",
  static:"docs/architecture/evidence/phase2htc-static-results.json"};
const pass=(name,source,note)=>({name,status:"PASS",evidence:[evidence[source]],...(note?{note}:{})});
const blocked=(name,note)=>({name,status:"BLOCKED",evidence:[],note});
const na=(name,note)=>({name,status:"NOT APPLICABLE",evidence:[evidence.calendar],note});
const gate=(id)=>register.gates.find((item)=>item.id===id);
const caseName=(entry)=>typeof entry==="string"?entry:entry.name;
const a=gate("A");
a.cases=a.cases.map((entry,index)=>index===5
  ? na(caseName(entry),"The supported calendar is an enumerated tenant configuration, not a tenant-owned calendar object; a foreign identifier is rejected as invalid.")
  : pass(caseName(entry),index<12?"calendar":"journey"));
a.status="PASS";a.evidence=[evidence.calendar,evidence.journey];
const b=gate("B");
b.cases=b.cases.map((entry,index)=>{
  const name=caseName(entry);
  if(index===9) return pass(name,"journey",
    "Exact and conflicting receipt replay, stale-state checks and completed task URL replay executed; other stale-task variants remain in the grouped cases below.");
  return blocked(name,([
    "Wrong role and nonmember were tested, but suspension, removal and stale-session service-adapter mutation were not all executed.",
    "The inherited feature suite covers general command scope; service-specific suspension and disablement through every adapter were not executed.",
    "B-to-A adapter reads and foreign RPC writes passed; the full bidirectional child/pricing/job matrix was not executed.",
    "Forged parent/request/evidence IDs passed, but no standalone forged job-ID lookup test ran.",
    "The Phase 1B suite covers missing and cross-request approval; rejected, foreign-Work and foreign-tenant combinations were not all rerun through the new adapter.",
    "Amount, scope, version and revoked approver are covered by Phase 1B; currency-change service-adapter qualification remains unexecuted.",
    "Forged and foreign evidence are rejected; deletion and wrong-child provenance were not each exercised.",
    "Exact and conflicting approval, authorization and job receipt replays passed; duplicate pricing and customer-evidence decisions were not all executed.",
    "Parallel post-job creation attempts passed; concurrent pending conflicting approval and preauthorization attempts were not executed.",
    "Receipt replay and stale completed job task passed.",
    "Inherited feature-scope checks ran, but the full service-disabled plus unrelated-administration matrix was not rerun in this package."
  ])[index]);
});
b.status="BLOCKED";b.evidence=[evidence.journey,evidence.approval];
const c=gate("C");
c.cases=c.cases.map((entry,index)=>index===9
  ? blocked(caseName(entry),"Completed task URL and job replay passed; revised request, removed/suspended actor, suspended tenant and disabled-feature task variants were not all exercised.")
  : pass(caseName(entry),"coverage"));
c.status="BLOCKED";c.evidence=[evidence.coverage,evidence.journey];
const d=gate("D");
d.cases=d.cases.map((entry,index)=>index===2
  ? blocked(caseName(entry),"Integrated six-phase journey passed, but the full listed inherited suites and historical pilot fixtures were not all run in this package.")
  : pass(caseName(entry),index===1?"approval":index===6?"coverage":
    [3,4,5].includes(index)?"static":"journey"));
d.status="BLOCKED";d.evidence=[evidence.journey,evidence.approval,
  evidence.inherited,evidence.coverage];
register.classification="PARTIAL";
register.finalizedAt=new Date().toISOString();
register.staticChecks={typecheck:"PASS",eslint:"PASS",productionBuild:"PASS"};
register.retryEvidence=[
  "docs/architecture/evidence/phase2htc-browser-retry-failure.json",
  "docs/architecture/evidence/phase2htc-my-work-route-retry-failure.json"];
writeFileSync(path,JSON.stringify(register,null,2)+"\n");
process.stdout.write(JSON.stringify({classification:register.classification,
  gates:register.gates.map(({id,status})=>({id,status}))})+"\n");
