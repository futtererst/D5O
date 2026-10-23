"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { WorkRecord } from "./work-types";
import style from "./OperateWorkspace.module.css";

type Entry = { entry_id: string; original_id: string | null; kind: string; amount_minor: number;
  category: string; allocation: string; incurred_date: string; source_ref: string;
  rationale: string; recorded_at: string };
type Position = { revision: number; workRevision: number; operateRevision: number;
  requestCycleAt: string; childWorkId: string; sourceDigest: string; reviewedHours: number | null;
  approvedUncoveredMinor: number | null; estimatedIncludedCostMinor: number | null;
  entries: Entry[]; active: Entry[];
  totals: { coveredMinor: number; uncoveredMinor: number; unallocatedMinor: number };
  invoice: { invoicedMinor: number; paidMinor: number; outstandingMinor: number };
  costCompleteness: string };
const money = (minor: number | null | undefined) => minor == null ? "Unknown" :
  new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(minor / 100);
const minor = (value: string) => {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(value.trim());
  return match ? (BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0"))).toString() : "";
};

export function ServiceActualCostPanel({ work, requestId, actorRole }: {
  work: WorkRecord; requestId: string; actorRole?: string;
}) {
  const [position, setPosition] = useState<Position | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [correcting, setCorrecting] = useState("");
  const endpoint = `/api/d5o-hosted/service-cost?workspace=${encodeURIComponent(work.workspace)}`;
  const refresh = useCallback(async () => {
    const response = await fetch(`${endpoint}&workId=${encodeURIComponent(work.id)}&requestId=${encodeURIComponent(requestId)}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Service cost position unavailable");
    setPosition(body);
  }, [endpoint, work.id, requestId]);
  useEffect(() => {
    let live = true;
    queueMicrotask(() => { if (live) void refresh().catch((cause) => {
      if (live) setError(String(cause));
    }); });
    return () => { live = false; };
  }, [refresh]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!position) return;
    const form = event.currentTarget; const data = new FormData(form);
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workId: work.id, requestId, action: correcting ? "correct-cost" : "record-cost",
          commandId: crypto.randomUUID(), expectedRevision: position.revision,
          expectedWorkRevision: position.workRevision, expectedOperateRevision: position.operateRevision,
          requestCycleAt: position.requestCycleAt, childWorkId: position.childWorkId,
          sourceDigest: position.sourceDigest, originalId: correcting || undefined,
          amountMinor: minor(String(data.get("amount") ?? "")), currency: "USD",
          category: String(data.get("category") ?? ""), allocation: String(data.get("allocation") ?? ""),
          incurredDate: String(data.get("incurredDate") ?? ""), source: String(data.get("source") ?? "").trim(),
          rationale: String(data.get("rationale") ?? "").trim() }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Cost action rejected");
      await refresh(); form.reset(); setCorrecting("");
    } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  }
  const totals = position?.totals;
  const incurred = position?.active.length ? (totals?.coveredMinor ?? 0) +
    (totals?.uncoveredMinor ?? 0) + (totals?.unallocatedMinor ?? 0) : null;
  const composition = position?.active.reduce<Record<string, number>>((rows, entry) => {
    const key = `${entry.category} · ${entry.allocation}`;
    rows[key] = (rows[key] ?? 0) + entry.amount_minor;
    return rows;
  }, {}) ?? {};
  const contribution = position && position.active.some((entry) => entry.allocation === "Uncovered") &&
    position.approvedUncoveredMinor != null ? position.approvedUncoveredMinor - (totals?.uncoveredMinor ?? 0) : null;
  return <section className={style.card} aria-label="Service actual costs and economics">
    <div className={style.cardHead}><h3>Sourced service costs and economics</h3>
      <p>Actual hours remain operational evidence. Only sourced cost entries establish incurred cost.</p></div>
    {error ? <p role="alert">{error}</p> : null}
    {!position ? <p>Loading committed service cost position…</p> : <>
      <div className={style.row}><b>USD service visit · cycle {position.requestCycleAt}</b>
        <span>Approved uncovered selling price {money(position.approvedUncoveredMinor)}
          · estimate included-cost basis {money(position.estimatedIncludedCostMinor)}
          · reviewed hours {position.reviewedHours ?? "unknown"}</span>
        <span>Invoiced {money(position.invoice.invoicedMinor)} · paid {money(position.invoice.paidMinor)} · receivable {money(position.invoice.outstandingMinor)}</span>
        <span>Recorded incurred cost {money(incurred)}: covered {money(totals?.coveredMinor)} · uncovered {money(totals?.uncoveredMinor)} · unallocated {money(totals?.unallocatedMinor)}</span>
        <span>Provisional uncovered contribution from recorded costs only: {money(contribution)}. Final margin: unknown.</span>
        <small>Cost completeness and allocation have not been certified. Other cost sources may remain unresolved. Covered-service revenue allocation is unavailable, so covered economics are incomplete.</small>
      </div>
      {position.active.length ? <div className={style.row}><b>Current recorded costs by category and allocation</b>
        {Object.entries(composition).map(([key, amount]) => <span key={key}>{key}: {money(amount)}</span>)}
        {position.active.map((entry) => <div key={entry.entry_id}>
          {entry.category} · {entry.allocation} · {money(entry.amount_minor)} · incurred {entry.incurred_date}
          · source {entry.source_ref} · {entry.rationale}
          {actorRole === "billing_commercial_lead" ? <button type="button" onClick={() => setCorrecting(entry.entry_id)}>Correct</button> : null}
        </div>)}</div> : <p>No sourced actual cost has been recorded. Incurred cost remains unknown.</p>}
      {position.entries.length ? <details><summary>Cost and correction history</summary>
        {position.entries.map((entry) => <p key={entry.entry_id}>{entry.kind} {entry.entry_id} · {money(entry.amount_minor)} · {entry.category}/{entry.allocation} · {entry.source_ref} · {entry.recorded_at}</p>)}
      </details> : null}
      {actorRole === "billing_commercial_lead" ? <form className={style.form} onSubmit={(event) => void submit(event)}>
        <b>{correcting ? `Correct cost ${correcting}` : "Record a fictional sourced incurred cost"}</b>
        <label>USD amount<input name="amount" required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" /></label>
        <label>Category<select name="category" required>{["Labor","Material","Equipment","Subcontract","Travel","Other"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Coverage allocation<select name="allocation" required>{["Unallocated","Covered","Uncovered"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Incurred date<input name="incurredDate" type="date" required /></label>
        <label>Source reference<input name="source" minLength={12} required /></label>
        <label>Recording rationale<input name="rationale" minLength={12} required /></label>
        <button disabled={busy}>{correcting ? "Record linked adjustment" : "Record cost"}</button>
        {correcting ? <button type="button" onClick={() => setCorrecting("")}>Cancel correction</button> : null}
      </form> : null}
      <p>Text source references identify external records but do not establish document custody, payroll posting or ERP reconciliation.</p>
    </>}
  </section>;
}
