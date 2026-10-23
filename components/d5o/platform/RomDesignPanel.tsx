"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { WorkRecord, WorkspaceKey } from "./work-types";
import { formatMinor } from "./develop-pricing";
import styles from "./DevelopPlanning.module.css";

type Position = {
  sourceRevision: number; decisionRevision: number; status: string | null;
  estimateRevision: number | null; offerRevision: number | null;
  acknowledgment: Record<string, string> | null;
  authorization: Record<string, string> | null;
  reconciliation: Array<{ differences: Difference[]; sourceReference: string; recordedAt: string; estimateRevision: number; offerRevision: number }> | null;
};
type Difference = { romLineId: string; designQuantity: string; designUnit: string; cause: string; explanation: string };
const causes = ["Customer scope change", "Estimating assumption resolved", "Technical solution change", "Estimating omission/correction"];
const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export function RomDesignPanel({ work, workspace, role, focus, reconciliationOnly = false }: { work: WorkRecord; workspace: WorkspaceKey; role?: string; focus?: string | null; reconciliationOnly?: boolean }) {
  const [position, setPosition] = useState<Position | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const endpoint = `/api/d5o-hosted/rom-design?workspace=${encodeURIComponent(workspace)}&workId=${encodeURIComponent(work.id)}`;
  const estimate = work.discovery?.estimate;
  const offer = work.discovery?.proposal;
  const rom = estimate?.detailed?.input.estimateMaturity === "ROM";
  const current = Boolean(position && position.estimateRevision === estimate?.revision && position.offerRevision === offer?.package?.revision);
  const communicated = rom && estimate?.status === "Approved" && offer?.status === "Submitted";
  const lines = estimate?.detailed?.input.lines ?? [];
  const refresh = async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const data = await response.json();
    if (response.ok) setPosition(data as Position);
    else setMessage(data.error ?? "ROM Design position unavailable");
  };
  useEffect(() => {
    let active = true;
    fetch(endpoint, { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!active) return;
      if (response.ok) setPosition(data as Position);
      else setMessage(data.error ?? "ROM Design position unavailable");
    }).catch(() => { if (active) setMessage("ROM Design position unavailable"); });
    return () => { active = false; };
  }, [endpoint]);
  async function run(action: string, basis: Record<string, unknown>) {
    if (!position || !estimate || !offer?.package) return;
    setBusy(true);setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action, basis, commandId: crypto.randomUUID(), expectedSourceRevision: position.sourceRevision,
        expectedDecisionRevision: position.decisionRevision, estimateRevision: estimate.revision,
        offerRevision: offer.package.revision
      }) });
      const data = await response.json();
      if (!response.ok) { setMessage(data.error ?? "Decision not saved"); await refresh(); return; }
      setPosition(data as Position);
      setMessage(`${action === "record-budget-ack" ? "Budget acknowledgment recorded" : action === "authorize-design" ? "Detailed Design authorized" : "Design difference retained"}. The next decision is separate from delivery award and field authorization.`);
    } catch { setMessage("Connection interrupted; refresh this position before retrying."); }
    finally { setBusy(false); }
  }
  if (!rom) return null;
  return <section className={styles.content} aria-label="ROM communication and Design authorization">
    <h3>ROM to detailed Design</h3>
    <p>Estimate revision {estimate?.revision} · offer revision {offer?.package?.revision ?? "not prepared"}. A budget acknowledgment does not award delivery. Detailed Design permission does not authorize purchase, crew scheduling or execution.</p>
    <div className={styles.facts}><span><b>Internal ROM review</b>{estimate?.status}</span><span><b>Customer communication</b>{offer?.status ?? "Not prepared"}</span><span><b>Design permission</b>{!position?.status ? "Awaiting budget acknowledgment" : current ? position.status : "Source changed · reassess"}</span></div>
    {!communicated ? <p className={styles.issue}>Approve the exact ROM and communicate the independently approved ROM proposal before recording a customer budget acknowledgment.</p> : null}
    {focus && ((focus === "rom-budget-ack" && position?.status) || (focus === "rom-design-authorization" && (!current || position?.status !== "Acknowledged"))) ?
      <p role="alert" className={styles.issue}>This task was completed or its ROM source changed. No earlier decision can be repeated against another revision. <a href={`/work?workspace=${encodeURIComponent(workspace)}&view=my-work`}>Return to refreshed My Work</a>.</p> : null}
    {position?.acknowledgment ? <p><b>Reported customer position:</b> {position.acknowledgment.customerStatement} · {position.acknowledgment.customerRepresentative} · source {position.acknowledgment.sourceReference}</p> : null}
    {position?.authorization ? <p><b>Design authorization:</b> {position.authorization.authorizedExtent} · funding {position.authorization.fundingSource} · cap {formatMinor(Number(position.authorization.spendCapMinor), position.authorization.currency)} · source {position.authorization.sourceReference}</p> : null}
    {!reconciliationOnly && communicated && !position?.status && ["admin", "project_manager"].includes(role ?? "") ? <form className={styles.form} onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run("record-budget-ack", { customerRepresentative: field(form, "representative"), customerStatement: field(form, "statement"), sourceReference: field(form, "source") }); }}>
      <h4>Record reported budget acknowledgment</h4><label>Fictional customer representative<input name="representative" required /></label><label>Exact statement<textarea name="statement" required placeholder="The indicative budget is acceptable; proceed with Design assessment only" /></label><label>Retained source reference<input name="source" required /></label><button className="d5o-primary" disabled={busy}>Record acknowledgment</button>
    </form> : null}
    {!reconciliationOnly && current && position?.status === "Acknowledged" && estimate?.detailed?.policySnapshot.proposalApproverRole === role ? <form className={styles.form} onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const cap = field(form, "cap"); if (!/^\d+(\.\d{1,2})?$/.test(cap)) { setMessage("Use a valid currency amount for the internal Design spend cap."); return; } void run("authorize-design", { authorizedExtent: field(form, "extent"), fundingSource: field(form, "funding"), sourceReference: field(form, "source"), spendCapMinor: Math.round(Number(cap) * 100) }); }}>
      <h4>Independently authorize detailed Design</h4><label>Authorized extent<input name="extent" required placeholder="Detailed Design of the accepted ROM scope only" /></label><label>Internal funding basis<input name="funding" required /></label><label>Design spend cap ({estimate?.detailed?.input.currency})<input name="cap" inputMode="decimal" required /></label><label>Authority source reference<input name="source" required /></label><button className="d5o-primary" disabled={busy}>Authorize Design only</button>
    </form> : null}
    {current && position?.status === "Design authorized" && ["admin", "project_manager", "operations_leader"].includes(role ?? "") ? <form className={styles.form} onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run("record-reconciliation", { sourceReference: field(form, "source"), differences: [{ romLineId: field(form, "line"), designQuantity: field(form, "quantity"), designUnit: field(form, "unit"), cause: field(form, "cause"), explanation: field(form, "explanation") }] }); }}>
      <h4>Compare a Design finding with retained ROM</h4><p>Record the detailed quantity or method found. This does not reprice or release the work.</p><label>ROM estimating line<select name="line" required>{lines.map((line) => <option key={line.id} value={line.id}>{line.description} · {line.quantity} {line.unit}</option>)}</select></label><label>Detailed Design quantity<input name="quantity" type="number" min="0" step="any" required /></label><label>Design unit<input name="unit" required placeholder="link, cable-meter or person-hour" /></label><label>Difference cause<select name="cause">{causes.map((cause) => <option key={cause}>{cause}</option>)}</select></label><label>Explanation<textarea name="explanation" required /></label><label>Detailed Design source<input name="source" required /></label><button className="d5o-outline" disabled={busy}>Retain difference</button>
    </form> : null}
    {(position?.reconciliation ?? []).length ? <details><summary>Retained Design reconciliation history</summary>{position!.reconciliation!.map((entry, index) => <p key={index}>{entry.recordedAt} · {entry.sourceReference} · ROM revision {entry.estimateRevision} · {entry.differences.map((difference) => { const line = entry.estimateRevision === estimate?.revision ? lines.find((item) => item.id === difference.romLineId) : undefined; return `${line?.description ?? `Historical line ${difference.romLineId}`}: ${line ? `ROM ${line.quantity} ${line.unit}` : "open archived estimate for its original quantity"} → Design ${difference.designQuantity} ${difference.designUnit}; ${difference.cause}. ${difference.explanation} Cost impact is unpriced until current sourced rates and commercial approval are recorded.`; }).join(" · ")}</p>)}</details> : null}
    <p>Execution remains blocked until a separate award and the existing Design release, crew and field-start controls are satisfied.</p>
    {message ? <p role="status" className={styles.issue}>{message}</p> : null}
  </section>;
}
