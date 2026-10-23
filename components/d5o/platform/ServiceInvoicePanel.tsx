"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { WorkRecord } from "./work-types";
import style from "./OperateWorkspace.module.css";

type Invoice = { invoice_id: string; invoice_number: string | null; status: string;
  revision: number; ledger_revision: number; amount_minor: number; currency: string;
  request_cycle_at: string; source_digest: string; invoice_date: string | null;
  due_date: string | null; payment_terms: string; issue_source: string | null };
type Payment = { payment_id: string; amount_minor: number; payment_date: string; source_ref: string };
type Position = { invoice: Invoice | null; payments: Payment[]; history: unknown[];
  invoicedMinor: number; paidMinor: number; outstandingMinor: number; sourceCurrent: boolean };
type Finance = { basisDigest: string; workRevision: number; operateRevision: number;
  revision: number; basis: { designRevision: number; deployRevision: number;
    uncoveredAmountMinor: string; currency: string; billingTermsKnown: boolean };
  decision: { status: string } | null; decisionCurrent: boolean };
const dollars = (minor: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(minor / 100);
const usdMinor = (value: string) => {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(value.trim());
  return match ? (BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0"))).toString() : "";
};

export function ServiceInvoicePanel({ work, requestId, actorRole, focusKind }: {
  work: WorkRecord; requestId: string; actorRole?: string; focusKind?: string | null;
}) {
  const [position, setPosition] = useState<Position | null>(null);
  const [finance, setFinance] = useState<Finance | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const suffix = "?workspace=" + encodeURIComponent(work.workspace) +
    "&workId=" + encodeURIComponent(work.id) + "&requestId=" + encodeURIComponent(requestId);
  const refresh = useCallback(async () => {
    const [a,b] = await Promise.all([
      fetch("/api/d5o-hosted/service-invoice" + suffix, { cache: "no-store" }),
      fetch("/api/d5o-hosted/service-finance" + suffix, { cache: "no-store" })
    ]);
    const [invoiceBody, financeBody] = await Promise.all([a.json(), b.json()]);
    if (!a.ok) throw new Error(invoiceBody.error ?? "Invoice unavailable");
    if (!b.ok) throw new Error(financeBody.error ?? "Finance basis unavailable");
    setPosition(invoiceBody); setFinance(financeBody);
  }, [suffix]);
  useEffect(() => {
    let live = true;
    queueMicrotask(() => { if (live) void refresh().catch((cause) => {
      if (live) setError(String(cause));
    }); });
    return () => { live = false; };
  }, [refresh]);
  async function submit(event: FormEvent<HTMLFormElement>, action: string) {
    event.preventDefault();
    if (!position || !finance) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/d5o-hosted/service-invoice?workspace=" +
        encodeURIComponent(work.workspace), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workId: work.id, requestId, action, commandId: crypto.randomUUID(),
          expectedWorkRevision: finance.workRevision,
          expectedOperateRevision: finance.operateRevision,
          expectedDesignRevision: finance.basis.designRevision,
          expectedDeployRevision: finance.basis.deployRevision,
          expectedFinanceRevision: finance.revision,
          basisDigest: finance.basisDigest,
          expectedInvoiceRevision: position.invoice?.revision ?? 0,
          expectedLedgerRevision: position.invoice?.ledger_revision ?? 0,
          note: String(values.get("note") ?? "").trim(),
          source: String(values.get("source") ?? "").trim(),
          invoiceDate: String(values.get("invoiceDate") ?? ""),
          paymentDate: String(values.get("paymentDate") ?? ""),
          amountMinor: action === "record-payment"
            ? usdMinor(String(values.get("amount") ?? "")) : undefined
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Service invoice action rejected");
      await refresh(); form.reset();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  const invoice = position?.invoice;
  const ready = finance?.decisionCurrent && finance.decision?.status === "Ready for billing";
  return <section className={style.card} aria-label="Service invoice and receivable">
    <div className={style.cardHead}><h3>Service invoice and receivable</h3>
      <p>Fictional USD fixed fee for approved uncovered scope. No invoice is sent or funds collected here.</p></div>
    {error ? <p role="alert">{error}</p> : null}
    {!position || !finance ? <p>Loading committed invoice position…</p> : <>
      <div className={style.row}>
        <b>{invoice ? (invoice.invoice_number ?? "Unissued draft") + " · " + invoice.status : "No invoice drafted"}</b>
        <span>Approved uncovered {dollars(Number(finance.basis.uncoveredAmountMinor ?? 0))}
          · {finance.basis.currency}</span>
        <span>Invoiced {dollars(position.invoicedMinor)} · paid {dollars(position.paidMinor)}
          · outstanding {dollars(position.outstandingMinor)}</span>
        {invoice ? <small>Request cycle {invoice.request_cycle_at}
          · invoice revision {invoice.revision} · ledger revision {invoice.ledger_revision}
          · {invoice.payment_terms}</small> : null}
        {invoice?.invoice_date ? <small>Invoice date {invoice.invoice_date}
          · due {invoice.due_date} · issuance source {invoice.issue_source}</small> : null}
      </div>
      {invoice && !position.sourceCurrent ? <p role="alert">Current service source changed. The issued invoice and payments remain intact; new billing decisions require reassessment.</p> : null}
      {invoice?.status === "Issued" ? <p>Issued scope and amount are frozen. Cancellation, credits, tax and adjustments are unsupported.</p> : null}
      {actorRole === "project_manager" && (!focusKind || focusKind === "Service invoice drafting") && !invoice && ready && finance.basis.billingTermsKnown ?
        <form className={style.form} onSubmit={(event) => void submit(event, "draft")}>
          <b>Draft exact approved uncovered amount</b>
          <label>Preparation reason<input name="note" required minLength={12} /></label>
          <button disabled={busy}>Draft service invoice</button>
        </form> : null}
      {actorRole === "project_manager" && (!focusKind || focusKind === "Service invoice preparation") && invoice?.status === "Draft" && position.sourceCurrent ?
        <form className={style.form} onSubmit={(event) => void submit(event, "submit")}>
          <label>Submission basis<input name="note" required minLength={12} /></label>
          <button disabled={busy}>Submit invoice for Finance review</button>
        </form> : null}
      {actorRole === "project_manager" && (!focusKind || focusKind === "Service invoice preparation") && (invoice?.status === "Returned" || (invoice?.status === "Draft" && !position.sourceCurrent)) ?
        <form className={style.form} onSubmit={(event) => void submit(event, "revise")}>
          <label>Correction and current source<input name="note" required minLength={12} /></label>
          <button disabled={busy}>Revise returned draft</button>
        </form> : null}
      {actorRole === "billing_commercial_lead" && (!focusKind || focusKind === "Service invoice review") && (invoice?.status === "In review" || invoice?.status === "Reviewed" && !position.sourceCurrent) ? <>
        <form className={style.form} onSubmit={(event) => void submit(event, "review")}>
          <label>Independent source and amount review<input name="note" required minLength={12} /></label>
          <button disabled={busy || !position.sourceCurrent}>Approve exact invoice draft</button>
        </form>
        <form className={style.form} onSubmit={(event) => void submit(event, "return")}>
          <label>Correction required<input name="note" required minLength={12} /></label>
          <button disabled={busy}>Return unissued draft</button>
        </form>
      </> : null}
      {actorRole === "billing_commercial_lead" && (!focusKind || focusKind === "Service invoice issuance") && invoice?.status === "Reviewed" ?
        <form className={style.form} onSubmit={(event) => void submit(event, "issue")}>
          <b>Record fictional issuance</b>
          <label>Invoice date<input name="invoiceDate" type="date" required defaultValue={new Date().toISOString().slice(0,10)} /></label>
          <label>Retained internal issuance source<input name="source" required minLength={12} /></label>
          <button disabled={busy || !position.sourceCurrent}>Record issued invoice</button>
        </form> : null}
      {actorRole === "billing_commercial_lead" && (!focusKind || focusKind === "Service payment recording") && invoice?.status === "Issued" &&
        position.outstandingMinor > 0 ?
        <form className={style.form} onSubmit={(event) => void submit(event, "record-payment")}>
          <b>Record fictional payment against {invoice.invoice_number}</b>
          <label>Payment amount (USD)<input name="amount" type="number" min="0.01"
            max={position.outstandingMinor / 100} step="0.01" required /></label>
          <label>Payment date<input name="paymentDate" type="date" required
            defaultValue={new Date().toISOString().slice(0,10)} /></label>
          <label>Retained receipt/source reference<input name="source" required minLength={12} /></label>
          <button disabled={busy}>Record payment fact</button>
        </form> : null}
      {position.payments.length ? <div className={style.row}><b>Retained payment events</b>
        {position.payments.map((payment) => <small key={payment.payment_id}>
          {dollars(payment.amount_minor)} · {payment.payment_date}
          · {payment.source_ref} · {payment.payment_id}</small>)}</div> : null}
      <small>{position.history.length} retained invoice/receivable event(s).
        Ready, issued, paid and operationally Closed are separate positions.</small>
    </>}
  </section>;
}
