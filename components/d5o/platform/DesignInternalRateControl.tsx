"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { WorkspaceKey } from "./work-types";
import { moneyMinor } from "./job-finance-model";
import { useAdminCommand } from "@/components/d5o/admin/useAdminCommand";

type Rate = { id: string; rate_key: string; status: string; currency: string;
  base_rate_minor: number; burden_basis_points: number; effective_from: string; effective_until: string;
  source_reference: string; basis_note: string; prepared_by: string; review_note: string | null };
type Position = { revision: number; rates: Rate[] };
type ReviewRoute = { revision: number; canReview: boolean; route: string; fullyBurdenedRateMinor: number | null };
const cents = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value)
  ? String(BigInt(value.split(".")[0]) * BigInt(100) + BigInt((value.split(".")[1] ?? "").padEnd(2, "0"))) : null;
const input = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

export function DesignInternalRateControl({ workspace, role, onRevision }: {
  workspace: WorkspaceKey; role: string; onRevision?: (revision: number) => void;
}) {
  const [position, setPosition] = useState<Position | null>(null);
  const [reviewRoutes, setReviewRoutes] = useState<Record<string, ReviewRoute>>({});
  const endpoint = `/api/d5o-hosted/design-internal-rate?workspace=${encodeURIComponent(workspace)}`;
  const refresh = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const body = await response.json() as Position & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Internal Design rates unavailable.");
    setPosition(body);
    setReviewRoutes({});
    if (role === "admin") {
      const entries = await Promise.all(body.rates.filter((rate) => rate.status === "Prepared").map(async (rate) => {
        const routeResponse = await fetch(`/api/d5o-hosted/spending-review-route?workspace=${encodeURIComponent(workspace)}&category=internal_design_rate&subjectId=${encodeURIComponent(rate.id)}`, { cache: "no-store" });
        if (!routeResponse.ok) return [rate.id, { revision: body.revision, canReview: false,
          route: "The configured reviewer could not be checked. Refresh before deciding.", fullyBurdenedRateMinor: null }] as const;
        const route = await routeResponse.json() as { canReview?: boolean; route?: string; fullyBurdenedRateMinor?: number };
        const amount = typeof route.fullyBurdenedRateMinor === "number" ? route.fullyBurdenedRateMinor : null;
        return [rate.id, { revision: body.revision, canReview: route.canReview === true && amount !== null,
          route: amount === null ? "The reviewed hourly cost is unavailable. Refresh before deciding." :
            route.route ?? "This review is not assigned to you.",
          fullyBurdenedRateMinor: amount }] as const;
      }));
      setReviewRoutes(Object.fromEntries(entries));
    }
    onRevision?.(body.revision);
  }, [endpoint, onRevision, role, workspace]);
  const { pending, busy, canRetry, message, setMessage, execute, reconcile, retry } = useAdminCommand(workspace, refresh);
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Rates unavailable.")); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh, setMessage]);
  function command(action: string, value: Record<string, unknown>) {
    if (!position) return;
    execute(endpoint, { action, input: value, expectedRevision: position.revision },
      "Rate decision saved. Review the current version before valuing another claim.");
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
    <h2>Internal Design cost rates</h2>
    <p>Finance prepares a dated base cost per person-hour and burden percentage. The configured independent administrator reviews the exact version. These internal values do not set the customer ROM selling price or prove employee work.</p>
    <p role={message ? "status" : undefined}>{message || `Rate schedule revision ${position?.revision ?? "loading"}`}</p>
    {pending && <p>Command {pending.commandId} awaits reconciliation. <button type="button" disabled={busy} onClick={() => void reconcile()}>Check receipt</button> <button type="button" disabled={busy || !canRetry} onClick={retry}>Retry this command</button></p>}
    {position?.rates.map((rate) => <article key={rate.id}>
      <p><b>{rate.rate_key} · {rate.status}</b> · {moneyMinor(rate.base_rate_minor, rate.currency)} base per person-hour + {(rate.burden_basis_points / 100).toFixed(2)}% burden · {rate.effective_from} to {rate.effective_until}</p>
      <p>Source {rate.source_reference}. {rate.basis_note} {rate.review_note ? `Review: ${rate.review_note}` : ""}</p>
      {role === "admin" && rate.status === "Prepared" ? reviewRoutes[rate.id]?.revision === position.revision && reviewRoutes[rate.id].canReview ?
        <><p>Reviewed fully burdened hourly cost: {moneyMinor(reviewRoutes[rate.id].fullyBurdenedRateMinor!, rate.currency)}.</p>
        <RateDecision busy={busy || Boolean(pending)} onDecision={(action, reason) => command(action, { rateId: rate.id, reason })} /></> :
        <p>{reviewRoutes[rate.id]?.route ?? "Checking the configured independent reviewer."}</p> : null}
      {role === "admin" && rate.status === "Approved" ? <RateDecision busy={busy || Boolean(pending)} retireOnly onDecision={(_, reason) => command("retire", { rateId: rate.id, reason })} /> : null}
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
      <button disabled={busy || Boolean(pending) || !position}>Submit rate for independent approval</button>
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
