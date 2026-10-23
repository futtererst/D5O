// The snapshot is only a draft source. The hosted Define decision command owns
// submission, reviews, handoff, audit events and the resulting phase state.
export const defineDraftFields = [
  "customerContact", "siteArea", "affectedSystems", "accessConstraints",
  "outcome", "excludedScope", "deliveryApproach", "milestones",
  "dependencies", "estimateBasis", "commercialTerms", "customerRepresentative",
  "agreementDate", "agreementBasis", "findingDetail", "findingSource",
  "requirementNeed", "requirementSource", "requirementOwner",
  "scopeDeliverable", "scopeBoundary", "scopeOwner", "acceptanceResult",
  "acceptanceMethod", "acceptanceProof", "acceptanceAuthority",
  "interfaceBoundary", "interfaceOwner", "interfaceCounterparty",
  "interfaceAgreement", "risks"
] as const;
export type DefineDraftField = typeof defineDraftFields[number];
export type DefineDraftInput = Record<DefineDraftField, string>;

export function parseDefineDraft(input: unknown): DefineDraftInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const source = input as Record<string, unknown>;
  if (Object.keys(source).some((key) => !defineDraftFields.includes(key as DefineDraftField))) return null;
  const result = {} as DefineDraftInput;
  for (const field of defineDraftFields) {
    const value = source[field];
    if (typeof value !== "string" || value.length > 2000) return null;
    result[field] = value.trim();
  }
  return result;
}

export function buildCustomerDefineDraft(values: DefineDraftInput, owner: string,
  prior?: Record<string, unknown>) {
  const object = (value: unknown): Record<string, unknown> => value && typeof value === "object"
    && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : [];
  const previousProject = object(prior?.project), previousControl = object(prior?.scopeControl);
  const previousRegisters = object(prior?.registers);
  const revision = typeof prior?.revision === "number" && Number.isInteger(prior.revision)
    ? prior.revision : 1;
  const requirementId = String(rows(previousControl.requirements)[0]?.id ?? "requirement-1");
  const scopeId = String(rows(previousRegisters.scope_items)[0]?.id ?? "scope-1");
  return {
    ...prior,
    revision, status: "Draft", owner, outcome: values.outcome,
    excludedScope: values.excludedScope, deliveryApproach: values.deliveryApproach,
    risks: values.risks,
    project: { ...previousProject, customerContact: values.customerContact, siteArea: values.siteArea,
      affectedSystems: values.affectedSystems, accessConstraints: values.accessConstraints },
    findings: [{ ...rows(prior?.findings)[0], id: String(rows(prior?.findings)[0]?.id ?? "finding-1"),
      kind: "Customer input", status: "Confirmed",
      detail: values.findingDetail, source: values.findingSource, author: owner,
      at: new Date().toISOString() }, ...rows(prior?.findings).slice(1)],
    clarifications: prior?.clarifications ?? [],
    scopeControl: {
      ...previousControl,
      requirements: [{ ...rows(previousControl.requirements)[0], id: requirementId, need: values.requirementNeed,
        source: values.requirementSource, owner: values.requirementOwner, state: "Confirmed" },
        ...rows(previousControl.requirements).slice(1)],
      interfaces: [{ ...rows(previousControl.interfaces)[0], id: String(rows(previousControl.interfaces)[0]?.id ?? "interface-1"),
        kind: "Technical", boundary: values.interfaceBoundary,
        owner: values.interfaceOwner, counterparty: values.interfaceCounterparty,
        agreement: values.interfaceAgreement }, ...rows(previousControl.interfaces).slice(1)],
      assumptions: previousControl.assumptions ?? [], customerAgreement: { ...object(previousControl.customerAgreement),
        representative: values.customerRepresentative,
        agreedAt: values.agreementDate, basis: values.agreementBasis }
    },
    registers: {
      ...previousRegisters,
      scope_items: [{ ...rows(previousRegisters.scope_items)[0], id: scopeId, requirementId,
        deliverable: values.scopeDeliverable,
        boundary: values.scopeBoundary, owner: values.scopeOwner }, ...rows(previousRegisters.scope_items).slice(1)],
      acceptance_criteria: [{ ...rows(previousRegisters.acceptance_criteria)[0],
        id: String(rows(previousRegisters.acceptance_criteria)[0]?.id ?? "accept-1"),
        scopeId, result: values.acceptanceResult,
        method: values.acceptanceMethod, proof: values.acceptanceProof,
        authority: values.acceptanceAuthority }, ...rows(previousRegisters.acceptance_criteria).slice(1)]
    },
    // Preserve fields controlled by other bounded draft editors and any
    // historical draft narrative; never import decisions from browser input.
    includedScope: prior?.includedScope ?? values.scopeDeliverable,
    acceptance: prior?.acceptance ?? values.acceptanceResult,
    milestones: values.milestones, dependencies: values.dependencies,
    estimateBasis: values.estimateBasis, commercialTerms: values.commercialTerms,
    history: prior?.history ?? []
  };
}
