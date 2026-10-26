import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root=resolve(process.cwd());
const output=resolve(root,"docs/architecture/evidence/phase2f-regressions");
mkdirSync(output,{recursive:true});
const suites=[
  ["phase1","scripts/p0a/run-service-approval-phase1.mjs","phase1-two-tenant-results.json"],
  ["phase1b","scripts/p0a/run-connected-approval-phase1b.mjs","phase1b-connected-results.json"],
  ["phase2a","scripts/p0a/run-phase2a-organization.mjs","phase2a-two-tenant-results.json"],
  ["phase2b","scripts/p0a/run-phase2b-onboarding.mjs","phase2b-two-tenant-results.json"],
  ["phase2c","scripts/p0a/run-phase2c-enterprise-admin.mjs","phase2c-two-tenant-results.json"],
  ["phase2d","scripts/p0a/run-phase2d-six-phase-config.mjs","phase2d-two-tenant-results.json"],
  ["p0a","scripts/p0a/run-runtime-qualification.mjs","phase1-p0a-runtime-results.json"]
];
const result={sourceCommit:"8d536b4ce74282fe6c3a0e2dbb66b1752ca51ec2",
  startedAt:new Date().toISOString(),suites:{},staticChecks:{},blocked:[
    "Original sealed M1 RUN-MANIFEST.json absent",
    "Original historical connected pilot fixture absent",
    "Full authenticated fictional-tenant Work UI remains pilot gated"]};
for(const [name,script,file] of suites) {
  const run=spawnSync(process.execPath,[resolve(root,script)],{cwd:root,encoding:"utf8",shell:false});
  let summary=null;
  try {
    const source=resolve(root,"docs/architecture/evidence",file);
    summary=JSON.parse(readFileSync(source,"utf8")).summary;
    copyFileSync(source,resolve(output,`${name}.json`));
  } catch { /* A missing result is a failure, never a pass. */ }
  result.suites[name]={script,exitCode:run.status,summary,
    stdout:run.stdout.trim().slice(-1600),stderr:run.stderr.trim().slice(-1600)};
  console.log(JSON.stringify({name,exitCode:run.status,summary}));
}
for(const [name,script] of [
  ["phaseContract","scripts/qa-published-phase-contract.mjs"],
  ["phaseConfiguration","scripts/qa-phase-configuration.mjs"],
  ["scannerInvariant","scripts/p0a/verify-readiness-scanner.mjs"]]) {
  const run=spawnSync(process.execPath,[resolve(root,script)],{cwd:root,encoding:"utf8",shell:false});
  result.staticChecks[name]={exitCode:run.status,stdout:run.stdout.trim(),stderr:run.stderr.trim()};
  console.log(JSON.stringify({name,exitCode:run.status}));
}
result.finishedAt=new Date().toISOString();
writeFileSync(resolve(output,"summary.json"),JSON.stringify(result,null,2)+"\n");
if(Object.values(result.suites).some((item)=>item.exitCode!==0||!item.summary||
  item.summary.failed||item.summary.setupError||!item.summary.cleanupVerified)
  ||Object.values(result.staticChecks).some((item)=>item.exitCode!==0)) process.exitCode=1;
