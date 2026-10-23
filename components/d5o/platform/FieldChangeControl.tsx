"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import style from "./DeployWorkspace.module.css";
import { CustomerDecisionEvidence } from "./CustomerDecisionEvidence";


type Change = { id: string; packageId: string; releaseId: string; packageRevision: number;

  reportId?: string; evidenceIds: string[]; revision: number; status: string;

  kind?: "Correction" | "Clarification" | "Scope change"; title: string; impact: string;

  ownerRole: string; dueDate?: string; facts: Record<string, unknown> };

type State = { sourceRevision: number; designRevision: number; deployRevision: number; changes: Change[] };

const field = (data: FormData, key: string) => String(data.get(key) ?? "").trim();



export function FieldChangeControl({ workspace, workId, packageId, releaseId, reports, evidence, onRecordChanged, onHoldChange, workerOnly = false, mode = "field" }: {

  workspace: string; workId: string; packageId: string; releaseId?: string;

  reports: Array<{ id: string; status: string; summary: string }>;

  evidence: Array<{ id: string; filename: string }>;

  onRecordChanged?: () => void; onHoldChange?: (held: boolean) => void; workerOnly?: boolean; mode?: "field" | "commercial";

}) {

  const [state, setState] = useState<State | null>(null);

  const [error, setError] = useState("");

  const [busy, setBusy] = useState(false);
  const [customerEvidence, setCustomerEvidence] = useState<Record<string, string>>({});
  const load = useCallback(async () => {

    const response = await fetch(`/api/d5o-hosted/field-changes?workspace=${encodeURIComponent(workspace)}&workId=${encodeURIComponent(workId)}`, { cache: "no-store" });

    const body = await response.json() as State & { error?: string };

    if (!response.ok) throw new Error(body.error ?? "Field changes unavailable");

    setState(body); onHoldChange?.(body.changes.some((item) => item.packageId === packageId && item.status !== "Resolved")); setError("");

  }, [workspace, workId, packageId, onHoldChange]);

  useEffect(() => { void Promise.resolve().then(load).catch((cause) => setError(cause instanceof Error ? cause.message : "Field changes unavailable")); }, [load]);

  async function send(action: string, change: Change | null, data: Record<string, unknown>) {

    if (!state) return;

    setBusy(true); setError("");

    try {

      const response = await fetch("/api/d5o-hosted/field-changes", { method: "POST",

        headers: { "Content-Type": "application/json" }, body: JSON.stringify({

          workspace, workId, packageId, changeId: change?.id, action, data,

          commandId: crypto.randomUUID(), expectedSourceRevision: state.sourceRevision,

          expectedDesignRevision: state.designRevision,

          expectedDeployRevision: state.deployRevision,

          expectedChangeRevision: change?.revision ?? 0

        }) });

      const result = await response.json() as { error?: string };

      if (!response.ok) throw new Error(result.error ?? "Decision rejected");

      await load(); onRecordChanged?.();

    } catch (cause) { setError(cause instanceof Error ? cause.message : "Decision unavailable"); }

    finally { setBusy(false); }

  }

  const submit = (action: string, change: Change | null, map: (data: FormData) => Record<string, unknown>) =>

    (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void send(action, change, map(new FormData(event.currentTarget))); };

  const changes = state?.changes.filter((item) => item.packageId === packageId) ?? [];

  return <article className={style.card}>

    <h3>Field condition and controlled change</h3>

    <p>Report a changed condition against this exact package and release. An unresolved condition holds further authorization. Develop owns price; Design must issue and Deploy must receive a revised basis before additional scope can start.</p>

    {error ? <p role="alert">{error}</p> : null}

    {!state ? <p role="status">Loading field conditions…</p> : null}

    {mode === "field" && releaseId && state ? <form className={style.form} onSubmit={submit("raise", null, (data) => ({

      title: field(data,"title"), impact: field(data,"impact"), reportId: field(data,"reportId") || undefined,

      evidenceIds: data.getAll("evidenceId").map(String), dueDate: field(data,"dueDate") || undefined

    }))}>

      <label>Unexpected condition<input name="title" minLength={8} required placeholder="Unexpected cabling condition" /></label>

      <label>Impact and affected scope<input name="impact" minLength={10} required /></label>

      <label>Linked field report<select name="reportId"><option value="">No report yet</option>{reports.map((item) => <option key={item.id} value={item.id}>{item.summary.slice(0,60)}</option>)}</select></label>

      <label>Action due<input type="date" name="dueDate" /></label>

      <fieldset><legend>Supporting uploaded evidence</legend>{evidence.map((item) => <label key={item.id}><input type="checkbox" name="evidenceId" value={item.id} /> {item.filename}</label>)}</fieldset>

      <button disabled={busy}>Raise condition and hold further start</button>

    </form> : mode === "field" ? <p>An accepted release is required before a field condition can be linked.</p> : null}

    <div className={style.list}>{changes.map((change) => <section key={change.id}>

      <strong>{change.title} · {change.status}</strong>

      <small>Release {change.releaseId.slice(0,8)} · package rev {change.packageRevision} · decision rev {change.revision} · {change.ownerRole}{change.dueDate ? ` · due ${change.dueDate}` : ""}</small>

      <p>{change.impact}</p>

      {change.kind ? <small>{change.kind} · {String(change.facts.assessment ?? "Assessment pending")}</small> : null}

      {mode === "field" && !workerOnly && change.status === "Open" && !change.kind ? <form className={style.form} onSubmit={submit("assess",change,(data)=>({ kind: field(data,"kind"), reason: field(data,"reason") }))}>

        <label>Disposition<select name="kind"><option>Correction</option><option>Clarification</option><option>Scope change</option></select></label>

        <label>Independent assessment<input name="reason" minLength={15} required /></label><button disabled={busy}>Assess condition</button>

      </form> : null}

      {mode === "field" && !workerOnly && change.status === "Query" ? <form className={style.form} onSubmit={submit("answer-query",change,(data)=>({ response: field(data,"response") }))}>

        <label>Engineering response<input name="response" minLength={15} required /></label><button disabled={busy}>Record technical answer</button>

      </form> : null}

      {mode === "commercial" && !workerOnly && change.kind === "Scope change" && ["Open","Returned"].includes(change.status) ? <form className={style.form} onSubmit={submit("propose",change,(data)=>({

        scopeDifference: field(data,"scopeDifference"), costBasis: field(data,"costBasis"),

        priceBasis: field(data,"priceBasis"), priceAmount: field(data,"priceAmount"),

        currency: field(data,"currency"), scheduleImpact: field(data,"scheduleImpact"),

        assumptions: field(data,"assumptions")

      }))}>

        <label>Scope difference<input name="scopeDifference" minLength={15} required /></label>

        <label>Cost basis and source<input name="costBasis" minLength={10} required /></label>

        <label>Price basis and source<input name="priceBasis" minLength={10} required /></label>

        <label>Proposed price change<input name="priceAmount" type="number" min="0" step="0.01" required /></label>

        <label>Currency<input name="currency" defaultValue="USD" maxLength={3} required /></label>

        <label>Schedule impact<input name="scheduleImpact" minLength={5} required /></label>

        <label>Assumptions<input name="assumptions" /></label><button disabled={busy}>Save Develop change proposal</button>

      </form> : null}

      {mode === "commercial" && !workerOnly && change.status === "Proposed" ? <form className={style.form} onSubmit={submit("submit-review",change,(data)=>({ reason: field(data,"reason") }))}><label>Submission reason<input name="reason" minLength={10} required /></label><button disabled={busy}>Submit independent commercial review</button></form> : null}

      {mode === "commercial" && !workerOnly && change.status === "Internal review" ? <form className={style.form} onSubmit={submit("review",change,(data)=>({ decision: field(data,"decision"), reason: field(data,"reason") }))}><label>Decision<select name="decision"><option>Approved</option><option>Returned</option></select></label><label>Independent reason<input name="reason" minLength={15} required /></label><button disabled={busy}>Record internal decision</button></form> : null}

      {mode === "commercial" && !workerOnly && change.status === "Internally approved" ? <form className={style.form} onSubmit={submit("record-customer",change,(data)=>({ customerRepresentative: field(data,"representative"), organization: field(data,"organization"), authorityBasis: field(data,"authority"), evidenceId: customerEvidence[change.id] }))}><label>Fictional customer representative<input name="representative" required /></label><label>Organization<input name="organization" required /></label><label>Stated customer authority and scope<input name="authority" minLength={10} required /></label><CustomerDecisionEvidence workspace={workspace} workId={workId} purpose="field-change-authorization" scopeId={change.id} evidenceId={customerEvidence[change.id] ?? ""} onEvidence={(id)=>setCustomerEvidence((current)=>({ ...current,[change.id]:id }))} /><button disabled={busy || !customerEvidence[change.id]}>Record separate customer authorization</button></form> : null}
      {mode === "field" && !workerOnly && change.status !== "Resolved" && change.kind && change.status !== "Query" ? <form className={style.form} onSubmit={submit("resolve",change,(data)=>({ reason: field(data,"reason") }))}><label>Resolution and current Design receipt<input name="reason" minLength={15} required /></label><button disabled={busy}>Resolve against approved basis</button></form> : null}

      {change.status === "Resolved" ? <small>Resolved against {String(change.facts.revisedReleaseId ?? "approved original scope")} · history retained.</small> : null}

    </section>)}</div>

  </article>;

}
