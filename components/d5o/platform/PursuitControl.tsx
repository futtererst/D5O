"use client";

import { useState, type FormEvent } from "react";
import type { WorkRecord } from "./work-types";
import { applyPursuitCommand, blankPursuit, type PursuitCommand } from "./pursuit-control";
import { assessmentBasis } from "./discover-decision";
import styles from "./DiscoverWorkspace.module.css";

const value = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export function PursuitControl({ work, actor, canEdit, connected, taskMode, onCommand, onUpdate, onNotice, onDefine }: {
  work: WorkRecord; actor: string; canEdit: boolean;
  connected?: boolean;
  taskMode?: "intake" | "intake-review" | "handoff-prep" | "handoff-receive";
  onCommand?: (workId: string, command: PursuitCommand) => Promise<boolean>;
  onUpdate: (id: string, transform: (current: WorkRecord) => WorkRecord) => void;
  onNotice: (message: string) => void; onDefine: (work: WorkRecord) => void;
}) {
  const control = work.discovery?.pursuitControl ?? blankPursuit();
  const [reason, setReason] = useState("");
  const [spendReason, setSpendReason] = useState("");
  const [handoffReason, setHandoffReason] = useState("");
  const [dirty, setDirty] = useState(false);
  const editable = ["draft", "returned", "held"].includes(control.status);
  const assessment = work.discovery?.crm?.assessmentHistory.at(-1);
  function commit(command: PursuitCommand) {
    if (connected && onCommand) {
      void onCommand(work.id, command).then((saved) => {
        if (saved) { setReason(""); setSpendReason(""); setHandoffReason(""); setDirty(false); }
      });
      return;
    }
    if (!canEdit) { onNotice("This identity cannot edit the local prototype Work Record."); return; }
    const result = applyPursuitCommand(work, command);
    if (!result.work) { onNotice(result.error ?? "The action could not be recorded."); return; }
    onUpdate(work.id, (current) => applyPursuitCommand(current, command).work ?? current);
    setReason(""); setSpendReason(""); setHandoffReason(""); setDirty(false);
    onNotice(`${result.work.discovery?.pursuitControl?.history.at(-1)?.action} prepared on ${work.id}; saving to the shared local workspace. ${result.work.nextAction}.`);
  }
  const base = { expected: control.revision, actor };
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    commit({ ...base, kind: "save", workFields: { customer: value(form, "customer"), site: value(form, "site"), owner: value(form, "owner"), need: value(form, "need") }, fields: {
      requester: value(form, "requester"), intendedOutcome: value(form, "intendedOutcome"), roughValue: value(form, "roughValue"),
      currency: value(form, "currency"), requiredDate: value(form, "requiredDate"), knownRisk: value(form, "knownRisk"),
    } });
  }
  function requestSpend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    commit({ ...base, kind: "request-spend", cap: Number(form.get("cap")), purpose: value(form, "purpose") });
  }
  function sendHandoff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    commit({ ...base, kind: "submit-handoff", receiver: value(form, "receiver"), brief: value(form, "brief") });
  }
  return <article className={`${styles.card} ${styles.pursuitControl}`} aria-label="Pursuit and Define handoff control">
    <p className={styles.kicker}>D1 DISCOVER · CONTROLLED PURSUIT</p>
    <h3>Decide the pursuit, then hand it to Define</h3>
    <p>Intake revision {control.revision} · {control.status.replaceAll("_", " ")}. Qualification permits pursuit consideration; it does not authorize spending, an offer, or delivery.</p>
    <div className={styles.facts}><Fact label="PURSUIT" value={control.status} /><Fact label="SPEND" value={control.spend?.status ?? "not requested"} /><Fact label="DEFINE RECEIPT" value={control.handoff?.status ?? "not started"} /></div>
    {!work.discovery?.pursuitControl ? <p className={styles.pursuitDecision}>This existing sample pursuit predates the controlled D1 intake. Its displayed qualification is historical prototype context, not a D1 decision receipt. Saving an intake starts a new review without erasing that history.</p> : null}
    {!canEdit ? <p className={styles.pursuitDecision}>Read only: this signed-in workspace role cannot edit shared Work Records. Use an authorized workspace editor for this synthetic flow.</p> : null}
    <p className={styles.hint}>Next owner/action: {work.nextAction}. {connected ? "Authenticated fictional pilot actor" : "Local synthetic actor"}: {actor}. The server checks decision authority.</p>
    {editable && (!taskMode || taskMode === "intake") ? <form key={`${work.id}-${control.revision}`} onSubmit={save} onChange={() => setDirty(true)} className={styles.pursuitForm}>
      <label className={styles.field}>Customer / account<input name="customer" defaultValue={work.customer} required /></label>
      <label className={styles.field}>Site / location<input name="site" defaultValue={work.site} required /></label>
      <label className={styles.field}>Accountable owner<input name="owner" defaultValue={work.owner} required /></label>
      <label className={styles.field}>Customer need<textarea name="need" defaultValue={work.discovery?.need} required rows={2} /></label>
      <label className={styles.field}>Requester<input name="requester" defaultValue={control.requester} required /></label>
      <label className={styles.field}>Intended customer outcome<input name="intendedOutcome" defaultValue={control.intendedOutcome} required /></label>
      <div className={styles.pursuitPair}><label className={styles.field}>Rough value<input name="roughValue" type="number" min="0.01" step="0.01" defaultValue={control.roughValue} required /></label><label className={styles.field}>Currency<input name="currency" defaultValue={control.currency} required /></label></div>
      <label className={styles.field}>Required date<input type="date" name="requiredDate" defaultValue={control.requiredDate} required /></label>
      <label className={styles.field}>Known risk or unknown<textarea name="knownRisk" defaultValue={control.knownRisk} required rows={2} /></label>
      <button className="d5o-outline" type="submit" disabled={!canEdit || !dirty}>Save intake revision</button>
    </form> : <div className={styles.pursuitSummary}><strong>{control.intendedOutcome || "Outcome not recorded"}</strong><span>Requested by {control.requester || "unknown"} · {control.roughValue || "value unknown"} {control.currency} · needed {control.requiredDate || "date unknown"}</span><span>Risk: {control.knownRisk || "not recorded"}</span></div>}
    {control.status === "draft" && (!taskMode || taskMode === "intake") ? <div className={styles.pursuitActions}><button className="d5o-primary" disabled={!canEdit || dirty} onClick={() => commit({ ...base, kind: "submit" })}>Submit intake for pursuit decision</button><small>Save changed fields before submitting. Qualification authority reviews the submitted revision.</small></div> : null}
    {control.status === "submitted" && (!taskMode || taskMode === "intake-review") ? <section className={styles.pursuitActions}><strong>Qualification role queue · submitted revision {control.submission?.revision}</strong><label className={styles.field}>Decision basis<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why is this pursuit qualified, held, declined or returned?" /></label><div className={styles.buttonRow}>{(["returned", "held", "declined", "qualified"] as const).map((outcome) => <button key={outcome} type="button" className={outcome === "qualified" ? "d5o-primary" : "d5o-outline"} disabled={!canEdit || reason.trim().length < 10 || (outcome === "qualified" && Boolean(work.discovery?.crm) && (assessment?.basis !== assessmentBasis(work) || !["Pursue", "Pursue with conditions"].includes(assessment?.recommendation ?? "")))} onClick={() => commit({ ...base, kind: "decide", outcome, reason })}>{outcome === "returned" ? "Return for correction" : outcome === "qualified" ? "Qualify pursuit" : outcome === "held" ? "Hold pursuit" : "Decline pursuit"}</button>)}</div></section> : null}
    {control.decision ? <p className={styles.pursuitDecision}>Decision: {control.decision.outcome} on intake revision {control.decision.revision} by {control.decision.actor}. {control.decision.reason}</p> : null}
    {control.status === "qualified" ? <div className={styles.pursuitColumns}>
      {!taskMode ? <section><strong>Separate pursuit investment</strong><p>Only a bounded, approved cap permits controlled pursuit effort. No request means no spending authority.</p>
        {control.spend?.status === "requested" ? <><p>Requested {control.spend.cap} {control.currency}: {control.spend.purpose}</p><label className={styles.field}>Investment decision basis<textarea value={spendReason} onChange={(e) => setSpendReason(e.target.value)} rows={2} /></label><div className={styles.buttonRow}><button className="d5o-outline" disabled={!canEdit || spendReason.trim().length < 10} onClick={() => commit({ ...base, kind: "decide-spend", outcome: "returned", reason: spendReason })}>Return spend request</button><button className="d5o-primary" disabled={!canEdit || spendReason.trim().length < 10} onClick={() => commit({ ...base, kind: "decide-spend", outcome: "authorized", reason: spendReason })}>Authorize bounded spend</button></div></> : control.spend?.status === "authorized" ? <p>Authorized cap: {control.spend.cap} {control.currency}. {control.spend.reason}</p> : <form onSubmit={requestSpend}><label className={styles.field}>Maximum pursuit spend<input name="cap" type="number" min="0.01" step="0.01" required /></label><label className={styles.field}>Purpose<input name="purpose" required /></label><button className="d5o-outline" disabled={!canEdit}>Request spend separately</button></form>}
      </section> : null}
      <section><strong>Received D2 Define handoff</strong><p>Define begins only after the named receiver accepts the brief. Spend approval is independent.</p>
        {control.handoff?.status === "submitted" ? <><p>Revision {control.handoff.revision} to {control.handoff.receiver}: {control.handoff.brief}</p>{taskMode === "handoff-prep" || (!connected && actor.trim().toLocaleLowerCase() !== control.handoff.receiver.trim().toLocaleLowerCase()) ? <p className={styles.pursuitDecision}>Awaiting {control.handoff.receiver}. This signed-in identity cannot accept or return the brief.</p> : <><label className={styles.field}>Receiver response reason<textarea value={handoffReason} onChange={(e) => setHandoffReason(e.target.value)} rows={2} /></label><div className={styles.buttonRow}><button className="d5o-outline" disabled={!canEdit || handoffReason.trim().length < 10} onClick={() => commit({ ...base, kind: "respond-handoff", outcome: "returned", reason: handoffReason })}>Return brief</button><button className="d5o-primary" disabled={!canEdit || handoffReason.trim().length < 10} onClick={() => commit({ ...base, kind: "respond-handoff", outcome: "accepted", reason: handoffReason })}>Accept Define handoff</button></div></>}</> : control.handoff?.status === "accepted" ? <><p>Accepted by {control.handoff.actor}: {control.handoff.reason}</p><button className="d5o-primary" onClick={() => onDefine(work)}>Open Define on this Work Record →</button></> : <form key={`${work.id}-handoff-${control.handoff?.revision ?? 0}`} onSubmit={sendHandoff}><label className={styles.field}>Receiving Define owner<input name="receiver" defaultValue={control.handoff?.receiver || ""} required /></label><label className={styles.field}>Need, scope boundary and open questions<textarea name="brief" rows={3} defaultValue={control.handoff?.brief || ""} required /></label><button className="d5o-outline" disabled={!canEdit}>Submit Define handoff</button></form>}
      </section>
    </div> : null}
    {!taskMode && control.history.length ? <details className={styles.pursuitHistory}><summary>Decision and correction history · {control.history.length}</summary><ol>{control.history.slice().reverse().map((event) => <li key={`${event.revision}-${event.action}`}><strong>Rev {event.revision} · {event.action}</strong><span>{event.actor} · {event.at}</span><p>{event.note}</p></li>)}</ol></details> : null}
  </article>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div><small>{label}</small><strong>{value.replaceAll("_", " ")}</strong></div>; }
