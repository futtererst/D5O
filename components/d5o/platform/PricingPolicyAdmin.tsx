"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { WorkspaceKey } from "./work-types";
import { validatePricingPolicy, type PricingCategory, type PricingPolicy, type PricingRate } from "./develop-pricing";
import styles from "./DevelopPlanning.module.css";

type PolicyResponse = { revision: number; policies: PricingPolicy[]; active: { id: string; version: number } | null; canAdmin: boolean; message?: string };
const categories: PricingCategory[] = ["labor", "material", "equipment", "subcontract", "travel", "mobilization", "setup", "recurring", "other"];
const value = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const emptyPolicy = (workspace: WorkspaceKey): PricingPolicy => ({ id: crypto.randomUUID(), version: 1, status: "draft", workspace, name: "", currency: "USD", effectiveFrom: new Date().toISOString().slice(0, 10), rates: [], targetMarginPercent: 0, floorMarginPercent: 0, overheadPercent: 0, contingencyPercent: 0, maxDiscountPercent: 0, method: "target-margin", solutionApproverRole: "operations_leader", pricingApproverRole: "operations_leader", marginExceptionRole: "admin", proposalApproverRole: "operations_leader" });

export function PricingPolicyAdmin({ workspace, hosted, onNotice, onPolicyUpdated, onState }: {
  workspace: WorkspaceKey; hosted: boolean; onNotice: (message: string) => void;
  onPolicyUpdated: () => Promise<void>; onState?: (state: PolicyResponse) => void;
}) {
  const [state, setState] = useState<PolicyResponse | null>(null);
  const [draft, setDraft] = useState<PricingPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const endpoint = hosted ? `/api/d5o-hosted/prototype-state?workspace=${encodeURIComponent(workspace)}&key=work&pricing=1` : "/api/work/prototype-state?pricing=1";
  useEffect(() => { let mounted = true; void fetch(endpoint, { cache: "no-store" }).then((response) => response.json()).then((body: PolicyResponse) => { if (mounted && Array.isArray(body.policies)) { setState(body); onState?.(body); } }).catch(() => undefined); return () => { mounted = false; }; }, [endpoint, onState]);

  async function command(action: "save-draft" | "publish" | "activate", policy: PricingPolicy) {
    if (!state || busy) return;
    setBusy(true);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, expectedRevision: state.revision, commandId: crypto.randomUUID(), policy: action === "save-draft" ? policy : undefined, policyId: policy.id, policyVersion: policy.version }) });
      const body = await response.json() as PolicyResponse & { error?: string };
      if (!response.ok) { onNotice(body.message ?? body.error ?? "Pricing policy was not saved."); return; }
      const nextState = { ...body, canAdmin: state.canAdmin };
      setState(nextState); onState?.(nextState); setDraft(action === "save-draft" ? policy : null);
      await onPolicyUpdated();
      onNotice(`Pricing policy ${action.replace("-", " ")} saved at workspace revision ${body.revision}.`);
    } catch { onNotice("Pricing configuration service is unavailable."); } finally { setBusy(false); }
  }
  function addRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!draft) return;
    const form = new FormData(event.currentTarget);
    const rate: PricingRate = { id: value(form, "id"), label: value(form, "label"), category: value(form, "category") as PricingCategory, unit: value(form, "unit"), amount: value(form, "amount"), scope: { kind: value(form, "scopeKind") as PricingRate["scope"]["kind"], value: value(form, "scopeValue") }, effectiveFrom: value(form, "effectiveFrom"), effectiveTo: value(form, "effectiveTo") || undefined, source: value(form, "source"), burdenPercent: Number(value(form, "burdenPercent") || 0), leadDays: Number(value(form, "leadDays") || 0) };
    setDraft({ ...draft, rates: [...draft.rates.filter((item) => !(item.id === rate.id && item.scope.kind === rate.scope.kind && item.scope.value === rate.scope.value)), rate] });
    event.currentTarget.reset();
  }
  function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!draft) return;
    const form = new FormData(event.currentTarget);
    const next: PricingPolicy = { ...draft, name: value(form, "name"), currency: value(form, "currency").toUpperCase(), effectiveFrom: value(form, "effectiveFrom"), effectiveTo: value(form, "effectiveTo") || undefined, targetMarginPercent: Number(value(form, "targetMarginPercent")), floorMarginPercent: Number(value(form, "floorMarginPercent")), overheadPercent: Number(value(form, "overheadPercent")), contingencyPercent: Number(value(form, "contingencyPercent")), maxDiscountPercent: Number(value(form, "maxDiscountPercent")), method: value(form, "method") as PricingPolicy["method"], markupPercent: Number(value(form, "markupPercent") || 0), fixedPrice: value(form, "fixedPrice") || undefined, solutionApproverRole: value(form, "solutionApproverRole") as PricingPolicy["solutionApproverRole"], pricingApproverRole: value(form, "pricingApproverRole") as PricingPolicy["pricingApproverRole"], marginExceptionRole: value(form, "marginExceptionRole") as PricingPolicy["marginExceptionRole"], proposalApproverRole: value(form, "proposalApproverRole") as PricingPolicy["proposalApproverRole"] };
    void command("save-draft", next);
  }

  if (!state?.canAdmin) return null;
  return <details className={styles.workspace} aria-label="Tenant pricing configuration">
    <summary className={styles.header}><div><small>TENANT CONFIGURATION · SYSTEM ADMINISTRATOR</small><h2>Pricing policies and rates</h2><p>Configure once for Develop estimates and chargeable Operate work. Publishing rates never reprices an approved estimate or customer offer.</p></div><span>{state.active ? `Active policy v${state.active.version}` : "No active policy"}</span></summary>
    <div className={styles.content}>
      <p>Configuration rights are distinct from pricing and proposal approval. Published versions stay immutable.</p>
      <div className={styles.lines}>{state.policies.map((item) => <article key={`${item.id}-${item.version}`}><strong>{item.name || "Unnamed draft"} · v{item.version} · {item.status}</strong><span>{item.currency} · {item.effectiveFrom} · {item.rates.length} rates {state.active?.id === item.id && state.active.version === item.version ? "· ACTIVE" : ""}</span>{item.status === "draft" ? <><button type="button" onClick={() => setDraft(item)}>Edit</button><button type="button" disabled={busy} onClick={() => void command("publish", item)}>Validate & publish</button></> : <><button type="button" onClick={() => setDraft({ ...structuredClone(item), version: item.version + 1, status: "draft", publishedAt: undefined, publishedBy: undefined })}>New version</button>{item.status === "published" ? <button type="button" disabled={busy} onClick={() => void command("activate", item)}>Activate</button> : null}</>}</article>)}</div>
      <button type="button" className="d5o-outline" onClick={() => setDraft(emptyPolicy(workspace))}>Create draft policy</button>
      {draft ? <><form className={styles.form} key={`${draft.id}-${draft.version}`} onSubmit={saveDraft}>
        <div className={styles.columns}><label>Policy name<input name="name" required defaultValue={draft.name} /></label><label>Currency (ISO)<input name="currency" required pattern="[A-Za-z]{3}" defaultValue={draft.currency} /></label><label>Effective from<input type="date" name="effectiveFrom" required defaultValue={draft.effectiveFrom} /></label><label>Effective to<input type="date" name="effectiveTo" defaultValue={draft.effectiveTo} /></label>{(["targetMarginPercent", "floorMarginPercent", "overheadPercent", "contingencyPercent", "maxDiscountPercent"] as const).map((key) => <label key={key}>{key.replace(/([A-Z])/g, " $1")}<input name={key} type="number" min="0" max="99" step="0.01" required defaultValue={draft[key]} /></label>)}<label>Price method<select name="method" defaultValue={draft.method}><option value="target-margin">Target margin</option><option value="markup">Markup</option><option value="fixed-price">Fixed price</option></select></label><label>Markup %<input name="markupPercent" type="number" min="0" max="99" defaultValue={draft.markupPercent} /></label><label>Fixed price<input name="fixedPrice" defaultValue={draft.fixedPrice} /></label>{(["solutionApproverRole", "pricingApproverRole", "marginExceptionRole", "proposalApproverRole"] as const).map((key) => <label key={key}>{key.replace(/([A-Z])/g, " $1")}<select name={key} defaultValue={draft[key]}><option value="operations_leader">Operations leader</option><option value="admin">System administrator</option></select></label>)}</div>
        <h4>Cost catalog and applicability</h4>{draft.rates.map((rate, index) => <p key={`${rate.id}-${index}`}>{rate.id} · {rate.label} · {rate.amount} {draft.currency}/{rate.unit} · {rate.scope.kind} {rate.scope.value}<button type="button" onClick={() => setDraft({ ...draft, rates: draft.rates.filter((_, position) => position !== index) })}>Remove</button></p>)}
        <p>{validatePricingPolicy(draft).join(" ")}</p><button className="d5o-primary" disabled={busy}>Save draft and rate catalog</button>
      </form><form className={styles.form} onSubmit={addRate}><h4>Add applicable rate</h4><div className={styles.columns}><label>Rate key<input name="id" required /></label><label>Label<input name="label" required /></label><label>Category<select name="category">{categories.map((item) => <option key={item}>{item}</option>)}</select></label><label>Unit<input name="unit" required /></label><label>Cost per unit<input name="amount" required /></label><label>Scope<select name="scopeKind"><option value="default">Tenant default</option><option value="workType">Work Type</option><option value="region">Region</option><option value="customer">Customer/contract</option></select></label><label>Scope value<input name="scopeValue" placeholder="Exact customer, type, or region" /></label><label>Effective from<input type="date" name="effectiveFrom" required defaultValue={draft.effectiveFrom} /></label><label>Effective to<input type="date" name="effectiveTo" /></label><label>Source<input name="source" required /></label><label>Labor burden %<input type="number" min="0" name="burdenPercent" defaultValue="0" /></label><label>Supplier lead days<input type="number" min="0" name="leadDays" /></label></div><button className="d5o-outline">Add rate to draft</button></form></> : null}
    </div>
  </details>;
}
