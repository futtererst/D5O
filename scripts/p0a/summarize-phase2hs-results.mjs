import { readFileSync, writeFileSync } from "node:fs";

const base="docs/architecture/evidence/";
const read=(name)=>JSON.parse(readFileSync(`${base}${name}`,"utf8"));
const design=read("phase2hs-design-gate-results.json");
const develop=read("phase2hs-develop-gate-results.json");
const inherited=read("phase2hs-inherited-initial.json");
const correctedB=read("phase2hs-phase2b-rerun.json");
const correctedC=read("phase2hs-phase2c-rerun.json");
const connected=read("phase2hs-phase2g-rerun.json");
const approval=inherited.suites.phase1b;
const inventory=JSON.parse(readFileSync("docs/architecture/D5O_PHASE2HS_ACTION_INVENTORY.json","utf8"));
const summary={
  baseline:"d1537c2070eee6926ad227c69dcdc43418bb381d",
  generatedAt:new Date().toISOString(),
  gateA:design.summary,gateB:develop.summary,
  initialInheritedSweep:Object.fromEntries(Object.entries(inherited.suites)
    .map(([key,value])=>[key,{exitCode:value.exitCode,summary:value.summary}])),
  correctedReruns:{phase2b:correctedB.summary,phase2c:correctedC.summary},
  connectedPhase2g:connected.summary,
  phase1b:approval.summary,
  staticChecks:Object.fromEntries(Object.entries(inherited.staticChecks)
    .map(([key,value])=>[key,{exitCode:value.exitCode}])),
  actionCoverage:inventory.totals,
  historicalBlocked:["original sealed M1 RUN-MANIFEST.json",
    "historical connected pilot fixture", "full Deploy/Operate employee browser journey"],
  cleanupVerified:[design,develop,correctedB,correctedC,connected,approval]
    .every((item)=>item.summary.cleanupVerified)
};
writeFileSync(`${base}phase2hs-regression-summary.json`,JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify({gateA:summary.gateA,gateB:summary.gateB,
  correctedReruns:summary.correctedReruns,connectedPhase2g:summary.connectedPhase2g,
  actionCoverage:summary.actionCoverage}));
if([design,develop,correctedB,correctedC,connected,approval].some((item)=>item.summary.failed
  || item.summary.setupError || !item.summary.cleanupVerified)) process.exitCode=1;
