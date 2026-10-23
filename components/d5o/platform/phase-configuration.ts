import type { WorkRecord, WorkspaceKey } from "./work-types";
import { defaultDesignControlPolicy, type DesignControlPolicy } from "./design-policy";
import { defaultDeployControlPolicy, type DeployControlPolicy } from "./deploy-policy";
import { defaultOperateControlPolicy, type OperateControlPolicy } from "./operate-policy";

export type PhaseKey = "discover" | "define" | "develop" | "design" | "deploy" | "operate";
export type ComponentKind = "reference" | "typed_field" | "item_register" | "requirement_set" | "decision" | "evidence_reference" | "calculated_summary";
export type FactKey = "discovery.need" | "discovery.fit" | "discovery.estimate.status" | "discovery.proposal.status" | "definition.outcome" | "definition.excludedScope" | "definition.deliveryApproach" | "definition.registers.scope_items" | "definition.registers.acceptance_criteria" | "definition.registers.milestones" | "definition.registers.dependencies" | "definition.registers.risks";
export type Rule = { key: string; fact: FactKey; operator: "present" | "equals" | "rows_complete"; value?: string; fields?: string[]; message: string; requiredAt: "draft" | "review" | "authorization" };
export type ComponentField = { key: string; label: string; kind: "text" | "date" | "select"; required: boolean; options?: string[] };
export type PhaseComponent = { key: string; label: string; kind: ComponentKind; help: string; source: "work" | "discover" | "define" | "delivery"; fields?: ComponentField[]; rules?: Rule[] };
export type PhaseDefinition = { key: PhaseKey; label: string; purpose: string; components: PhaseComponent[]; gate: string };
export type DecisionCheck = { op: "register" | "packages" | "package_coverage" | "package_facts" | "reviewed_evidence" | "lifecycle_action"; key?: string; field?: "installed" | "tested" | "accepted"; evidenceKind?: string; message: string; surface: "Plan" | "Execution" | "Evidence" | "Handoff" };
export type DecisionCheckResult = { check: DecisionCheck; met: boolean };
export type DecisionGuard = { stage: string; right: string; checks: DecisionCheck[] };
export type WorkTypeConfiguration = { schemaVersion: 1; version: string; workTypeKey: string; workTypeLabel: string; engineTemplateKey?: string; templatePack: string; phases: PhaseDefinition[]; decisionGuards?: DecisionGuard[]; designControls?: DesignControlPolicy; deployControls?: DeployControlPolicy; operateControls?: OperateControlPolicy };

type DecisionWork = Pick<WorkRecord, "phaseRegisters"> & { packages?: Array<{ id: string; installed: number; tested: number; accepted: number }>; evidence?: Array<{ kind: string; state: string }>; lifecycle?: Array<{ action: string; owner: string }> };
export function decisionCheckPhase(check: DecisionCheck): PhaseKey | null {
  if (check.key) {
    const phase = check.key.split(".")[0];
    return ["discover", "define", "develop", "design", "deploy", "operate"].includes(phase) ? phase as PhaseKey : null;
  }
  if (check.op === "packages") return "design";
  if (check.op === "package_facts" || check.op === "reviewed_evidence") return "deploy";
  if (check.op === "lifecycle_action") return "operate";
  return null;
}
export function decisionCheckResults(work: DecisionWork, config: WorkTypeConfiguration, stage: string, right: string): DecisionCheckResult[] {
  const guard = config.decisionGuards?.find((item) => item.stage === stage && item.right === right);
  if (!guard) return [];
  const packages = work.packages ?? [];
  return guard.checks.map((check) => {
    const storedRows = check.key ? work.phaseRegisters?.[check.key] : undefined;
    const rows = Array.isArray(storedRows) ? storedRows : [];
    const [phaseKey, componentKey] = check.key?.split(".") ?? [];
    const fields = config.phases.find((phase) => phase.key === phaseKey)?.components.find((component) => component.key === componentKey)?.fields ?? [];
    const complete = (row: Record<string, string>) => fields.filter((field) => field.required).every((field) => typeof row[field.key] === "string" && row[field.key].trim().length > 0);
    let met = false;
    switch (check.op) {
      case "register": met = rows.length > 0 && rows.every(complete); break;
      case "packages": met = packages.length > 0; break;
      case "package_coverage": met = packages.length > 0 && rows.length > 0 && rows.every((row) => complete(row) && packages.some((item) => item.id === row.package)) && packages.every((item) => rows.some((row) => row.package === item.id)); break;
      case "package_facts": met = packages.length > 0 && packages.every((item) => Boolean(check.field) && Number.isFinite(item[check.field!]) && item[check.field!] >= 100); break;
      case "reviewed_evidence": met = (work.evidence ?? []).some((item) => item.kind === check.evidenceKind && ["verified", "accepted"].includes(item.state)); break;
      case "lifecycle_action": met = (work.lifecycle ?? []).some((item) => item.action.trim() && item.owner.trim()); break;
    }
    return { check, met };
  });
}
export function evaluateDecisionGuard(work: DecisionWork, config: WorkTypeConfiguration, stage: string, right: string): DecisionCheck[] {
  return decisionCheckResults(work, config, stage, right).filter((item) => !item.met).map((item) => item.check);
}

