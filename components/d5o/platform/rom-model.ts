import type { DefinitionRecord } from "./work-types";
import { evaluatePricing, type PricingInput, type PricingPolicy, type RomCoverage } from "./develop-pricing";

export type RomObligation = { id: string; label: string; kind: "Requirement" | "Acceptance" | "Interface" | "Milestone" | "Dependency"; sourceRevision: number; confirmed: boolean };

export function romObligations(definition: DefinitionRecord | undefined): RomObligation[] {
  if (!definition) return [];
  const revision = definition.revision;
  const requirements = (definition.scopeControl?.requirements ?? []).map((item) => ({ id: item.id, label: item.need, kind: "Requirement" as const, sourceRevision: revision, confirmed: item.state === "Confirmed" }));
  const acceptance = (definition.registers?.acceptance_criteria ?? []).map((item, index) => ({ id: item.id || `acceptance-${index + 1}`, label: item.result || item.method || "Acceptance criterion", kind: "Acceptance" as const, sourceRevision: revision, confirmed: true }));
  const interfaces = (definition.scopeControl?.interfaces ?? []).map((item) => ({ id: item.id, label: `${item.boundary} · ${item.counterparty}`, kind: "Interface" as const, sourceRevision: revision, confirmed: Boolean(item.agreement) }));
  const register = (key: "milestones" | "dependencies", kind: "Milestone" | "Dependency") => (definition.registers?.[key] ?? []).map((item, index) => ({ id: item.id || `${key}-${index + 1}`, label: Object.entries(item).filter(([name]) => name !== "id").map(([, value]) => value).filter(Boolean).join(" · "), kind, sourceRevision: revision, confirmed: true }));
  return [...requirements, ...acceptance, ...interfaces, ...register("milestones", "Milestone"), ...register("dependencies", "Dependency")];
}

export function assessRomCoverage(input: PricingInput, obligations: RomObligation[]): string[] {
  if (input.estimateMaturity !== "ROM") return [];
  const basis = input.romBasis;
  if (!basis) return ["Record requirement coverage and the ROM scenario basis."];
  const issues: string[] = [];
  const lineIds = new Set(input.lines.map((line) => line.id));
  const obligationIds = new Set(obligations.map((item) => item.id));
  if (obligationIds.size !== obligations.length) issues.push("The approved Define basis has duplicate obligation identities; correct the source before review.");
  for (const obligation of obligations) {
    const entries = basis.coverage.filter((item) => item.obligationId === obligation.id);
    if (entries.length !== 1 || entries[0].sourceRevision !== obligation.sourceRevision) { issues.push(`${obligation.label}: record one current coverage decision.`); continue; }
    const row = entries[0];
    if (row.treatment === "Excluded") issues.push(`${obligation.label}: approved scope cannot be excluded without a governed Define revision or deviation.`);
    if (row.treatment === "Unresolved") issues.push(`${obligation.label}: assign and resolve the estimating follow-up before ROM review.`);
    if ((row.treatment === "Line" || row.treatment === "Shared allowance") && (!row.lineIds.length || row.lineIds.some((id) => !lineIds.has(id)))) issues.push(`${obligation.label}: link valid estimating lines or an allowance.`);
    if (row.treatment === "Customer responsibility" && !row.rationale.trim()) issues.push(`${obligation.label}: cite the approved customer responsibility basis.`);
    if (!row.owner.trim() || !row.rationale.trim()) issues.push(`${obligation.label}: record the responsible owner and rationale.`);
  }
  if (basis.coverage.some((item) => !obligationIds.has(item.obligationId))) issues.push("Coverage contains an obligation outside the current Define revision.");
  for (const line of input.lines) {
    if (!line.quantityBasis?.trim() || !line.sourceKind || !line.sourceDate) issues.push(`${line.description}: retain quantity basis, source type and source date.`);
    if (line.manualRate === "0" || line.manualRate === "0.00") if (!line.noCostReason?.trim()) issues.push(`${line.description}: an explicit zero-cost reason is required.`);
  }
  const scenario = basis.installationScenario;
  if (!scenario || !lineIds.has(scenario.lineId) || !scenario.quantitySource.trim() || !scenario.rationale.trim() || scenario.units <= 0 || scenario.lowHoursPerUnit <= 0 || scenario.baseHoursPerUnit <= 0 || scenario.highHoursPerUnit <= 0 || !(scenario.lowHoursPerUnit <= scenario.baseHoursPerUnit && scenario.baseHoursPerUnit <= scenario.highHoursPerUnit)) issues.push("Record a sourced low/base/high installation-effort scenario.");
  else {
    const line = input.lines.find((item) => item.id === scenario.lineId)!;
    if (line.category !== "labor" || line.unit !== "person-hour" || Math.abs(Number(line.quantity) - scenario.units * scenario.baseHoursPerUnit) > 0.001) issues.push("Base installation hours must equal units × base person-hours per unit on the linked labor line.");
  }
  const communication = basis.communication;
  if (!communication || !communication.scope.trim() || !communication.assumptions.trim() ||
      !communication.informationNeeded.trim() || !communication.designValidation.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(communication.reviewDate))
    issues.push("Record the customer-facing scope, assumptions, information needed, review date and detailed-Design validation plan.");
  return issues;
}

export function romScenarioPrices(policy: PricingPolicy, input: PricingInput) {
  const scenario = input.romBasis?.installationScenario;
  if (!scenario) return null;
  const run = (hoursPerUnit: number) => evaluatePricing(policy, { ...input, lines: input.lines.map((line) => line.id === scenario.lineId ? { ...line, quantity: String(scenario.units * hoursPerUnit) } : line) });
  const prices = { low: run(scenario.lowHoursPerUnit), base: run(scenario.baseHoursPerUnit), high: run(scenario.highHoursPerUnit) };
  return [prices.low, prices.base, prices.high].some((item) => item.issues.length) ? null : prices;
}

export function updateRomCoverage(rows: RomCoverage[], row: RomCoverage): RomCoverage[] {
  return [...rows.filter((item) => item.obligationId !== row.obligationId), row];
}
