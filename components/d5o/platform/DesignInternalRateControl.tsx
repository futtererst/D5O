"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { WorkspaceKey } from "./work-types";
import { moneyMinor } from "./job-finance-model";

type Rate = { id: string; rate_key: string; status: string; currency: string;
  base_rate_minor: number; burden_basis_points: number; effective_from: string; effective_until: string;
  source_reference: string; basis_note: string; prepared_by: string; review_note: string | null };
type Position = { revision: number; rates: Rate[] };
const cents = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value)
  ? String(BigInt(value.split(".")[0]) * BigInt(100) + BigInt((value.split(".")[1] ?? "").padEnd(2, "0"))) : null;
const input = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

export function DesignInternalRateControl({ workspace, role }: { workspace: WorkspaceKey; role: string }) {
  const [position, setPosition] = useState<Position | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const endpoint = `/api/d5o-hosted/design-internal-rate?workspace=${encodeURIComponent(workspace)}`;
  const refresh = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const body = await response.json() as Position & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Internal Design rates unavailable.");
    setPosition(body);
  }, [endpoint]);
  useEffect(() => {
    let active = true;
    void fetch(endpoint, { cache: "no-store" }).then(async (response) => {
      const body = await response.json() as Position & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Internal Design rates unavailable.");
      if (active) setPosition(body);
    }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Rates unavailable."); });
    return () => { active = false; };
  }, [endpoint]);
  async function command(action: string, value: Record<string, unknown>) {
    if (!position) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, input: value, commandId: crypto.randomUUID(), expectedRevision: position.revision }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Rate decision was not saved.");
      await refresh(); setMessage("Rate decision saved. Review the current version before valuing another claim.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Rate decision unavailable."); }
    finally { setBusy(false); }
  }
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const baseRateMinor = cents(input(data, "base"));
    const burdenBasisPoints = cents(input(data, "burden"));
    if (!baseRateMinor || burdenBasisPoints === null) { setMessage("Enter valid USD and percentage amounts."); return; }
    void command("prepare", { rateKey: input(data, "key"), baseRateMinor, burdenBasisPoints,
      effectiveFrom: input(data, "from"), effectiveUntil: input(data, "until"),
      sourceReference: input(data, "source"), basisNote: input(data, "basis") });
  }
  return <section aria-label="Internal Design cost rates">
    <h3>Internal Design cost rates</h3>
    <p>Finance prepares a dated base cost per person-hour and burden percentage. A separate administrator reviews it. These internal values do not set the customer ROM selling price or prove employee work.</p>
    <p role={message ? "status" : undefined}>{message || `Rate schedule revision ${position?.revision ?? "loading"}`}</p>
    {position?.rates.map((rate) => <article key={rate.id}>
      <p><b>{rate.rate_key} · {rate.status}</b> · {moneyMinor(rate.base_rate_minor, rate.currency)} base per person-hour + {(rate.burden_basis_points / 100).toFixed(2)}% burden · {rate.effective_from} to {rate.effective_until}</p>
      <p>Source {rate.source_reference}. {rate.basis_note} {rate.review_note ? `Review: ${rate.review_note}` : ""}</p>
      {role === "admin" && rate.status === "Prepared" ? <RateDecision busy={busy} onDecision={(action, reason) => void command(action, { rateId: rate.id, reason })} /> : null}
      {role === "admin" && rate.status === "Approved" ? <RateDecision busy={busy} retireOnly onDecision={(_, reason) => void command("retire", { rateId: rate.id, reason })} /> : null}
    </article>)}
    {role === "billing_commercial_lead" ? <form onSubmit={prepare}>
      <h4>Prepare a rate version for independent approval</h4>
      <label>Rate key<input name="key" pattern="[a-z][a-z0-9_-]{2,39}" defaultValue="design-standard" required /></label>
      <label>Base internal cost (USD per person-hour)<input name="base" type="number" min="0.01" step="0.01" required /></label>
      <label>Burden on base cost (%)<input name="burden" type="number" min="0" max="100" step="0.01" required /></label>
      <label>Effective from<input name="from" type="date" required /></label>
      <label>Effective until<input name="until" type="date" required /></label>
      <label>Retained rate source<input name="source" minLength={8} required /></label>
      <label>Calculation and applicability basis<textarea name="basis" minLength={10} required /></label>
      <button disabled={busy || !position}>Submit rate for independent approval</button>
    </form> : null}
    <p>Overtime, premiums and actual payroll remain outside this first rated Design-cost path. Hold those cases until an approved source and rule exists.</p>
  </section>;
}

function RateDecision({ busy, retireOnly = false, onDecision }: {
  busy: boolean; retireOnly?: boolean; onDecision: (action: "approve" | "return" | "retire", reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return <div><label>Independent decision rationale<input value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} /></label>
    {!retireOnly ? <><button type="button" disabled={busy || reason.trim().length < 10} onClick={() => onDecision("return", reason)}>Return rate</button>
      <button type="button" disabled={busy || reason.trim().length < 10} onClick={() => onDecision("approve", reason)}>Approve exact rate</button></>
      : <button type="button" disabled={busy || reason.trim().length < 10} onClick={() => onDecision("retire", reason)}>Retire future use</button>}
  </div>;
}