const guard = (stage: string, right: string, checks: DecisionCheck[]): DecisionGuard => ({ stage, right, checks });
const check = (op: DecisionCheck["op"], message: string, surface: DecisionCheck["surface"], details: Partial<DecisionCheck> = {}): DecisionCheck => ({ op, message, surface, ...details });
const rybexDecisionGuards: DecisionGuard[] = [
  guard("Plan", "confirm-plan", [check("register", "Record a feasible solution option before confirming the plan.", "Plan", { key: "develop.solution_options" }), check("packages", "Create a controlled Work Package before confirming the plan.", "Plan"), check("package_coverage", "Link a complete verification plan to every controlled Work Package.", "Plan", { key: "design.verification_plan" })]),
  guard("Readiness", "authorize-readiness", [check("package_coverage", "Link a verification plan to each Work Package before release.", "Plan", { key: "design.verification_plan" })]),
  guard("Execution", "record-execution", [check("package_facts", "Record complete installed facts for every Work Package.", "Execution", { field: "installed" }), check("package_facts", "Record complete tested facts for every Work Package.", "Execution", { field: "tested" }), check("reviewed_evidence", "Review the required test proof before recording execution.", "Evidence", { evidenceKind: "Test result" })]),
  guard("Quality verification", "verify-quality", [check("reviewed_evidence", "Review certification test proof before quality verification.", "Evidence", { evidenceKind: "Test result" })]),
  guard("Customer acceptance", "accept-turnover", [check("reviewed_evidence", "Review the owner acceptance record before turnover.", "Evidence", { evidenceKind: "Acceptance record" })]),
  guard("Handoff", "close-work", [check("register", "Record a receiving obligation before closing handoff.", "Handoff", { key: "operate.handoff" }), check("lifecycle_action", "Assign a lifecycle action and owner before closing work.", "Handoff")]),
];
const rotorkDecisionGuards: DecisionGuard[] = [
  guard("Assessment", "complete-assessment", [check("register", "Record a feasible solution option before completing assessment.", "Plan", { key: "develop.solution_options" })]),
  guard("Paid pilot", "authorize-pilot", [check("packages", "Create the controlled pilot Work Package before authorization.", "Plan"), check("package_coverage", "Link a complete verification plan to every pilot Work Package.", "Plan", { key: "design.verification_plan" })]),
  guard("Paid pilot", "record-pilot-complete", [check("package_facts", "Record completed pilot work facts before pilot review.", "Execution", { field: "installed" }), check("reviewed_evidence", "Review pilot outcome proof before recording completion.", "Evidence", { evidenceKind: "Proof package" })]),
  guard("Pilot review", "review-pilot", [check("reviewed_evidence", "Review pilot outcome proof before recording the decision.", "Evidence", { evidenceKind: "Proof package" })]),
  guard("Commercial readiness", "confirm-commercial", []),
  guard("Rollout authorization", "authorize-rollout", [check("reviewed_evidence", "Review rollout decision proof before authorization.", "Evidence", { evidenceKind: "Proof package" })]),
  guard("Rollout tranche", "close-service", [check("register", "Record a receiving obligation before closing the tranche.", "Handoff", { key: "operate.handoff" }), check("lifecycle_action", "Assign the ongoing service action and owner.", "Handoff")]),
];

