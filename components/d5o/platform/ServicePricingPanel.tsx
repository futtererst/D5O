"use client";

import { useEffect, useState, type FormEvent } from "react";
import { evaluatePricing, formatMinor, type PricingCategory, type PricingInput, type PricingLine, type PricingPolicy } from "./develop-pricing";
import type { ServiceRequest } from "./operate-model";
import type { WorkRecord } from "./work-types";
import type { OperateCommand } from "@/lib/d5o/prototype-work/operate-command";
import { CustomerDecisionEvidence } from "./CustomerDecisionEvidence";
import style from "./OperateWorkspace.module.css";

type PolicyResponse = { policies: PricingPolicy[]; active?: { id: string; version: number } };
type Command = Omit<OperateCommand, "workId" | "expectedRevision" | "commandId">;
const categories: PricingCategory[] = ["labor", "material", "equipment", "subcontract", "travel", "mobilization", "setup", "recurring", "other"];
const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export function ServicePricingPanel({ work, request, hosted, busy, focused = false, onCommand }: { work: WorkRecord; request: ServiceRequest; hosted: boolean; busy: boolean; focused?: boolean; onCommand: (command: Command) => Promise<boolean> }) {
  const [policyState, setPolicyState] = useState<PolicyResponse | null>(null);
  const [lines, setLines] = useState<PricingLine[]>(() => request.serviceEstimate?.input.lines ?? []);
  const [riskBasis, setRiskBasis] = useState(request.serviceEstimate?.input.riskBasis ?? "");
  const [discount, setDiscount] = useState(request.serviceEstimate?.input.discountPercent ?? 0);
  const [authorizationEvidenceId, setAuthorizationEvidenceId] = useState("");
  const endpoint = hosted ? `/api/d5o-hosted/prototype-state?workspace=${encodeURIComponent(work.workspace)}&key=work&pricing=1` : "/api/work/prototype-state?pricing=1";
  useEffect(() => { let active = true; void fetch(endpoint, { cache: "no-store" }).then((response) => response.json()).then((body: PolicyResponse) => { if (active && Array.isArray(body.policies)) setPolicyState(body); }).catch(() => undefined); return () => { active = false; }; }, [endpoint]);
  const policy = policyState?.policies.find((item) => item.id === policyState.active?.id && item.version === policyState.active.version && item.status === "published");
  const input: PricingInput | null = policy ? { currency: policy.currency, workType: "Lifecycle service", customer: work.customer, region: work.site, pricedAt: new Date().toISOString().slice(0, 10), lines, discountPercent: discount, riskBasis, estimateMaturity: "Budgetary", definitionRevision: 0, solutionRevision: 0 } : null;
  const preview = policy && input ? evaluatePricing(policy, input) : null;
  const estimate = request.serviceEstimate;
  const currentCycle = estimate?.requestCycleAt === (request.reopenedAt ?? request.reportedAt);
  const authorizationCurrent = currentCycle && estimate?.status === "Approved" && request.serviceAuthorization?.estimateRevision === estimate.revision;
  const priceable = request.coverage === "Chargeable" || request.coverage === "Partially covered";

  function addLine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form), rateId = field(data, "rateId");
    const line: PricingLine = { id: crypto.randomUUID(), scopeRef: request.id, category: field(data, "category") as PricingCategory, description: field(data, "description"), quantity: field(data, "quantity"), unit: field(data, "unit"), rateId: rateId || undefined, manualRate: rateId ? undefined : field(data, "manualRate"), source: field(data, "source"), assumption: field(data, "assumption") };
    setLines((current) => [...current, line]); form.reset();
  }
  async function record(event: FormEvent<HTMLFormElement>, action: "approve-service-pricing" | "return-service-pricing" | "record-service-authorization") {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
    const saved = await onCommand({ action, requestId: request.id, estimateRevision: estimate?.revision,
      note: field(data, "note"), source: authorizationEvidenceId ? `evidence:${authorizationEvidenceId}` : field(data, "source"),
      evidenceId: authorizationEvidenceId, customerParty: field(data, "customerParty"),
      customerOrganization: field(data, "customerOrganization"), customerRole: field(data, "customerRole"),
      authorityBasis: field(data, "authorityBasis"), outcome: "Authorized",
      conditions: field(data, "conditions"), exclusions: field(data, "exclusions") });
    if (saved) form.reset();
  }

  return <details className={style.card} open={focused ? true : undefined}>
    <summary>Chargeable service estimate · {estimate ? `revision ${estimate.revision} ${estimate.status}` : "not started"}</summary>
    <p>Use the tenant’s published Develop pricing policy for this request. Pricing review, a source-backed customer authorization record, and permission to start field work are separate. Recording a customer name here is not an authenticated customer signature.</p>
    {work.canonicalWorkId ? <p>The connected pilot currently supports one sourced labor-rate line for this decision. Other cost methods need their own governed calculation before they can authorize service.</p> : null}
    {!priceable ? <p>Record an explicit chargeable or partially covered disposition before preparing this estimate.</p> : null}
    {request.coverage === "Partially covered" ? <p>Price only the uncovered scope. The agreement remains partially applicable; the estimate and customer decision do not reclassify it as Covered.</p> : null}
    {!policy ? <p>No active published pricing policy is available. A System Administrator must configure and activate one in Develop.</p> : <p>{policy.name} v{policy.version} · {policy.currency} · effective {policy.effectiveFrom}</p>}
    {request.serviceAuthorization ? <p>Customer authorization recorded: estimate r{request.serviceAuthorization.estimateRevision} · {formatMinor(request.serviceAuthorization.amountMinor, request.serviceAuthorization.currency)} · {request.serviceAuthorization.customerParty} · source {request.serviceAuthorization.source}{authorizationCurrent ? "" : " · historical, reassessment required"}</p> : null}
    {estimate ? <div className={style.row}><b>Saved estimate r{estimate.revision} · {estimate.status}</b><span>{formatMinor(estimate.evaluation.proposedPriceMinor, estimate.evaluation.currency)} · included-cost margin {estimate.evaluation.marginPercent?.toFixed(1) ?? "unknown"}% · policy {estimate.policySnapshot.id} v{estimate.policySnapshot.version}</span>{estimate.evaluation.issues.map((issue, index) => <small key={`${issue.code}-${index}`}>{issue.message} Next: {issue.action}</small>)}</div> : null}
    {policy && priceable ? <>
      <form className={style.form} onSubmit={addLine}><b>Build a sourced cost basis</b><label>Cost category<select name="category">{(work.canonicalWorkId ? categories.filter((item) => item === "labor") : categories).map((item) => <option key={item}>{item}</option>)}</select></label><label>Work performed or supplied<input name="description" required /></label><label>Quantity or hours<input name="quantity" type="number" min="0.001" step="0.001" required /></label><label>Unit<input name="unit" placeholder="hour, each, month" required /></label><label>Catalog rate ID<input name="rateId" list={`service-rates-${request.id}`} placeholder="Choose an applicable published rate" required={!!work.canonicalWorkId} /></label><datalist id={`service-rates-${request.id}`}>{policy.rates.map((rate) => <option key={`${rate.id}-${rate.scope.kind}`} value={rate.id}>{rate.label} · {rate.unit} · {rate.scope.kind}</option>)}</datalist>{!work.canonicalWorkId ? <label>Manual quoted unit cost<input name="manualRate" placeholder={`Amount in ${policy.currency}; leave blank for catalog rate`} /></label> : null}<label>Rate or quote source<input name="source" required /></label><label>Quantity / cost assumption<input name="assumption" required /></label><button type="submit" disabled={busy || (!!work.canonicalWorkId && lines.length >= 1)}>Add cost line</button></form>
      {lines.map((line) => <div className={style.row} key={line.id}><b>{line.description}</b><span>{line.quantity} {line.unit} · {line.category} · {line.rateId || line.manualRate} · {line.source}</span><button type="button" disabled={busy} onClick={() => setLines((current) => current.filter((entry) => entry.id !== line.id))}>Remove draft line</button></div>)}
      <label>Estimate risk and uncertainty basis<input value={riskBasis} onChange={(event) => setRiskBasis(event.target.value)} /></label><label>Discount %<input type="number" min="0" max="99" step="0.1" value={discount} onChange={(event) => setDiscount(Number(event.target.value))} /></label>
      {preview ? <div className={style.row}><b>Current preview · {preview.recommendation}</b><span>Included cost {formatMinor(preview.includedCostMinor, preview.currency)} · proposed price {formatMinor(preview.proposedPriceMinor, preview.currency)} · margin {preview.marginPercent?.toFixed(1) ?? "unknown"}%</span>{preview.issues.map((issue, index) => <small key={`${issue.code}-${index}`}>{issue.message} Next: {issue.action}</small>)}</div> : null}
      <button type="button" disabled={busy || !input || (!!work.canonicalWorkId && lines.length !== 1)} onClick={() => void onCommand({ action: "save-service-estimate", requestId: request.id, pricingInput: input! })}>Save new estimate revision</button>
    </> : null}
    {estimate?.status === "Draft" && currentCycle ? <button type="button" disabled={busy || !!estimate.evaluation.issues.length} onClick={() => void onCommand({ action: "submit-service-pricing", requestId: request.id, estimateRevision: estimate.revision })}>Submit exact revision for pricing review</button> : null}
    {estimate?.status === "Pricing review" && currentCycle ? <><form className={style.form} onSubmit={(event) => void record(event, "approve-service-pricing")}><label>Independent pricing approval basis<input name="note" required /></label><button disabled={busy}>Approve priced service</button></form><form className={style.form} onSubmit={(event) => void record(event, "return-service-pricing")}><label>Required correction<input name="note" required /></label><button disabled={busy}>Return for correction</button></form></> : null}
    {estimate?.status === "Approved" && currentCycle && !authorizationCurrent ? <form className={style.form} onSubmit={(event) => void record(event, "record-service-authorization")}><label>External customer authority / party<input name="customerParty" required /></label>{work.canonicalWorkId && hosted ? <CustomerDecisionEvidence workspace={work.workspace} workId={work.id} purpose="service-authorization" scopeId={request.id} evidenceId={authorizationEvidenceId} onEvidence={setAuthorizationEvidenceId} /> : <label>Customer approval source / document<input name="source" required /></label>}<label>Customer organization<input name="customerOrganization" required /></label><label>Representative role<input name="customerRole" required /></label><label>Stated authority<input name="authorityBasis" required /></label><label>Conditions<input name="conditions" /></label><label>Exclusions<input name="exclusions" /></label><label>Internal recording rationale<input name="note" required /></label><button disabled={busy || (!!work.canonicalWorkId && !authorizationEvidenceId)}>Record exact customer authorization</button></form> : null}
  </details>;
}
