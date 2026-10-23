"use client";
import type { FormEvent } from "react";
import { defineDraftFields, type DefineDraftField, type DefineDraftInput } from "@/lib/d5o/hosted/customer-define-draft";

const labels: Record<DefineDraftField, string> = {
  customerContact: "Customer contact", siteArea: "Site or work area",
  affectedSystems: "Affected systems", accessConstraints: "Access constraints",
  outcome: "Expected outcome", excludedScope: "Excluded scope",
  deliveryApproach: "Delivery approach", milestones: "Delivery milestones",
  dependencies: "Dependencies", estimateBasis: "Estimate basis",
  commercialTerms: "Commercial terms", customerRepresentative: "Customer representative",
  agreementDate: "Customer agreement date", agreementBasis: "Customer agreement basis",
  findingDetail: "Confirmed finding", findingSource: "Finding source",
  requirementNeed: "Customer requirement", requirementSource: "Requirement source",
  requirementOwner: "Requirement owner", scopeDeliverable: "Scoped deliverable",
  scopeBoundary: "Scope boundary", scopeOwner: "Scope owner",
  acceptanceResult: "Acceptance result", acceptanceMethod: "Acceptance method",
  acceptanceProof: "Acceptance proof", acceptanceAuthority: "Acceptance authority",
  interfaceBoundary: "Interface boundary", interfaceOwner: "Interface owner",
  interfaceCounterparty: "Interface counterparty", interfaceAgreement: "Interface agreement",
  risks: "Risk narrative"
};
const groups: Array<{ title: string; fields: DefineDraftField[] }> = [
  { title: "Customer and delivery", fields: defineDraftFields.slice(0, 11) as DefineDraftField[] },
  { title: "Agreement and findings", fields: defineDraftFields.slice(11, 16) as DefineDraftField[] },
  { title: "Scope and acceptance", fields: defineDraftFields.slice(16, 26) as DefineDraftField[] },
  { title: "Interfaces and risk", fields: defineDraftFields.slice(26) as DefineDraftField[] }
];
type Draft = Record<string, unknown> | undefined;
function initialValue(draft: Draft, field: DefineDraftField) {
  const object = (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : {};
  const first = (value: unknown) => Array.isArray(value) && value.length ? object(value[0]) : {};
  const project = object(draft?.project), control = object(draft?.scopeControl);
  const agreement = object(control.customerAgreement), registers = object(draft?.registers);
  const finding = first(draft?.findings), requirement = first(control.requirements);
  const scope = first(registers.scope_items), acceptance = first(registers.acceptance_criteria);
  const iface = first(control.interfaces);
  const map: Record<DefineDraftField, unknown> = {
    customerContact: project.customerContact, siteArea: project.siteArea,
    affectedSystems: project.affectedSystems, accessConstraints: project.accessConstraints,
    outcome: draft?.outcome, excludedScope: draft?.excludedScope,
    deliveryApproach: draft?.deliveryApproach, milestones: draft?.milestones,
    dependencies: draft?.dependencies, estimateBasis: draft?.estimateBasis,
    commercialTerms: draft?.commercialTerms,
    customerRepresentative: agreement.representative, agreementDate: agreement.agreedAt,
    agreementBasis: agreement.basis, findingDetail: finding.detail,
    findingSource: finding.source, requirementNeed: requirement.need,
    requirementSource: requirement.source, requirementOwner: requirement.owner,
    scopeDeliverable: scope.deliverable, scopeBoundary: scope.boundary,
    scopeOwner: scope.owner, acceptanceResult: acceptance.result,
    acceptanceMethod: acceptance.method, acceptanceProof: acceptance.proof,
    acceptanceAuthority: acceptance.authority, interfaceBoundary: iface.boundary,
    interfaceOwner: iface.owner, interfaceCounterparty: iface.counterparty,
    interfaceAgreement: iface.agreement, risks: draft?.risks
  };
  return typeof map[field] === "string" ? map[field] as string : "";
}

export function CustomerDefineDraftForm({ draft, busy, onSave }: {
  draft: Draft; busy: boolean; onSave: (fields: DefineDraftInput) => Promise<void>;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values = {} as DefineDraftInput;
    for (const field of defineDraftFields) values[field] = String(data.get(field) ?? "").trim();
    await onSave(values);
  }
  return <form className="d5o-customer-define-draft" onSubmit={(event) => void submit(event)}>
    <h4>Prepare Define scope</h4>
    <p>Save the scope facts before requesting independent commercial and delivery review. Your tenant policy may require a risk narrative.</p>
    {groups.map((group) => <fieldset key={group.title}><legend>{group.title}</legend>
      {group.fields.map((field) => <label key={field} htmlFor={`define-${field}`}>
        {labels[field]}
        {field === "risks" || field === "outcome" || field === "findingDetail"
          ? <textarea id={`define-${field}`} name={field} rows={3} maxLength={2000}
              required={field !== "risks"} defaultValue={initialValue(draft, field)} />
          : <input id={`define-${field}`} name={field} type={field === "agreementDate" ? "date" : "text"}
              maxLength={2000} required defaultValue={initialValue(draft, field)} />}
      </label>)}
    </fieldset>)}
    <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save Define draft"}</button>
  </form>;
}