const rule = (key: string, fact: FactKey, operator: Rule["operator"], message: string, requiredAt: Rule["requiredAt"], value?: string): Rule => ({ key, fact, operator, value, message, requiredAt });
const rowRule = (key: string, fact: FactKey, fields: string[], message: string): Rule => ({ key, fact, operator: "rows_complete", fields, message, requiredAt: "review" });
const component = (key: string, label: string, kind: ComponentKind, help: string, source: PhaseComponent["source"], rules?: Rule[], fields?: ComponentField[]): PhaseComponent => ({ key, label, kind, help, source, rules, fields });
const field = (key: string, label: string, kind: ComponentField["kind"] = "text", options?: string[]): ComponentField => ({ key, label, kind, required: true, options });

const commonDiscover = [
  component("customer_need", "Customer need", "typed_field", "Record the result sought and its business purpose.", "discover", [rule("need-present", "discovery.need", "present", "Capture the customer need.", "review")], [field("need", "Customer need")]),
  component("qualification", "Qualification", "requirement_set", "Review fit before committing pursuit effort.", "discover", [rule("fit-qualified", "discovery.fit", "equals", "Qualify the pursuit or record a conditional disposition.", "review", "Qualified")], [field("fit", "Qualification outcome", "select", ["Unassessed", "Qualified", "Conditional", "Disqualified"])]),
  component("estimate", "Estimate revision", "item_register", "Price comes from a revisioned estimate, not a narrative summary.", "discover", [rule("estimate-approved", "discovery.estimate.status", "equals", "Approve the estimate revision before preparing an offer.", "authorization", "Approved")]),
  component("proposal", "Customer offer", "reference", "The offer references an exact approved estimate revision.", "discover", [rule("proposal-submitted", "discovery.proposal.status", "equals", "Approve and record submission of the proposal.", "authorization", "Submitted")]),
  component("customer_response", "Customer response", "decision", "Record the response against the submitted offer.", "discover"),
];
const commonDefine = [
  component("promised_outcome", "Promised outcome", "typed_field", "State the measurable result the customer expects.", "define", [rule("outcome-present", "definition.outcome", "present", "Define the promised outcome.", "review")]),
  component("scope_items", "Included scope", "item_register", "Identify each deliverable, boundary and accountable owner.", "define", [rowRule("scope-complete", "definition.registers.scope_items", ["deliverable", "boundary", "owner"], "Add a deliverable with its boundary and owner.")], [field("deliverable", "Deliverable"), field("boundary", "Scope boundary"), field("owner", "Owner")]),
  component("excluded_scope", "Excluded scope", "typed_field", "State customer responsibilities and explicit exclusions.", "define", [rule("exclusions-present", "definition.excludedScope", "present", "Record exclusions or an explicit none assessment.", "review")]),
  component("acceptance_criteria", "Acceptance criteria", "item_register", "Link each result to a method, proof and accepting authority.", "define", [rowRule("acceptance-complete", "definition.registers.acceptance_criteria", ["result", "method", "proof", "authority"], "Add an acceptance result, method, proof and authority.")], [field("result", "Result"), field("method", "Verification method"), field("proof", "Required proof"), field("authority", "Accepting authority")]),
  component("delivery_design", "Delivery approach", "typed_field", "Describe the delivery method and package strategy.", "define", [rule("approach-present", "definition.deliveryApproach", "present", "Record the delivery approach.", "review")]),
  component("milestones", "Milestones", "item_register", "Set controlled dates and owners.", "define", [rowRule("milestones-complete", "definition.registers.milestones", ["milestone", "dueDate", "owner"], "Add a dated milestone and owner.")], [field("milestone", "Milestone"), field("dueDate", "Due date", "date"), field("owner", "Owner")]),
  component("dependencies", "Dependencies", "item_register", "Identify required inputs and their owners.", "define", [rowRule("dependencies-complete", "definition.registers.dependencies", ["dependency", "owner", "neededBy"], "Add a dependency, owner and needed-by date.")], [field("dependency", "Dependency"), field("owner", "Owner"), field("neededBy", "Needed by", "date")]),
  component("commercial_source", "Commercial source", "reference", "Carry the exact Discover estimate and proposal status forward.", "discover", [rule("commercial-approved", "discovery.estimate.status", "equals", "The referenced estimate is not approved.", "review", "Approved")]),
  component("risks", "Risks and controls", "item_register", "Assign mitigation and ownership to material risks.", "define", [rowRule("risks-complete", "definition.registers.risks", ["risk", "control", "owner"], "Add a delivery risk, control and owner, or record a no-material-risk assessment.")], [field("risk", "Risk or assessment"), field("control", "Control or rationale"), field("owner", "Owner")]),
];
const futurePhase = (key: PhaseKey, label: string, purpose: string, gate: string, items: Array<[string, string, ComponentKind, ComponentField[]?]>): PhaseDefinition => ({ key, label, purpose, gate, components: items.map(([id, name, kind, fields]) => component(id, name, kind, "Review the connected Work Record control and record the required basis before the phase decision.", "delivery", undefined, fields)) });

