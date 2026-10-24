import { readFileSync, writeFileSync } from "node:fs";

const baseline=JSON.parse(readFileSync("docs/architecture/D5O_PHASE2HR_ACTION_INVENTORY.json","utf8"));
const gate=JSON.parse(readFileSync("docs/architecture/evidence/phase2hs-design-gate-results.json","utf8"));
const developGate=JSON.parse(readFileSync("docs/architecture/evidence/phase2hs-develop-gate-results.json","utf8"));
const handoffs=[
  ["design-12","Send awarded Design handoff"],
  ["design-13","Accept awarded Design handoff"]
];
for(const [id,button] of handoffs) {
  if(!["tenant_a_test","tenant_b_test"].every((tenant)=>
    gate.designActions?.some((event)=>event.tenant===tenant && event.button===button
      && event.origin==="authenticated_browser_control" && event.httpStatus===200)))
    throw Error(`handoff_browser_evidence_missing:${id}`);
  const row=baseline.actions.find((item)=>item.id===id);
  row.previousStatus=row.status;
  row.status="BROWSER QUALIFIED";
  row.browserControl=`customer Design action: ${button}`;
  row.apiAdapter="/api/d5o-hosted/customer-design-action";
  row.qualificationEvidence="docs/architecture/evidence/phase2hs-design-gate-results.json";
}
const dispositions={
  "design-14":"d5o_hosted_role_actions_v1 is a read-only responsibility projection. Package creation records the responsible owner and supplies the actionable preparation task; there is no separate assignment mutation.",
  "design-23":"The hosted release command validates dated crew demand as part of package readiness. It has no separate employee demand-review decision; independent package reviews and release are already counted."
};
for(const [id,reason] of Object.entries(dispositions)) {
  const row=baseline.actions.find((item)=>item.id===id);
  row.previousStatus=row.status;
  row.status="DUPLICATE INVENTORY ENTRY";
  row.dispositionReason=reason;
  row.qualificationEvidence="docs/architecture/D5O_PHASE2HS_DESIGN_ACTION_RECONCILIATION.md";
}
const developActions=[
  ["develop-29","Save crew booking","Review workforce qualification and availability","d5o_hosted_workforce_read_v1","operations_leader"],
  ["develop-30","Save crew booking","Select eligible resource","d5o_hosted_crew_command_v1","operations_leader"],
  ["develop-32","Save crew booking","Schedule qualified resource","d5o_hosted_crew_command_v1","operations_leader"],
  ["develop-33","Acknowledge assignment","Acknowledge published assignment","d5o_hosted_crew_command_v1","field_worker"],
  ["develop-36","Submit economic authority","Prepare Work economic authority","d5o_purchase_authority_command_v1","project_manager"],
  ["develop-37","Approve economic authority","Independently approve economic authority","d5o_purchase_authority_command_v1","admin"],
  ["develop-38","Submit labor authority","Prepare field labor authority","d5o_labor_authority_command_v1","project_manager"],
  ["develop-39","Approve labor authority","Independently approve field labor authority","d5o_labor_authority_command_v1","admin"],
  ["develop-40","Publish crew week","Publish crew assignment","d5o_hosted_crew_command_v1","operations_leader"],
  ["develop-41","Authorize field start","Authorize field start","d5o_hosted_field_start_command_v1","operations_leader"]
];
for(const [id,button,action,command,role] of developActions) {
  if(!["tenant_a_test","tenant_b_test"].every((tenant)=>
    developGate.developActions?.some((event)=>event.tenant===tenant && event.button===button
      && event.origin==="authenticated_browser_control" && event.httpStatus===200
      && (button!=="Authorize field start" || event.developStatus==="completed"))))
    throw Error(`develop_browser_evidence_missing:${id}`);
  let row=baseline.actions.find((item)=>item.id===id);
  if(!row) {
    row={...baseline.actions.find((item)=>item.id==="develop-32"),id,action,
      authoritativeCommand:command,requiredRole:role};
    baseline.actions.push(row);
  }
  row.previousStatus=row.status;
  row.status="BROWSER QUALIFIED";
  row.browserControl=`customer Develop action: ${button}`;
  row.apiAdapter=button==="Acknowledge assignment" || ["Save crew booking","Publish crew week","Authorize field start"].includes(button)
    ? "/api/d5o-hosted/customer-develop-action" : "/api/d5o-hosted/customer-develop-authority";
  row.qualificationEvidence="docs/architecture/evidence/phase2hs-develop-gate-results.json";
}
const totals=baseline.actions.reduce((out,row)=>{
  out[row.status]=(out[row.status]??0)+1;
  return out;
},{});
totals.requiredActions=baseline.actions.length;
totals.browserCoveragePercent=Math.round(100*(totals["BROWSER QUALIFIED"]??0)/totals.requiredActions);
totals.mandatoryDesignActions=14;
totals.browserQualifiedMandatoryDesign=baseline.actions.filter((row)=>row.phase==="Design"
  && row.status==="BROWSER QUALIFIED").length;
totals.mandatoryDevelopActions=baseline.actions.filter((row)=>row.phase==="Develop").length;
totals.browserQualifiedMandatoryDevelop=baseline.actions.filter((row)=>row.phase==="Develop"
  && row.status==="BROWSER QUALIFIED").length;
const result={baseline:"d1537c2070eee6926ad227c69dcdc43418bb381d",
  sourceInventory:"D5O_PHASE2HR_ACTION_INVENTORY.json",actions:baseline.actions,totals,
  changeHistory:[
    {ids:handoffs.map(([id])=>id),from:"BACKEND ONLY",to:"BROWSER QUALIFIED",
      evidence:"phase2hs-design-gate-results.json"},
    {ids:Object.keys(dispositions),from:"UI EXISTS BUT UNVERIFIED",
      to:"DUPLICATE INVENTORY ENTRY",reason:"No distinct employee mutation exists; denominator retained."},
    {ids:developActions.filter(([id])=>Number(id.slice(-2))<=35).map(([id])=>id),
      from:"BACKEND ONLY",to:"BROWSER QUALIFIED",evidence:"phase2hs-develop-gate-results.json"},
    {ids:developActions.filter(([id])=>Number(id.slice(-2))>35).map(([id])=>id),
      from:"MISSING FROM INVENTORY",to:"BROWSER QUALIFIED",
      reason:"Add six distinct economic, labor, publication and field-start decisions; do not shrink the denominator.",
      evidence:"phase2hs-develop-gate-results.json"}
  ]};
writeFileSync("docs/architecture/D5O_PHASE2HS_ACTION_INVENTORY.json",JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(totals));
