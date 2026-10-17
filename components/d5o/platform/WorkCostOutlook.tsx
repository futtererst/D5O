"use client";

import { useEffect, useMemo, useState } from "react";
import { moneyMinor, type JobFinanceRead } from "./job-finance-model";
import styles from "./WorkCostOutlook.module.css";

type WorkAuthority = {
  parentCapMinor: number | null;
  designCommittedMinor: number;
  purchaseReservedMinor: number;
  subcontractReservedMinor: number;
  legacyPurchaseHold: boolean;
  authorities: Array<{ id: string; status: string }>;
};
type LaborAuthority = {
  parentAuthorityId: string | null;
  laborExposureMinor: number;
  laborCapMinor: number | null;
  reservations: Array<{ id: string; status: string; amount_minor: number }>;
};
type DesignSpend = {
  committedMinor: number;
  commitments: Array<{ id: string; status: string; amount_minor: number; source_reference: string }>;
};
type Position = { work: WorkAuthority; labor: LaborAuthority; design: DesignSpend };

const safeTotal = (values: number[]) => values.every(Number.isSafeInteger) &&
  Number.isSafeInteger(values.reduce((sum, value) => sum + value, 0))
  ? values.reduce((sum, value) => sum + value, 0) : null;

function sourceRows(finance: JobFinanceRead) {
  const categories = ["Design", "Material", "Equipment", "Subcontract", "Labor"];
  const names = [...categories, ...new Set(finance.costs.map((cost) => cost.category).filter((name) => !categories.includes(name)))];
  return names.map((category) => {
    const facts = finance.costs.filter((cost) => cost.category === category);
    const commitments = facts.filter((cost) => cost.kind === "Committed");
    const incurred = facts.filter((cost) => cost.kind === "Incurred");
    const open = commitments.map((commitment) => {
      const linked = safeTotal(incurred.filter((cost) => cost.reconciles_id === commitment.id).map((cost) => cost.amount_minor));
      return linked === null || linked > commitment.amount_minor ? NaN : commitment.amount_minor - linked;
    });
    return {
      category, facts,
      incurred: facts.length ? safeTotal(incurred.map((cost) => cost.amount_minor)) : null,
      open: commitments.length ? safeTotal(open) : null
    };
  });
}

