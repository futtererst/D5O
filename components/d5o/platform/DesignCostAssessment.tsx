"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { WorkRecord } from "./work-types";
import { dollarsToMinor, moneyMinor } from "./job-finance-model";

type Commitment = { id: string; amount_minor: number; activity: string; source_reference: string };
type Link = { commitment_id: string; ledger_cost_id: string };
type Claim = { id: string; commitment_id: string; root_id: string; supersedes_id: string | null;
  status: string; amount_minor: number; cost_date: string; source_reference: string;
  evidence_note: string; prepared_by: string; review_note: string | null };
type Assessment = { id: string; status: string; source_digest: string; actual_cutoff: string;
  category_basis: Record<string, { status: string; reason: string }>;
  source_basis: Record<string, unknown>; limitations: string; source_reference: string; review_note: string | null };
type Position = { revision: number; sourceDigest: string; sourceBasis: Record<string, unknown>; commitments: Commitment[];
  links: Link[]; claims: Claim[]; assessments: Assessment[] };
const categories = ["Design", "Material", "Equipment", "Subcontract", "Labor", "Other"];
const field = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const today = () => new Date().toISOString().slice(0, 10);

export function DesignCostAssessment({ work, actorRole, onCommitted, mode = "all", expectedRevision, decisionId,
  remainingForecastMinor, forecastSource }: {
  work: WorkRecord; actorRole: string; onCommitted: () => Promise<void>;
  mode?: "all" | "design-cost" | "outlook-assessment"; expectedRevision?: number; decisionId?: string | null;
  remainingForecastMinor?: number | null; forecastSource?: string | null;
}) {
  const [position, setPosition] = useState<Position | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const endpoint = `/api/d5o-hosted/design-cost?workspace=${encodeURIComponent(work.workspace)}&workId=${encodeURIComponent(work.id)}`;
  const refresh = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const body = await response.json() as Position & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Design cost position unavailable");
    setPosition(body);
  }, [endpoint]);
  useEffect(() => {
    let active = true;
    void fetch(endpoint, { cache: "no-store" }).then(async (response) => {
      const body = await response.json() as Position & { error?: string };
      if (!active) return;
      if (!response.ok) throw new Error(body.error ?? "Design cost position unavailable");
      setPosition(body);
    }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Design cost position unavailable"); });
    return () => { active = false; };
  }, [endpoint]);

  async function send(action: string, input: Record<string, unknown>) {
    if (!position) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, input, commandId: crypto.randomUUID(),
          expectedRevision: position.revision, expectedSourceDigest: position.sourceDigest }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The decision was not saved");
      await refresh(); await onCommitted();
      setMessage(`${action.replaceAll("-", " ")} saved. Refresh My Work for the next owner.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Connection interrupted; refresh the current basis before retrying"); }
    finally { setBusy(false); }
  }
  const submit = (action: string, data: (form: FormData) => Record<string, unknown>) =>
    (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void send(action, data(new FormData(event.currentTarget))); };
  if (!position) return <section aria-label="Design cost and outlook assessment"><h4>Design costs and outlook review</h4><p role="status">{message || "Loading current sources…"}</p></section>;
  if (expectedRevision !== undefined && position.revision !== expectedRevision) return <section role="alert">
    <h4>This Finance task changed</h4>{message ? <p role="status">{message}</p> : null}
    <p>The exact source revision is no longer current. No substitute decision was selected.</p>
    <a href={`/work?workspace=${encodeURIComponent(work.workspace)}&view=my-work`}>Back to My Work</a></section>;
  if (decisionId && !position.claims.some((claim) => claim.id === decisionId && claim.status === "Prepared")
    && !position.assessments.some((assessment) => assessment.id === decisionId && assessment.status === "Prepared"))
    return <section role="alert"><h4>This Finance decision was already handled</h4>{message ? <p role="status">{message}</p> : null}
      <p>The saved link cannot review another source.</p><a href={`/work?workspace=${encodeURIComponent(work.workspace)}&view=my-work`}>Back to My Work</a></section>;
  const prepared = position.claims.filter((item) => item.status === "Prepared");
  const pendingAssessment = position.assessments.find((item) => item.status === "Prepared" && (!decisionId || item.id === decisionId));
  const currentAssessment = [...position.assessments].reverse().find((item) => ["Complete", "Reviewed with gaps"].includes(item.status));
  const changes = (item: Assessment) => Object.keys(position.sourceBasis ?? {}).filter((key) =>
    JSON.stringify(item.source_basis?.[key] ?? null) !== JSON.stringify(position.sourceBasis?.[key] ?? null));
  const unlinked = position.commitments.filter((item) => !position.links.some((link) => link.commitment_id === item.id));
  const latestClaims = position.claims.filter((item) => item.status === "Reviewed" &&
    !position.claims.some((next) => next.supersedes_id === item.id && next.status === "Reviewed"));
  const linked = position.links.map((link) => {
    const commitment = position.commitments.find((item) => item.id === link.commitment_id);
    const actual = latestClaims.filter((item) => item.commitment_id === link.commitment_id)
      .reduce((sum, item) => sum + item.amount_minor, 0);
    return { ...link, commitment, actual, remaining: Math.max((commitment?.amount_minor ?? 0) - actual, 0) };
  });
  const pm = actorRole === "project_manager";
  const finance = actorRole === "billing_commercial_lead";
  const selection = linked.find((item) => item.commitment_id === selected) ?? linked[0];
  return <section aria-label="Design cost and outlook assessment">
    <h4>Design costs and outlook review</h4>
    <p>Approved Design work is a commitment, not an incurred cost. Link its source, record actuals, then have Finance review them independently. Historical unlinked commitments remain unresolved.</p>
    {message ? <p role="status">{message}</p> : null}
    {mode !== "outlook-assessment" && unlinked.map((item) => <div key={item.id}>
      <p><b>Source link needed:</b> {item.activity} · {moneyMinor(item.amount_minor, "USD")} · {item.source_reference}</p>
      {pm ? <form onSubmit={submit("link-commitment", (form) => ({ commitmentId: item.id, source: field(form, "source") }))}>
        <label>Commitment source reference <input name="source" minLength={8} required /></label>
        <button disabled={busy}>Link this approved commitment to Finance</button>
      </form> : <p>Assigned project manager must link the approved source.</p>}
    </div>)}
    {mode !== "outlook-assessment" && linked.map((item) => <p key={item.commitment_id}><b>{item.commitment?.activity ?? "Design commitment"}:</b> approved {moneyMinor(item.commitment?.amount_minor ?? null, "USD")} · reviewed actual {moneyMinor(item.actual, "USD")} · outstanding {moneyMinor(item.remaining, "USD")}{item.actual > (item.commitment?.amount_minor ?? 0) ? " · cost overrun; further authority requires review" : ""}</p>)}
    {mode !== "outlook-assessment" && pm && linked.length ? <form onSubmit={submit("prepare-cost", (form) => ({
      commitmentId: field(form, "commitmentId"), amountMinor: dollarsToMinor(field(form, "amount")),
      costDate: field(form, "costDate"), sourceReference: field(form, "sourceReference"),
      evidenceNote: field(form, "evidenceNote"), ...(field(form, "supersedesId") ? { supersedesId: field(form, "supersedesId") } : {})
    }))}>
      <h5>Submit sourced Design cost or correction</h5>
      <label>Approved commitment <select name="commitmentId" value={selected || selection?.commitment_id || ""} onChange={(event) => setSelected(event.target.value)}>{linked.map((item) => <option key={item.commitment_id} value={item.commitment_id}>{item.commitment?.activity} · {moneyMinor(item.commitment?.amount_minor ?? null, "USD")}</option>)}</select></label>
      <label>Correction of reviewed cost <select name="supersedesId"><option value="">New cost source</option>{latestClaims.filter((item) => item.commitment_id === (selected || selection?.commitment_id)).map((item) => <option key={item.id} value={item.id}>{item.source_reference} · current {moneyMinor(item.amount_minor, "USD")}</option>)}</select></label>
      <p>A correction replaces the selected source amount after review; earlier versions remain in decision history.</p>
      <label>Actual incurred amount (USD) <input name="amount" type="number" min="0.01" step="0.01" required /></label>
      <label>Incurred date <input name="costDate" type="date" max={today()} required /></label>
      <label>Retained source reference <input name="sourceReference" minLength={8} required /></label>
      <label>Evidence and calculation basis <textarea name="evidenceNote" minLength={10} required /></label>
      <button disabled={busy}>Submit Design cost for Finance review</button>
    </form> : null}
    {mode !== "outlook-assessment" && prepared.filter((item) => !decisionId || item.id === decisionId).map((item) => <div key={item.id}>
      <p><b>Awaiting independent Finance review:</b> {item.source_reference} · {moneyMinor(item.amount_minor, "USD")} · {item.cost_date}. {item.evidence_note}</p>
      {finance ? <form onSubmit={submit("review-cost", (form) => ({ claimId: item.id, decision: field(form, "decision"), reason: field(form, "reason") }))}>
        <label>Decision <select name="decision"><option>Reviewed</option><option>Returned</option></select></label>
        <label>Review rationale <input name="reason" minLength={10} required /></label>
        <button disabled={busy}>Save independent cost review</button>
      </form> : null}
    </div>)}
    {mode !== "design-cost" && <><h5>Work cost-outlook completeness</h5>
    <p>Additional cost beyond approved commitments: {moneyMinor(remainingForecastMinor ?? null, "USD")} · {forecastSource ?? "No reviewed forecast source"}. This amount must exclude the remaining value of commitments already shown above.</p>
    {finance ? <form onSubmit={submit("set-work-forecast", (form) => ({ amountMinor: dollarsToMinor(field(form, "amount")),
      forecastAt: field(form, "forecastAt"), source: field(form, "source") }))}>
      <h6>Record a sourced additional-cost forecast</h6>
      <label>Additional cost beyond commitments (USD) <input name="amount" type="number" min="0" step="0.01" required /></label>
      <label>Forecast assessment date <input name="forecastAt" type="date" max={today()} defaultValue={today()} required /></label>
      <label>Basis and source <input name="source" minLength={8} required /></label>
      <button disabled={busy}>Save current Work forecast</button>
    </form> : null}
    {currentAssessment ? <p role="status"><b>{currentAssessment.source_digest === position.sourceDigest ? currentAssessment.status : "Out of date"}</b> · cutoff {currentAssessment.actual_cutoff} · {currentAssessment.limitations} · source {currentAssessment.source_reference}. {currentAssessment.source_digest !== position.sourceDigest ? `Changed source groups: ${changes(currentAssessment).join(", ") || "source basis"}. Prepare a new review.` : "This is an outlook assessment, not final margin certification."}</p> : <p>No independently reviewed outlook assessment recorded.</p>}
    {pm ? <form onSubmit={submit("prepare-assessment", (form) => ({
      actualCutoff: field(form, "actualCutoff"), sourceReference: field(form, "sourceReference"),
      limitations: field(form, "limitations"),
      categories: Object.fromEntries(categories.map((category) => [category, {
        status: field(form, `${category}Status`), reason: field(form, `${category}Reason`) }]))
    }))}>
      <p>For each cost category, state whether its current scope is sourced, unknown, or not applicable. An absent fact is never assumed to be zero.</p>
      {categories.map((category) => <fieldset key={category}><legend>{category}</legend>
        <label>Status <select name={`${category}Status`} defaultValue="Unknown"><option>Unknown</option><option>Resolved</option><option>Not applicable</option></select></label>
        <label>Basis or missing action <input name={`${category}Reason`} minLength={8} required /></label>
      </fieldset>)}
      <label>Actual-cost cutoff <input name="actualCutoff" type="date" defaultValue={today()} required /></label>
      <label>Limitations and expected follow-up <textarea name="limitations" minLength={10} required /></label>
      <label>Source reference <input name="sourceReference" minLength={8} required /></label>
      <button disabled={busy}>Submit current outlook for Finance review</button>
    </form> : null}
    {pendingAssessment ? <div><p><b>Prepared assessment:</b> cutoff {pendingAssessment.actual_cutoff} · {pendingAssessment.limitations}. {pendingAssessment.source_digest !== position.sourceDigest ? "Its source changed; prepare again." : "Waiting for independent Finance."}</p>
      {finance && pendingAssessment.source_digest === position.sourceDigest ? <form onSubmit={submit("review-assessment", (form) => ({ assessmentId: pendingAssessment.id, decision: field(form, "decision"), reason: field(form, "reason") }))}>
        <label>Decision <select name="decision"><option>Reviewed with gaps</option><option>Complete</option><option>Returned</option></select></label>
        <label>Review rationale <input name="reason" minLength={10} required /></label>
        <button disabled={busy}>Save Finance outlook review</button>
      </form> : null}</div> : null}
    </>}
    <details><summary>Prior Design cost and assessment decisions</summary>
      {position.claims.map((item) => <p key={item.id}>{item.status} · {item.source_reference} · {moneyMinor(item.amount_minor, "USD")}{item.supersedes_id ? ` · replaces ${item.supersedes_id}` : ""} · {item.review_note ?? "Awaiting review"}</p>)}
      {position.assessments.map((item) => <p key={item.id}>{item.status} · {item.actual_cutoff} · {item.source_reference} · {item.review_note ?? "Awaiting review"}{item.source_digest !== position.sourceDigest ? ` · historical basis; changed: ${changes(item).join(", ") || "source basis"}` : " · current source basis"}</p>)}
    </details>
  </section>;
}