function manifest(workTypeKey: string, workTypeLabel: string, templatePack: string, discoverExtra: PhaseComponent[], defineExtra: PhaseComponent[], phaseLabels: [string, string, string, string], decisionGuards?: DecisionGuard[]): WorkTypeConfiguration {
  return { schemaVersion: 1, version: "prototype-v1", workTypeKey, workTypeLabel, templatePack, decisionGuards, phases: [
    { key: "discover", label: "Discover", purpose: "Qualify demand, establish price and record the customer outcome.", gate: "Pursuit disposition", components: [component("demand_source", "Demand source", "reference", "Source and customer context.", "discover", undefined, [field("source", "Source", "select", ["Direct customer", "Existing customer", "Partner referral", "Formal tender", "Service renewal"]), field("procurement", "Procurement route", "select", ["Direct award", "Competitive bid", "Framework / call-off", "Paid pilot", "Renewal"]), { ...field("closeDate", "Target decision date", "date"), required: false }]), ...commonDiscover, ...discoverExtra] },
    { key: "define", label: "Define", purpose: "Turn the pursuit into a controlled delivery baseline.", gate: "Definition review", components: [...commonDefine, ...defineExtra] },
    futurePhase("develop", phaseLabels[0], "Select a feasible solution and resource model.", "Solution selection", [["solution_options", "Solution options", "item_register", [field("option", "Option"), field("benefit", "Expected benefit"), field("constraint", "Key constraint"), field("owner", "Assessment owner")]], ["capacity", "Capacity and dependencies", "requirement_set"], ["variance", "Commercial variance", "calculated_summary"]]),
    futurePhase("design", phaseLabels[1], "Release executable packages and verification method.", "Design release", [["work_packages", "Work packages", "item_register"], ["verification_plan", "Verification plan", "evidence_reference", [field("package", "Work package"), field("method", "Verification method"), field("proof", "Required proof"), field("authority", "Accepting authority")]], ["design_review", "Design review", "decision"]]),
    futurePhase("deploy", phaseLabels[2], "Perform, control, verify and accept work.", "Execution and acceptance", [["schedule", "Schedule and qualifications", "item_register"], ["execution_facts", "Execution facts", "item_register"], ["proof", "Proof package", "evidence_reference"], ["acceptance", "Acceptance", "decision"]]),
    futurePhase("operate", phaseLabels[3], "Transfer responsibility and protect lifecycle value.", "Handoff and lifecycle review", [["handoff", "Handoff obligations", "item_register", [field("obligation", "Handoff obligation"), field("recipient", "Receiving owner"), field("dueDate", "Due date", "date")]], ["service_actions", "Lifecycle actions", "item_register"], ["value", "Value and performance", "calculated_summary"]]),
  ] };
}

