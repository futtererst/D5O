import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Baseline observations at f53aa891. Browser status changes only after a recorded
// authenticated action; an RPC fixture or rendered button is not browser evidence.
const rows = [
  ["Discover","create connected Work","d5o_hosted_create_connected_work_v1","admin/project_manager","intake fields","active tenant and entitlement","customer Work creation","connected-work form","BROWSER QUALIFIED"],
  ["Discover","record intake","d5o_hosted_pursuit_command_v1","project_manager","intake detail","created Work","Discover Work record","pilot Discover workspace","BACKEND ONLY"],
  ["Discover","submit intake handoff","d5o_hosted_pursuit_command_v1","project_manager","handoff basis","qualified intake","Discover handoff","pilot Discover workspace","BACKEND ONLY"],
  ["Discover","accept intake handoff","d5o_hosted_pursuit_command_v1","operations_leader","review reason","submitted handoff","Discover handoff","pilot Discover workspace","BACKEND ONLY"],
  ["Define","save scope draft","d5o_hosted_prototype_save_v1","admin/project_manager","scope, risk, requirements","accepted intake","Work definition","customer Define draft form","BROWSER QUALIFIED"],
  ["Define","record risk narrative","d5o_hosted_prototype_save_v1","admin/project_manager","risk narrative","accepted intake and pinned Define policy","Work definition","customer Define draft form","BROWSER QUALIFIED"],
  ["Define","submit scope","d5o_hosted_define_command_v1","admin/project_manager","reason","valid draft and pinned policy","Define task","customer Define button","BROWSER QUALIFIED"],
  ["Define","commercial review","d5o_hosted_define_command_v1","billing_commercial_lead/admin","decision reason","submitted scope and separation of duties","Define task","customer Define button","BROWSER QUALIFIED"],
  ["Define","delivery review","d5o_hosted_define_command_v1","operations_leader/project_manager","decision reason","submitted scope and separation of duties","Define task","customer Define button","BROWSER QUALIFIED"],
  ["Define","submit approved handoff","d5o_hosted_define_command_v1","admin/project_manager","reason","approved reviews","Define task","customer Define button","BROWSER QUALIFIED"],
  ["Define","accept approved handoff","d5o_hosted_define_command_v1","operations_leader","reason","submitted handoff and independent actor","Define task","customer Define button","BROWSER QUALIFIED"],
  ["Design","submit awarded Design handoff","d5o_hosted_design_handoff_command_v1","admin/project_manager","offer revision","customer award","connected handoff","none in customer Work","BACKEND ONLY"],
  ["Design","accept awarded Design handoff","d5o_hosted_design_handoff_command_v1","operations_leader","review reason","submitted handoff","connected handoff","none in customer Work","BACKEND ONLY"],
  ["Design","assign Design preparation","d5o_hosted_role_actions_v1","admin/project_manager","responsible owner","accepted Design handoff","role queue","My Work task from hosted state","UI EXISTS BUT UNVERIFIED"],
  ["Design","create connected package","d5o_hosted_create_connected_package_v2","admin/project_manager","name, owner","accepted Design handoff","catalog and Work","customer Design form added in 2H-R","UI EXISTS BUT UNVERIFIED"],
  ["Design","save document draft","d5o_hosted_design_draft_command_v1","admin/project_manager","title, source, requirements","connected package","Design state","customer Design form added in 2H-R","UI EXISTS BUT UNVERIFIED"],
  ["Design","save package basis","d5o_hosted_design_draft_command_v1","admin/project_manager","scope, method, completion basis","connected package, confirmed requirements","Design state","customer Design form added in 2H-R","UI EXISTS BUT UNVERIFIED"],
  ["Design","retain private PDF","d5o_hosted_register_design_document_evidence_v1","admin/project_manager","PDF, checksum","document Draft","private Storage custody","DesignDocumentEvidence reused in 2H-R","UI EXISTS BUT UNVERIFIED"],
  ["Design","submit document","d5o_hosted_design_review_command_v1","admin/project_manager","evidence ID","retained PDF","Design state","customer Design button added in 2H-R","UI EXISTS BUT UNVERIFIED"],
  ["Design","independently review document","d5o_hosted_design_review_command_v1","operations_leader","review note","submitted document, different actor","Design review task","customer Design form added in 2H-R","UI EXISTS BUT UNVERIFIED"],
  ["Design","issue approved document","d5o_hosted_design_review_command_v1","admin/project_manager","document revision","approved document, independent actor","Design state","customer Design button added in 2H-R","UI EXISTS BUT UNVERIFIED"],
  ["Design","save dated crew demand","d5o_hosted_design_demand_command_v1","admin/project_manager","qualification, hours, dated shift","package window","Design demand","customer Design form added in 2H-R","UI EXISTS BUT UNVERIFIED"],
  ["Design","review crew demand","d5o_hosted_design_release_command_v1","operations_leader","dated demand and qualification","saved demand before release","Design release readiness","customer Design readiness summary","UI EXISTS BUT UNVERIFIED"],
  ["Design","request package review","d5o_hosted_design_review_command_v1","admin/project_manager","discipline and due date","package basis","Design review task","customer Design form added in 2H-R","UI EXISTS BUT UNVERIFIED"],
  ["Design","independently decide package review","d5o_hosted_design_review_command_v1","operations_leader","decision note","requested review, different actor","Design review task","customer Design form added in 2H-R","UI EXISTS BUT UNVERIFIED"],
  ["Design","release package","d5o_hosted_design_release_command_v1","admin/project_manager","release reason, due date","issued document, reviews, demand, pinned policy","Design release","customer Design form added in 2H-R","UI EXISTS BUT UNVERIFIED"],
  ["Design","accept package receipt","d5o_hosted_design_release_command_v1","operations_leader","receipt reason","released package, independent actor","Design receipt task","customer Design button","BROWSER QUALIFIED"],
  ["Develop","select solution","d5o_hosted_solution_command_v1","project_manager","solution evidence","approved Define","solution record","pilot Develop UI","BACKEND ONLY"],
  ["Develop","verify workforce qualification","d5o_hosted_workforce_read_v1","operations_leader","qualification record","resource identity","workforce roster","pilot workforce UI","BACKEND ONLY"],
  ["Develop","select eligible resource","d5o_hosted_crew_command_v1","operations_leader","resource and package","accepted package and qualification","crew assignment","pilot scheduling UI","BACKEND ONLY"],
  ["Develop","approve service authorization","d5o_hosted_connected_service_approval_command_v1","authorized approver","amount and policy version","threshold decision","approval record","pilot authorization UI","BACKEND ONLY"],
  ["Develop","schedule qualified resource","d5o_hosted_crew_command_v1","operations_leader","resource, qualification, slot","accepted package and availability","schedule task","pilot scheduling UI","BACKEND ONLY"],
  ["Develop","acknowledge assignment","d5o_hosted_crew_command_v1","assigned resource","assignment decision","published roster and assignment","crew assignment","pilot scheduling UI","BACKEND ONLY"],
  ["Develop","authorize connected work","d5o_hosted_service_job_command_v1","authorized business role","approval decision","applicable pinned policy","authorization record","pilot service UI","BACKEND ONLY"],
  ["Develop","create executable job","d5o_hosted_service_job_command_v1","authorized business role","work and authorization","valid approval when required","job record","pilot service UI","BACKEND ONLY"],
  ["Deploy","start field work","d5o_hosted_field_start_command_v1","field_worker","assignment and start","authorized job","field task","pilot field UI","BACKEND ONLY"],
  ["Deploy","capture execution fact","d5o_hosted_field_fact_command_v1","field_worker","fact and provenance","started assignment","field task","pilot field UI","BACKEND ONLY"],
  ["Deploy","record inspection","d5o_hosted_field_fact_command_v1","field_worker","inspection fact","active field assignment","field task","pilot field UI","BACKEND ONLY"],
  ["Deploy","retain completion evidence","d5o_hosted_field_evidence_command_v1","field_worker","file and checksum","same-tenant work","evidence custody","pilot evidence UI","BACKEND ONLY"],
  ["Deploy","review completion evidence","d5o_hosted_field_evidence_command_v1","operations_leader","review decision","submitted evidence","review task","pilot field UI","BACKEND ONLY"],
  ["Deploy","record issue or exception","d5o_hosted_field_fact_command_v1","field_worker","issue detail","active field assignment","field issue","pilot field UI","BACKEND ONLY"],
  ["Deploy","submit completion","d5o_hosted_field_fact_command_v1","field_worker","completion fact","required evidence and inspection","field task","pilot field UI","BACKEND ONLY"],
  ["Deploy","record customer acceptance","d5o_hosted_acceptance_command_v1","authorized receiver","customer evidence","reviewed field completion","acceptance record","pilot Deploy UI","BACKEND ONLY"],
  ["Operate","receive completed Work","d5o_hosted_operate_command_v1","operations_leader","handoff reason","accepted Deploy","Operate task","customer Work button","UI EXISTS BUT UNVERIFIED"],
  ["Operate","review documentation","d5o_hosted_operate_command_v1","operations_leader","documentation evidence","received handoff","Operate task","pilot Operate UI","BACKEND ONLY"],
  ["Operate","accept support","d5o_hosted_operate_command_v1","operations_leader","acceptance reason","pinned documentation policy","Operate task","pilot Operate UI","BACKEND ONLY"],
  ["Operate","activate support","d5o_hosted_operate_command_v1","operations_leader","activation reason","accepted support","Operate task","customer Work button","UI EXISTS BUT UNVERIFIED"],
  ["Operate","financial closeout","d5o_hosted_job_finance_command_v1","finance user","financial evidence","independent billing readiness","finance task","pilot finance UI","BACKEND ONLY"]
];
const actions = rows.map(([phase,action,command,role,input,prerequisite,taskSource,browserControl,status],index)=>({
  id:`${phase.toLowerCase()}-${String(index+1).padStart(2,"0")}`,phase,action,
  authoritativeCommand:command,requiredRole:role,requiredInput:input,
  evidenceRequirement:input.includes("evidence") || input.includes("PDF") || input.includes("fact")
    ? input : "hosted decision event; specific provenance depends on the command",
  businessPrerequisites:prerequisite,taskSource,
  currentMyWorkBehavior:phase==="Define"?"actionable task":phase==="Design"?
    "2H-R derived task or Design Work action; browser qualification pending":"context or pilot task only",
  browserControl,apiAdapter:phase==="Define"?"/api/d5o-hosted/customer-work":phase==="Design"?
    "/api/d5o-hosted/customer-design-action (except handoff and receipt)":"pilot adapter or none",
  completionCondition:"hosted Work projection and audit event reflect the accepted command",
  nextResponsibility:"recalculate from authoritative Work projection after the decision",status,
  tenantScope:"active membership and Work ownership",
  revisionContract:"hosted source and decision revisions where applicable",
  auditSource:"hosted command event or custody record",qualificationEvidence:null
}));
const resultPath="docs/architecture/evidence/phase2hr-design-browser-results.json";
if(existsSync(resultPath)) {
  const result=JSON.parse(readFileSync(resultPath,"utf8"));
  const designPassed=["both tenants create a connected Design package and issue its document",
    "Design policy denies missing method and accepts reviewed package release"].every((name)=>
      result.tests?.some((test)=>test.name===name&&test.status==="PASS"));
  const buttons={"create connected package":"Create package","save document draft":"Save document draft",
    "save package basis":"Save package basis","retain private PDF":"Retain private PDF",
    "submit document":"Submit document for independent review",
    "independently review document":"Approve document",
    "issue approved document":"Issue approved document for use",
    "save dated crew demand":"Save dated crew demand",
    "request package review":"Request Engineering review",
    "independently decide package review":"Approve Engineering review",
    "release package":"Release for independent receipt",
    "accept package receipt":"Accept released package"};
  if(designPassed) for(const action of actions) {
    const button=buttons[action.action];
    if(!button) continue;
    if(["tenant_a_test","tenant_b_test"].every((tenant)=>
      result.designActions?.some((event)=>event.tenant===tenant&&event.button===button&&event.httpStatus===200))) {
      action.status="BROWSER QUALIFIED";
      action.qualificationEvidence=resultPath;
      action.currentMyWorkBehavior="actionable from current hosted Work projection";
    }
  }
}
const totals = actions.reduce((value,action)=>{value[action.status]=(value[action.status]??0)+1;return value;},{});
totals.requiredActions=actions.length;
totals.existingBackendCommands=actions.filter((action)=>action.authoritativeCommand.startsWith("d5o_hosted_")
  && !action.authoritativeCommand.endsWith("_read_v1") && action.authoritativeCommand!=="d5o_hosted_role_actions_v1").length;
totals.browserCoveragePercent=Math.round(100*(totals["BROWSER QUALIFIED"]??0)/actions.length);
writeFileSync("docs/architecture/D5O_PHASE2HR_ACTION_INVENTORY.json",
  JSON.stringify({baseline:"f53aa89192b776221067cc6a761248e87259f82e",actions,totals},null,2)+"\n");
console.log(JSON.stringify({actions:actions.length,totals}));
