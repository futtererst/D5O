"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { WorkRecord, WorkspaceKey } from "./work-types";
import { formatMinor } from "./develop-pricing";
import styles from "./DevelopPlanning.module.css";

type Source = { digest: string; defineRevision: number; estimateRevision: number; offerRevision: number;
  designDecisionRevision: number; approverRole: string; authorization: { authorizedExtent: string; fundingSource: string;
    sourceReference: string; spendCapMinor: number; currency: string } };
type Authority = { id: string; status: string; cap_minor: number; currency: string; extent: string;
  valid_from: string; valid_until: string; source_digest: string; source_reference: string;
  prepared_by: string; review_note: string | null };
type Commitment = { id: string; authority_id: string; status: string; amount_minor: number; currency: string;
  activity: string; source_reference: string; prepared_by: string; review_note: string | null };
type Position = { revision: number; source: Source | null; committedMinor: number; remainingMinor: number | null; windowCapMinor?: number | null; designCapMinor?: number | null;
  authorities: Authority[]; commitments: Commitment[] };
const minor = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value) ?
  String(BigInt(value.split(".")[0]) * BigInt(100) + BigInt((value.split(".")[1] ?? "").padEnd(2, "0"))) : null;
const today = () => new Date().toISOString().slice(0, 10);
const input = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export function DesignSpendControl({ work, workspace, role, actorId, focus }: {
  work: WorkRecord; workspace: WorkspaceKey; role?: string; actorId?: string; focus?: string | null;
}) {
  const [position, setPosition] = useState<Position | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const endpoint = `/api/d5o-hosted/design-spend?workspace=${encodeURIComponent(workspace)}&workId=${encodeURIComponent(work.id)}`;
  const refresh = async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const data = await response.json();
    if (response.ok) setPosition(data as Position);
    else setMessage(data.error ?? "Design spending position unavailable.");
  };
  useEffect(() => {
    let active = true;
    fetch(endpoint, { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!active) return;
      if (response.ok) setPosition(data as Position);
      else setMessage(data.error ?? "Design spending position unavailable.");
    }).catch(() => { if (active) setMessage("Design spending position unavailable."); });
    return () => { active = false; };
  }, [endpoint]);
  const requested = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const requestedRevision = requested?.get("sourceRevision");
  const requestedId = requested?.get("decision");
  const source = position?.source;
  const currentAuthority = position?.authorities.find((entry) => entry.status === "Approved" && entry.source_digest === source?.digest && position.windowCapMinor === entry.cap_minor && entry.valid_from <= today() && entry.valid_until >= today());
  const pendingAuthority = position?.authorities.find((entry) => entry.status === "Prepared" && entry.source_digest === source?.digest);
  const returnedAuthority = [...(position?.authorities ?? [])].reverse().find((entry) => entry.status === "Returned" && entry.source_digest === source?.digest);
  const expiredAuthority = [...(position?.authorities ?? [])].reverse().find((entry) => entry.status === "Approved" && entry.source_digest === source?.digest && entry.valid_until < today());
  const pendingCommitment = position?.commitments.find((entry) => entry.status === "Prepared" && entry.authority_id === currentAuthority?.id);
  const returnedCommitment = [...(position?.commitments ?? [])].reverse().find((entry) => entry.status === "Returned" && entry.authority_id === currentAuthority?.id);
  const preparer = role === "project_manager";
  const reviewer = Boolean(source && role === source.approverRole);
  const only = (task: string) => !focus || focus === task;
  async function run(action: string, payload: Record<string, unknown>) {
    if (!position || !source) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action, input: payload, commandId: crypto.randomUUID(), expectedRevision: position.revision,
        expectedSourceDigest: source.digest
      }) });
      const data = await response.json();
      if (!response.ok) setMessage(data.error ?? "Decision not saved.");
      else { setMessage(`${action.replaceAll("-", " ")} saved. Refresh My Work for the next owner.`); await refresh(); }
    } catch { setMessage("Connection interrupted. Refresh the current authority before retrying."); }
    finally { setBusy(false); }
  }
  const staleLink = focus?.startsWith("design-spend-") && position && (
    (requestedRevision !== null && Number(requestedRevision) !== position.revision)
    || focus === "design-spend-authority-review" && requestedId !== pendingAuthority?.id
    || focus === "design-spend-commitment-review" && requestedId !== pendingCommitment?.id
    || focus === "design-spend-commitment-prep" && requestedId !== currentAuthority?.id);
  if (staleLink) return <section className={styles.content} role="alert"><h3>This Design spending task changed</h3>
    <p>{message || "Its exact decision or source revision is no longer current. Open the refreshed task; no substitute was selected."}</p>
    <a href={`/work?workspace=${encodeURIComponent(workspace)}&view=my-work`}>Back to My Work</a></section>;
  if (focus?.startsWith("design-spend") && !source) return <section className={styles.content} role="alert">
    <h3>Design spending source changed</h3><p>The approved ROM or Design permission is no longer current. No prior spending task can authorize a new commitment.</p>
    <a href={`/work?workspace=${encodeURIComponent(workspace)}&view=my-work`}>Back to My Work</a></section>;
  if (!source || !position) return null;
  const available = position.remainingMinor;
  return <section className={styles.content} aria-label="Controlled Design spending">
    <h3>Controlled detailed-Design spending</h3>
    <p>{work.title} · {work.customer} · {work.site}</p>
    <p>Approved Define revision {source.defineRevision}; ROM estimate {source.estimateRevision}; communicated offer {source.offerRevision}; Design permission decision {source.designDecisionRevision}.</p>
    <p><b>Authorized Design extent:</b> {source.authorization.authorizedExtent}. Funding: {source.authorization.fundingSource}. Source: {source.authorization.sourceReference}.</p>
    <p><b>Internal Design cap:</b> {formatMinor(source.authorization.spendCapMinor, source.authorization.currency)} · current spending window {position.windowCapMinor === null || position.windowCapMinor === undefined ? "not active" : formatMinor(position.windowCapMinor, source.authorization.currency)} · committed {formatMinor(position.committedMinor, source.authorization.currency)} · current-window remaining {available === null ? "unknown" : formatMinor(available, source.authorization.currency)}.</p>
    <p>This authority permits only the stated internal Design activity. It does not award delivery, approve a supplier PO, publish crews or authorize field work.</p>
    {only("design-spend-authority-prep") && preparer && !currentAuthority && !pendingAuthority ? <form className={styles.form} onSubmit={(event: FormEvent<HTMLFormElement>) => {
      event.preventDefault(); const form = new FormData(event.currentTarget); const capMinor = minor(input(form, "cap"));
      if (!capMinor) { setMessage("Enter a valid currency amount."); return; }
      void run("prepare-authority", { capMinor, extent: input(form, "extent"), validFrom: input(form, "from"),
        validUntil: input(form, "until"), sourceReference: input(form, "source"), ...((returnedAuthority ?? expiredAuthority) ? { supersedesId: (returnedAuthority ?? expiredAuthority)?.id } : {}) });
    }}><h4>Prepare a controlled Design spending window</h4>{returnedAuthority ? <p>Correcting returned window {returnedAuthority.id}. Earlier review: {returnedAuthority.review_note}</p> : null}{expiredAuthority && !returnedAuthority ? <p>Replacing expired window {expiredAuthority.id}; earlier commitments remain recorded.</p> : null}<p>Propose an activity and expiry within the existing Design cap. {source.approverRole} independently decides it.</p>
      <label>Maximum amount ({source.authorization.currency})<input name="cap" inputMode="decimal" required /></label>
      <label>Permitted Design activity<textarea name="extent" required defaultValue={source.authorization.authorizedExtent} /></label>
      <label>Effective date<input name="from" type="date" defaultValue={today()} required /></label>
      <label>Expires on<input name="until" type="date" required /></label>
      <label>Funding decision source<input name="source" required defaultValue={source.authorization.sourceReference} /></label>
      <button className="d5o-primary" disabled={busy}>Submit spending window</button></form> : null}
    {only("design-spend-authority-review") && pendingAuthority && reviewer ? <section>
      <h4>Review Design spending window</h4><p>{pendingAuthority.extent} · {formatMinor(pendingAuthority.cap_minor, pendingAuthority.currency)} · {pendingAuthority.valid_from} to {pendingAuthority.valid_until} · source {pendingAuthority.source_reference}</p>
      <ReviewButtons busy={busy} onDecide={(decision, reason) => void run(`${decision}-authority`, { authorityId: pendingAuthority.id, reason })} />
    </section> : null}
    {only("design-spend-commitment-prep") && currentAuthority && preparer ? <form className={styles.form} onSubmit={(event: FormEvent<HTMLFormElement>) => {
      event.preventDefault(); const form = new FormData(event.currentTarget); const amountMinor = minor(input(form, "amount"));
      if (!amountMinor) { setMessage("Enter a valid currency amount."); return; }
      void run("prepare-commitment", { authorityId: currentAuthority.id, amountMinor,
        activity: input(form, "activity"), sourceReference: input(form, "source"), ...(returnedCommitment ? { supersedesId: returnedCommitment.id } : {}) });
    }}><h4>Prepare a Design effort commitment</h4>{returnedCommitment ? <p>Correcting returned commitment {returnedCommitment.id}. Earlier review: {returnedCommitment.review_note}</p> : null}<p>A draft does not commit spend. The current {source.approverRole} reviews it independently.</p>
      <label>Amount ({currentAuthority.currency})<input name="amount" inputMode="decimal" required /></label>
      <label>Exact Design activity<textarea name="activity" required /></label>
      <label>Work-order or cost source reference<input name="source" required /></label>
      <button className="d5o-primary" disabled={busy}>Submit commitment for review</button></form> : null}
    {only("design-spend-commitment-review") && pendingCommitment && reviewer && pendingCommitment.prepared_by !== actorId ? <section>
      <h4>Review exact Design commitment</h4><p>{pendingCommitment.activity} · {formatMinor(pendingCommitment.amount_minor, pendingCommitment.currency)} · source {pendingCommitment.source_reference}</p>
      <p>Current remaining Design cap: {available === null ? "unknown" : formatMinor(available, pendingCommitment.currency)}. Approval consumes this amount; the server rechecks the cap.</p>
      <ReviewButtons busy={busy} onDecide={(decision, reason) => void run(`${decision}-commitment`, { commitmentId: pendingCommitment.id, reason })} />
    </section> : null}
    {position.authorities.some((entry) => entry.status === "Approved" && entry.source_digest === source.digest && entry.valid_until < today()) ? <p role="alert">The approved spending window expired. New commitments require a new independently reviewed window; earlier approved commitments remain history.</p> : null}
    {pendingAuthority && !reviewer ? <p>Waiting on {source.approverRole} to review the proposed spending window.</p> : null}
    {pendingCommitment && !reviewer ? <p>Waiting on {source.approverRole} to review the proposed Design commitment.</p> : null}
    {position.authorities.length || position.commitments.length ? <details><summary>Authority and commitment history</summary>
      {position.authorities.map((item) => <p key={item.id}>Window {item.status}: {formatMinor(item.cap_minor, item.currency)} · {item.extent} · ends {item.valid_until} · {item.source_reference}</p>)}
      {position.commitments.map((item) => <p key={item.id}>Commitment {item.status}: {formatMinor(item.amount_minor, item.currency)} · {item.activity} · {item.source_reference}</p>)}
    </details> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
function ReviewButtons({ busy, onDecide }: { busy: boolean; onDecide: (decision: "approve" | "return", reason: string) => void }) {
  const [reason, setReason] = useState("");
  return <div className={styles.form}><label>Decision rationale<textarea value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
    <div><button type="button" className="d5o-outline" disabled={busy || reason.trim().length < 10} onClick={() => onDecide("return", reason)}>Return for correction</button>
      <button type="button" className="d5o-primary" disabled={busy || reason.trim().length < 10} onClick={() => onDecide("approve", reason)}>Approve exact basis</button></div></div>;
}