export const prototypePhaseConfigurations: Record<WorkspaceKey, WorkTypeConfiguration> = {
  rybex: manifest("technical-delivery", "Technical delivery", "Rybex reference pack", [component("bid_basis", "Bid and quantity basis", "item_register", "Costed quantities, units and assumptions.", "discover")], [component("turnover", "Certification and turnover", "evidence_reference", "Define test, verification and owner-acceptance proof.", "define")], ["Develop delivery", "Design packages", "Deploy and verify", "Operate and warranty"], rybexDecisionGuards),
  rotork: manifest("modernization-service", "Modernization service", "Rotork reference pack", [component("asset_assessment", "Asset assessment", "item_register", "Assess asset condition and pilot suitability.", "discover")], [component("pilot_success", "Pilot success measures", "item_register", "Specify the measured pilot outcome and rollout basis.", "define")], ["Develop solution", "Design pilot", "Deploy pilot and rollout", "Operate service"], rotorkDecisionGuards),
};

export const prototypeLifecycleConfigurations: Record<WorkspaceKey, WorkTypeConfiguration> = {
  rybex: manifest("lifecycle-service", "Lifecycle service", "Rybex lifecycle service reference pack", [component("service_need", "Service need and asset context", "item_register", "Identify the assessed site, installed assets and recurring service outcome.", "discover")], [component("service_obligations", "Service obligations", "item_register", "Define monitoring, response and acceptance obligations.", "define")], ["Develop service model", "Design service packages", "Deploy service", "Operate and monitor"]),
  rotork: manifest("lifecycle-service", "Lifecycle service", "Rotork lifecycle service reference pack", [component("asset_condition", "Asset condition", "item_register", "Identify reliability findings and the service opportunity.", "discover")], [component("reliability_measures", "Reliability measures", "item_register", "Define measured service outcomes and commercial obligations.", "define")], ["Develop service model", "Design service plan", "Deploy service", "Operate and optimize"]),
};

export const prototypePhaseConfigurationCatalog: Record<WorkspaceKey, WorkTypeConfiguration[]> = {
  rybex: [prototypePhaseConfigurations.rybex, prototypeLifecycleConfigurations.rybex],
  rotork: [prototypePhaseConfigurations.rotork, prototypeLifecycleConfigurations.rotork],
};

// A new publication template; published prototype-v1 manifests remain unchanged and valid.
// D1 owns qualification, D2 owns the scope baseline, and D3 owns the offer/award path.
export const stageAlignedPhaseConfigurationCatalog: Record<WorkspaceKey, WorkTypeConfiguration[]> = {
  rybex: prototypePhaseConfigurationCatalog.rybex.map(stageAlignedContract),
  rotork: prototypePhaseConfigurationCatalog.rotork.map(stageAlignedContract),
};

function stageAlignedContract(source: WorkTypeConfiguration): WorkTypeConfiguration {
  const copy = structuredClone(source);
  copy.version = "prototype-v2";
  copy.designControls = defaultDesignControlPolicy(copy.workTypeKey);
  copy.deployControls = defaultDeployControlPolicy(copy.workTypeKey);
  copy.operateControls = defaultOperateControlPolicy(copy.workTypeKey);
  const discover = copy.phases.find((phase) => phase.key === "discover")!;
  const define = copy.phases.find((phase) => phase.key === "define")!;
  const develop = copy.phases.find((phase) => phase.key === "develop")!;
  const commercialKeys = new Set(["estimate", "proposal", "customer_response", "bid_basis"]);
  const commercial = discover.components.filter((item) => commercialKeys.has(item.key));
  discover.components = discover.components.filter((item) => !commercialKeys.has(item.key));
  discover.purpose = "Qualify the need, govern pursuit spend and hand work to Define.";
  define.components = define.components.filter((item) => item.key !== "commercial_source");
  define.purpose = "Approve a versioned scope and acceptance baseline before Develop.";
  develop.components = [...develop.components, ...commercial.map((item) => ({ ...item, source: "discover" as const }))];
  develop.purpose = "Develop the solution, estimate, commercial offer and customer award.";
  return copy;
}