/** A read-only bridge across existing ledgers. No new authority or cost fact is inferred here. */
export function WorkCostOutlook({ workspace, workId, finance }: {
  workspace: string; workId: string; finance: JobFinanceRead;
}) {
  const [position, setPosition] = useState<Position | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const base = `workspace=${encodeURIComponent(workspace)}&workId=${encodeURIComponent(workId)}`;
    void Promise.all(["purchase-authority", "labor-authority", "design-spend"].map(async (path) => {
      const response = await fetch(`/api/d5o-hosted/${path}?${base}`, { cache: "no-store" });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `${path} unavailable`);
      return body;
    })).then(([work, labor, design]) => {
      if (active) { setPosition({ work: work as WorkAuthority, labor: labor as LaborAuthority,
        design: design as DesignSpend }); setError(null); }
    }).catch((cause) => {
      if (active) { setPosition(null); setError(cause instanceof Error ? cause.message : "Cost sources unavailable"); }
    });
    return () => { active = false; };
  }, [workspace, workId, finance.revision]);

  const rows = useMemo(() => sourceRows(finance), [finance]);
  const currency = finance.currency ?? finance.baseline?.pricingBasis?.currency ?? null;
  const financeMoney = (amount: number | null) => currency ? moneyMinor(amount,currency) : "Currency unknown";
  const authority = position?.work;
  const labor = position?.labor;
  const design = position?.design;
  const incompatibleLabor = Boolean(labor?.parentAuthorityId && authority &&
    !authority.authorities.some((item) => item.id === labor.parentAuthorityId && item.status === "Approved"));
  const categoryConsumption = authority?.parentCapMinor != null && labor && !incompatibleLabor ? safeTotal([
    authority.designCommittedMinor, authority.purchaseReservedMinor,
    authority.subcontractReservedMinor, labor.laborExposureMinor
  ]) : null;
  const sourceMismatch = Boolean(authority && design &&
    authority.designCommittedMinor !== design.committedMinor);
  const remainingAuthority = authority?.parentCapMinor !== null && authority?.parentCapMinor !== undefined &&
    categoryConsumption !== null ? authority.parentCapMinor - categoryConsumption : null;
  const unlinkedDesign = (design?.commitments ?? []).filter((item) => item.status === "Approved" && item.amount_minor > 0);

  return <section className={styles.outlook} aria-label="Work cost sources and forecast limits">
    <h4>Work cost sources</h4>
    <p>Approved spend, outstanding commitments, incurred cost and remaining forecast are different facts. Open a category to inspect its retained Finance cost sources; no absent cost is assumed to be zero.</p>
    {error ? <p role="status">Authority source unavailable: {error}. A combined spending position cannot be stated.</p> : !position ? <p role="status">Loading governed Work authority…</p> : <>
      <p><b>Work authority (USD):</b> {moneyMinor(authority?.parentCapMinor ?? null,"USD")} approved · {moneyMinor(categoryConsumption,"USD")} consumed or reserved · {moneyMinor(remainingAuthority,"USD")} remaining.</p>
      <p>Design {moneyMinor(authority?.designCommittedMinor ?? null,"USD")} · purchasing {moneyMinor(authority?.purchaseReservedMinor ?? null,"USD")} · subcontract {moneyMinor(authority?.subcontractReservedMinor ?? null,"USD")} · labor {moneyMinor(labor?.laborExposureMinor ?? null,"USD")}. Each category is counted once within the Work limit; invoicing does not replenish it.</p>
      {authority?.parentCapMinor == null ? <p role="status">No current governed Work cap is recorded for this source. Historical incurred costs below remain valid, but zero current reservations do not mean the Work cost nothing.</p> : null}
      {currency && currency !== "USD" ? <p role="alert">Finance facts use {currency}; do not add them to the USD Work authority.</p> : null}
      {sourceMismatch ? <p role="alert">Design commitment reads disagree. Refresh the source decisions before using this total.</p> : null}
      {incompatibleLabor ? <p role="alert">Labor and Work authority refer to different decisions. No combined headroom is stated until their source basis is reconciled.</p> : null}
      {authority?.legacyPurchaseHold ? <p role="status">A historical PO lacks a current Work-authority link. Its history remains visible; the combined authority position is incomplete.</p> : null}
      {unlinkedDesign.length ? <p role="status">{unlinkedDesign.length} approved Design commitment{unlinkedDesign.length === 1 ? "" : "s"} have no stable link to a Finance incurred-cost record. Their commitment is visible above, but a complete final-cost or margin claim requires reconciliation.</p> : null}
    </>}
    <h4>Finance ledger by cost category</h4>
    <div className={styles.grid}>{rows.map((row) => <div className={styles.category} key={row.category}>
      <b>{row.category}</b><p>Incurred {financeMoney(row.incurred)} · unreconciled posted commitment {financeMoney(row.open)}</p>
      {row.facts.length ? <details><summary>{row.facts.length} retained source fact{row.facts.length === 1 ? "" : "s"}</summary>
        {row.facts.map((fact) => <p key={fact.id}>{fact.kind} · {financeMoney(fact.amount_minor)} · {fact.cost_date} · {fact.source}{fact.reconciles_id ? ` · reconciles ${fact.reconciles_id}` : ""}</p>)}</details> : <small>No sourced cost fact for this category.</small>}
    </div>)}</div>
    <p><b>Governed labor:</b> {finance.laborReservations?.length ?? 0} historical reservation{finance.laborReservations?.length === 1 ? "" : "s"}; current labor outstanding and reviewed cost appear in the Finance totals above. A reservation is not incurred cost.</p>
    <p><b>Remaining uncommitted work:</b> {financeMoney(finance.remainingForecastMinor)} · {finance.forecastSource ?? "No source recorded"}. A final margin remains provisional until costs are complete and any unlinked Design commitment is reconciled.</p>
  </section>;
}
