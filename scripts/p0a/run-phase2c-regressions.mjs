import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root=resolve(process.cwd());
const destination=resolve(root,"docs/architecture/evidence/phase2c-regressions");
mkdirSync(destination,{recursive:true});
const suites=[
  ["phase1","scripts/p0a/run-service-approval-phase1.mjs","phase1-two-tenant-results.json"],
  ["phase1b","scripts/p0a/run-connected-approval-phase1b.mjs","phase1b-connected-results.json"],
  ["phase2a","scripts/p0a/run-phase2a-organization.mjs","phase2a-two-tenant-results.json"],
  ["phase2b","scripts/p0a/run-phase2b-onboarding.mjs","phase2b-two-tenant-results.json"],
  ["p0a","scripts/p0a/run-runtime-qualification.mjs","phase1-p0a-runtime-results.json"]
];
const result={baseline:"b4a4e5c43c3e3a78dc07191019dd0ba638bf4a63",
  startedAt:new Date().toISOString(),suites:{},staticChecks:{}};
for(const [name,script,evidence] of suites){
  const run=spawnSync(process.execPath,[resolve(root,script)],{cwd:root,encoding:"utf8",shell:false});
  const source=resolve(root,"docs/architecture/evidence",evidence);
  let summary=null;
  try {const body=JSON.parse(readFileSync(source,"utf8"));summary=body.summary;
    copyFileSync(source,resolve(destination,`${name}.json`));}
  catch { /* source absence is a failure, not a pass */ }
  result.suites[name]={script,exitCode:run.status,summary,
    stdout:run.stdout.trim().slice(-1200),stderr:run.stderr.trim().slice(-1200)};
  console.log(JSON.stringify({name,exitCode:run.status,summary}));
}
for(const [name,script] of [
  ["phaseContract","scripts/qa-published-phase-contract.mjs"],
  ["phaseConfiguration","scripts/qa-phase-configuration.mjs"],
  ["scannerInvariant","scripts/p0a/verify-readiness-scanner.mjs"]]){
  const run=spawnSync(process.execPath,[resolve(root,script)],{cwd:root,encoding:"utf8",shell:false});
  result.staticChecks[name]={exitCode:run.status,stdout:run.stdout.trim().slice(-1200),
    stderr:run.stderr.trim().slice(-1200)};
  console.log(JSON.stringify({name,exitCode:run.status}));
}
result.finishedAt=new Date().toISOString();
writeFileSync(resolve(destination,"summary.json"),JSON.stringify(result,null,2)+"\n");
if(Object.values(result.suites).some((item)=>item.exitCode!==0||!item.summary||
  item.summary.failed||item.summary.setupError||!item.summary.cleanupVerified)
  ||Object.values(result.staticChecks).some((item)=>item.exitCode!==0))process.exitCode=1;