export function resolvePrototypePhaseConfiguration(workspace: WorkspaceKey, workType: string): WorkTypeConfiguration | null {
  const normalized = workType.trim().toLowerCase();
  return prototypePhaseConfigurationCatalog[workspace].find((config) => normalized === config.workTypeLabel.toLowerCase() || normalized === config.workTypeKey) ?? null;
}

const factValue = (work: WorkRecord | undefined, fact: FactKey): unknown => fact.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, work);
export function evaluateRule(work: WorkRecord | undefined, item: Rule): boolean {
  const value = factValue(work, item.fact);
  if (item.operator === "rows_complete") return Array.isArray(value) && value.length > 0 && value.every((row) => row && typeof row === "object" && Boolean(item.fields?.every((key) => typeof row[key] === "string" && row[key].trim().length > 0)));
  return item.operator === "present" ? typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null : value === item.value;
}
export function validatePhaseConfiguration(config: WorkTypeConfiguration): string[] {
  const errors: string[] = [];
  if (!config.workTypeKey || !config.version || config.schemaVersion !== 1) errors.push("Configuration identity or schema version is invalid.");
  const phaseKeys = new Set<string>();
  const componentKeys = new Set<string>();
  const ruleKeys = new Set<string>();
  for (const phase of config.phases) {
    if (phaseKeys.has(phase.key)) errors.push(`Duplicate phase: ${phase.key}`);
    phaseKeys.add(phase.key);
    if (!phase.gate || !phase.components.length) errors.push(`Phase ${phase.key} lacks a gate or components.`);
    for (const item of phase.components) {
      if (componentKeys.has(item.key)) errors.push(`Duplicate component key: ${item.key}`);
      componentKeys.add(item.key);
      for (const requirement of item.rules ?? []) {
        if (ruleKeys.has(requirement.key)) errors.push(`Duplicate rule key: ${requirement.key}`);
        ruleKeys.add(requirement.key);
        if (requirement.operator === "equals" && requirement.value === undefined) errors.push(`Rule ${requirement.key} lacks a comparison value.`);
        if (requirement.operator === "rows_complete" && (!item.fields?.length || !requirement.fields?.length || requirement.fields.some((key) => !item.fields?.some((field) => field.key === key)) || item.fields.some((field) => field.required && !requirement.fields?.includes(field.key)))) errors.push(`Rule ${requirement.key} lacks valid register fields.`);
      }
    }
  }
  for (const key of ["discover", "define", "develop", "design", "deploy", "operate"]) if (!phaseKeys.has(key)) errors.push(`Missing phase: ${key}`);
  if (config.decisionGuards) {
    const bindings = new Set<string>();
    for (const guard of config.decisionGuards) {
      const binding = `${guard.stage}:${guard.right}`;
      if (!guard.stage?.trim() || !guard.right?.trim() || bindings.has(binding) || !Array.isArray(guard.checks)) errors.push(`Invalid decision binding: ${binding}`);
      bindings.add(binding);
      for (const check of guard.checks ?? []) {
        if (!check.message?.trim() || !["Plan", "Execution", "Evidence", "Handoff"].includes(check.surface) || !["register", "packages", "package_coverage", "package_facts", "reviewed_evidence", "lifecycle_action"].includes(check.op)) errors.push(`Invalid decision check: ${binding}`);
        if (["register", "package_coverage"].includes(check.op)) {
          const [phaseKey, componentKey] = check.key?.split(".") ?? [];
          const component = config.phases.find((phase) => phase.key === phaseKey)?.components.find((item) => item.key === componentKey && item.fields?.length);
          if (!component || (check.op === "package_coverage" && !component.fields?.some((field) => field.key === "package" && field.required))) errors.push(`Decision check has no bound register: ${binding}`);
        }
        if (check.op === "package_facts" && !["installed", "tested", "accepted"].includes(check.field ?? "")) errors.push(`Decision check has no fact: ${binding}`);
        if (check.op === "reviewed_evidence" && !check.evidenceKind?.trim()) errors.push(`Decision check has no evidence kind: ${binding}`);
      }
    }
  }
  return errors;
}
