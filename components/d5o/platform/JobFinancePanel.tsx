"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { WorkRecord } from "./work-types";

import { assessJobFinance, dollarsToMinor, invoiceBalance, moneyMinor, type JobFinanceRead } from "./job-finance-model";
import { deployState } from "./deploy-model";
import { FocusedTaskFrame } from "./FocusedTaskFrame";
import { WorkCostOutlook } from "./WorkCostOutlook";
import { DesignCostAssessment } from "./DesignCostAssessment";
import { DesignInternalRateControl } from "./DesignInternalRateControl";

import style from "./OperateWorkspace.module.css";

const field = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

export function JobFinancePanel({ work, actorRole }: { work: WorkRecord; actorRole: string }) {

  const [state, setState] = useState<JobFinanceRead | null>(null);

  const [error, setError] = useState("");

  const [busy, setBusy] = useState(false);
  const [billingPackageId, setBillingPackageId] = useState("");
  const [rateRevision, setRateRevision] = useState<number | null>(null);
  const [designCostRevision, setDesignCostRevision] = useState<number | null>(null);

  const canFinance = actorRole === "billing_commercial_lead";

  const canDraft = canFinance || actorRole === "project_manager";

  const load = useCallback(async () => {

    const response = await fetch(`/api/d5o-hosted/job-finance?workspace=${encodeURIComponent(work.workspace)}&workId=${encodeURIComponent(work.id)}`, { cache: "no-store" });

    const body = await response.json() as JobFinanceRead & { error?: string };

    if (!response.ok) throw new Error(body.error ?? "Job finance unavailable");

    setState(body); setError("");

  }, [work.workspace, work.id]);

  useEffect(() => { void Promise.resolve().then(load).catch((cause) => setError(cause instanceof Error ? cause.message : "Job finance unavailable")); }, [load]);

  async function send(action: string, data: Record<string, unknown>) {

    if (!state) return;

    setBusy(true); setError("");

    try {

      const response = await fetch("/api/d5o-hosted/job-finance", { method: "POST",

        headers: { "Content-Type": "application/json" }, body: JSON.stringify({

          workspace: work.workspace, workId: work.id, action, data,

          expectedRevision: state.revision, commandId: crypto.randomUUID()

        }) });

      const result = await response.json() as { error?: string };

      if (!response.ok) throw new Error(result.error ?? "Finance action rejected");

      await load();

    } catch (cause) { setError(cause instanceof Error ? cause.message : "Finance action unavailable"); }

    finally { setBusy(false); }

  }

  const submit = (action: string, map: (data: FormData) => Record<string, unknown>) =>

    (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void send(action,map(new FormData(event.currentTarget))); };

  if (!state) return <section className={style.card}><h3>Job financial position</h3><p role={error ? "alert" : "status"}>{error || "Loading sourced job costs and billing…"}</p></section>;

  const view = assessJobFinance(state,work);
  const financeClosed = state.financeStatus === "Closed";

  const currency = view.currency ?? "USD";
  const params = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const taskKind = params?.get("focus") === "finance" ? params.get("taskKind") : null;
  const exactBillId = params?.get("decision");
  const exactBill = state.bills.find((item) => item.id === exactBillId);
  const financeHref = (kind: string, billId?: string, revision?: number) => {
    const link = new URLSearchParams({ workspace: work.workspace, view: "record", record: work.id,
      section: "Operate", focus: "finance", taskKind: kind });
    if (billId) link.set("decision", billId);
    if (revision !== undefined) link.set("sourceRevision", String(revision));
    return `/work?${link}`;
  };
  if (!taskKind) return <section className={style.card} aria-label="Job Finance actions">
    <h3>Job Finance</h3><p>{work.title} · {work.customer} · {work.site}</p>
    <p><strong>{financeClosed ? "Finance Closed" : `Finance ${state.financeStatus ?? "pending"}`}</strong> · revised contract {moneyMinor(view.revised,currency)} · billed {moneyMinor(view.billed,currency)} · paid {moneyMinor(view.paid,currency)} · outstanding {moneyMinor(view.receivable,currency)}</p>
    {view.blocked.length ? <p role="status">{view.blocked.join(" ")}</p> : null}
    <nav aria-label="Choose a Finance task" className={style.actions}>
      {(canFinance || actorRole === "admin") ? <a href={financeHref("design-rate")}>Internal Design cost rates</a> : null}
      {canFinance && !financeClosed ? <><a href={financeHref("job-cost")}>Record sourced cost</a><a href={financeHref("job-forecast")}>Record remaining-cost forecast</a></> : null}
      {canDraft && !financeClosed && view.eligible.length ? <a href={financeHref("job-draft-bill")}>Prepare billing draft</a> : null}
      {state.bills.map((bill) => <a key={bill.id} href={financeHref(bill.status === "In review" ? "bill-review" : bill.status === "Reviewed" && (invoiceBalance(state,bill.id).outstanding ?? 0) > 0 ? "job-payment" : "job-invoice", bill.id,bill.revision)}>
        {bill.status} billing record · {bill.id.slice(0,8)} · {moneyMinor(invoiceBalance(state,bill.id).outstanding,currency)} unpaid</a>)}
      <a href={financeHref("full")}>Supporting ledger, source events and history</a>
    </nav>
  </section>;
  if (taskKind === "design-rate") return <FocusedTaskFrame
    title="Configure internal Design cost rate" work={work.title} customer={work.customer} site={work.site}
    workspace={work.workspace} scope="Workspace-wide USD cost per Design person-hour; separate from customer selling price"
    revision={rateRevision ?? "loading"} outcome="Finance prepares a dated rate; an independent administrator approves exact use."
    blocker={null} nextOwner={canFinance ? "Independent workspace administrator" : "Finance rate preparer"}
    onFullRecord={() => window.location.assign(financeHref("full"))}>
    <DesignInternalRateControl workspace={work.workspace} role={actorRole} onRevision={setRateRevision} />
  </FocusedTaskFrame>;
  if (taskKind === "design-cost" || taskKind === "outlook-assessment") return <FocusedTaskFrame
    title={taskKind === "design-cost" ? "Reconcile Design commitment and actual cost" : "Assess Work cost-outlook completeness"}
    work={work.title} customer={work.customer} site={work.site} workspace={work.workspace}
    scope={`Exact Work ${work.id} · Design commitment and Finance cost basis`}
    revision={params?.has("sourceRevision") ? Number(params.get("sourceRevision")) : designCostRevision ?? "loading"}
    outcome={taskKind === "design-cost" ? "Link the approved Design commitment and obtain independent review of sourced actual cost." : "Record category-specific gaps and obtain an independent Finance assessment."}
    blocker={null} nextOwner={canFinance ? "Assigned project manager for correction or next forecast" : "Independent Finance reviewer"}
    onFullRecord={() => window.location.assign(financeHref("full"))}>
    <DesignCostAssessment work={work} actorRole={actorRole} onCommitted={load} mode={taskKind}
      onRevision={setDesignCostRevision}
      expectedRevision={params?.has("sourceRevision") ? Number(params.get("sourceRevision")) : undefined}
      decisionId={params?.get("decision")} remainingForecastMinor={state.remainingForecastMinor}
      forecastSource={state.forecastSource} />
  </FocusedTaskFrame>;
  if (taskKind !== "full") {
    const balance = exactBill ? invoiceBalance(state, exactBill.id) : null;
    const requiresBill = ["bill-review", "job-invoice", "job-payment"].includes(taskKind);
    const stale = requiresBill && (!exactBill || (params?.has("sourceRevision") && exactBill.revision !== Number(params.get("sourceRevision"))) ||
      (taskKind === "bill-review" && exactBill.status !== "In review") ||
      (taskKind === "job-invoice" && (exactBill.status !== "Reviewed" || (balance?.billed ?? 0) > 0)) ||
      (taskKind === "job-payment" && (exactBill.status !== "Reviewed" || (balance?.outstanding ?? 0) <= 0)));
    if (stale) return <section className={style.card} role="status"><h2>This Finance task changed or was decided</h2>
      <p>The exact bill revision is unavailable. No other bill was selected.</p><a href={`/work?workspace=${encodeURIComponent(work.workspace)}&view=my-work`}>Return to refreshed My Work</a></section>;
    return <FocusedTaskFrame title={({ "bill-review": "Review billing record", "job-cost": "Record sourced cost", "job-forecast": "Forecast remaining cost", "job-draft-bill": "Prepare billing draft", "job-invoice": "Record invoice", "job-payment": "Record payment", "job-closeout": "Review Finance closeout" } as Record<string,string>)[taskKind] ?? "Finance task"}
      work={work.title} customer={work.customer} site={work.site} workspace={work.workspace}
      scope={exactBill ? `Billing record ${exactBill.id} · ${exactBill.lines.map((line) => `${work.packages?.find((pkg) => pkg.id === line.packageId)?.name ?? "Package"}: ${line.description}`).join("; ")}` : `Authorized contract ${moneyMinor(view.revised,currency)}`}
      revision={exactBill?.revision ?? state.revision} outcome={taskKind === "job-payment" ? "Record a sourced receivable payment against this retained invoice." : "Record only the decision or financial fact shown below."}
      blocker={view.blocked[0] ?? null} nextOwner={taskKind === "bill-review" ? "Project manager for correction, or Finance for invoice recording" : "Next eligible Finance or project role"}
      onFullRecord={() => window.location.assign(financeHref("full"))}
      context={<><p>Original contract {moneyMinor(view.original,currency)} · revised {moneyMinor(view.revised,currency)}</p>
        <p>Incurred {moneyMinor(view.incurred,currency)} · commitments {moneyMinor(view.outstanding,currency)} · remaining forecast {moneyMinor(view.remaining,currency)}</p>
        {exactBill?.basis ? <p>Design revision {exactBill.basis.designRevision} · Deploy revision {exactBill.basis.deployRevision} · {exactBill.basis.lines.length} accepted lines</p> : null}</>}>
      {error ? <p role="alert">{error}</p> : null}
      {exactBill && balance ? <p><strong>{exactBill.status}</strong> · billed {moneyMinor(balance.billed,currency)} · paid {moneyMinor(balance.paid,currency)} · unpaid {moneyMinor(balance.outstanding,currency)}</p> : null}
      {taskKind === "bill-review" && exactBill?.status === "In review" && canFinance && !financeClosed ? <form className={style.form} onSubmit={submit("review-bill",(data)=>({billId:exactBill.id,billRevision:exactBill.revision,decision:field(data,"decision"),reason:field(data,"reason")}))}>
        <p>{exactBill.lines.map((line)=>`${line.description} · ${moneyMinor(line.amountMinor,currency)} · proof ${line.evidenceId}`).join("; ")}</p>
        <label>Decision<select name="decision"><option>Reviewed</option><option>Returned</option></select></label><label>Reason<input name="reason" minLength={10} required /></label><button disabled={busy}>Save Finance review</button></form> : null}
      {taskKind === "job-payment" && exactBill?.status === "Reviewed" && canFinance && balance && (balance.outstanding ?? 0) > 0 ? <form className={style.form} onSubmit={submit("record-paid",(data)=>({billId:exactBill.id,billRevision:exactBill.revision,amountMinor:dollarsToMinor(field(data,"amount")),eventDate:field(data,"date"),source:field(data,"source")}))}>
        <label>Payment amount ({currency})<input name="amount" type="number" min="0.01" max={((balance.outstanding ?? 0)/100).toFixed(2)} step="0.01" required /></label><label>Date<input name="date" type="date" required /></label><label>Retained source reference<input name="source" minLength={8} required /></label><button disabled={busy}>Record payment fact</button></form> : null}
      {taskKind === "job-invoice" && exactBill?.status === "Reviewed" && canFinance && !financeClosed ? <form className={style.form} onSubmit={submit("record-billed",(data)=>({billId:exactBill.id,billRevision:exactBill.revision,amountMinor:dollarsToMinor(field(data,"amount")),eventDate:field(data,"date"),source:field(data,"source")}))}>
        <label>Recorded billed amount ({currency})<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Date<input name="date" type="date" required /></label><label>External billing reference<input name="source" minLength={8} required /></label><button disabled={busy}>Record invoice fact</button></form> : null}
      {taskKind === "job-cost" && canFinance && !financeClosed ? <form className={style.form} onSubmit={submit("add-cost",(data)=>({category:field(data,"category"),kind:field(data,"kind"),amountMinor:dollarsToMinor(field(data,"amount")),costDate:field(data,"date"),source:field(data,"source"),packageId:field(data,"packageId")||undefined}))}>
        <label>Kind<select name="kind"><option>Incurred</option><option>Committed</option></select></label><label>Category<select name="category">{!state.governedLabor && <option>Labor</option>}<option>Material</option><option>Equipment</option><option>Subcontract</option></select></label><label>Amount ({currency})<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Date<input name="date" type="date" required /></label><label>Package<select name="packageId"><option value="">Whole job</option>{work.packages?.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Source<input name="source" minLength={8} required /></label><button disabled={busy}>Record sourced cost</button></form> : null}
      {taskKind === "job-forecast" && canFinance && !financeClosed ? <form className={style.form} onSubmit={submit("set-remaining",(data)=>({amountMinor:dollarsToMinor(field(data,"amount")),forecastAt:field(data,"date"),source:field(data,"source")}))}>
        <label>Remaining cost ({currency})<input name="amount" type="number" min="0" step="0.01" required /></label><label>Assessment date<input name="date" type="date" required /></label><label>Basis and source<input name="source" minLength={8} required /></label><button disabled={busy}>Save forecast</button></form> : null}
      {taskKind === "job-draft-bill" && canDraft && !financeClosed && view.eligible.length ? <form className={style.form} onSubmit={submit("draft-bill",(data)=>({lines:[{packageId:field(data,"packageId"),description:field(data,"description"),amountMinor:dollarsToMinor(field(data,"amount")),quantity:field(data,"quantity"),unit:field(data,"unit"),evidenceId:field(data,"evidenceId") }]}))}>
        <label>Accepted package<select name="packageId" required value={billingPackageId || view.eligible[0]?.packageId || ""} onChange={(event)=>setBillingPackageId(event.target.value)}>{view.eligible.map((item)=><option key={item.packageId} value={item.packageId}>{item.packageName}</option>)}</select></label><label>Line scope<input name="description" minLength={5} required /></label><label>Quantity<input name="quantity" type="number" min="0.001" step="0.001" required /></label><label>Unit<input name="unit" required /></label><label>Amount ({currency})<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Reviewed evidence<select name="evidenceId" required><option value="">Choose proof</option>{view.eligible.filter((item)=>item.packageId === (billingPackageId || view.eligible[0]?.packageId)).flatMap((item)=>item.evidence.map((proof)=><option key={proof.id} value={proof.id}>{proof.filename}</option>))}</select></label><button disabled={busy}>Save billing draft</button></form> : null}
      {taskKind === "job-closeout" ? <p>Finance closeout is a separate decision in the Work Record. Billing and receivable collection remain distinct.</p> : null}
    </FocusedTaskFrame>;
  }

  return <section className={style.card}>

    <h3>Job cost, margin and billing readiness</h3>

    <p>Fixed-price pilot basis · {view.currency ?? "currency unknown"}. Amounts are separate from support activation and physical acceptance. Where approved labor authority and a matching published assignment exist, independently reviewed field hours post sourced incurred labor cost. Legacy or unmatched hours remain operational evidence only.</p>
    <p role="status"><strong>{financeClosed ? "Finance Closed" : `Finance ${state.financeStatus ?? "position unknown"}`}</strong> · {view.billed === 0 ? "No invoice recorded" : view.receivable === 0 ? "Paid in full" : `${moneyMinor(view.receivable,currency)} outstanding receivable`}. Closeout and payment are separate decisions.</p>

    <WorkCostOutlook workspace={work.workspace} workId={work.id} finance={state} />
    {(actorRole === "project_manager" || canFinance) ?
      <DesignCostAssessment work={work} actorRole={actorRole} onCommitted={load}
        remainingForecastMinor={state.remainingForecastMinor} forecastSource={state.forecastSource} /> : null}

    {error ? <p role="alert">{error}</p> : null}

    <div className={style.grid}>

      <span><b>Original awarded contract</b>{moneyMinor(view.original, currency)}<small>Offer rev {state.baseline?.revision ?? "unknown"} · event {state.baseline?.awardEventId ?? "unavailable"}</small></span>

      <span><b>Approved estimate cost basis</b>{moneyMinor(state.baseline?.pricingBasis?.includedCostMinor ?? null,currency)}<small>Estimate rev {state.baseline?.estimateRevision ?? "unknown"} · policy {state.baseline?.pricingBasis?.policyId ?? "unknown"} v{state.baseline?.pricingBasis?.policyVersion ?? "?"}. This is the pricing basis, not actual incurred cost.</small></span>

      <span><b>Authorized changes</b>{moneyMinor(view.revised === null || view.original === null ? null : view.revised-view.original,currency)}<small>{view.changes.length} exact change records</small></span>

      <span><b>Revised contract value</b>{moneyMinor(view.revised,currency)}</span>

      <span><b>Incurred cost</b>{moneyMinor(view.incurred,currency)}</span>

      <span><b>Outstanding commitments</b>{moneyMinor(view.outstanding,currency)}</span>

      <span><b>Remaining uncommitted forecast</b>{moneyMinor(view.remaining,currency)}<small>{state.forecastSource ?? "No source recorded"}</small></span>

      <span><b>Forecast final cost</b>{moneyMinor(view.forecastFinal,currency)}</span>

      <span><b>Forecast gross profit / margin</b>{moneyMinor(view.forecastProfit,currency)} · {view.forecastMargin === null ? "Unknown" : `${view.forecastMargin.toFixed(1)}%`}</span>

      <span><b>Recorded billed / paid</b>{moneyMinor(view.billed,currency)} / {moneyMinor(view.paid,currency)}</span>
      <span><b>Outstanding receivable</b>{moneyMinor(view.receivable,currency)}</span>

    </div>

    {view.blocked.length ? <p role="status">{view.blocked.join(" ")}</p> : null}

    <h4>Reviewed field activity supporting cost review</h4>

    {deployState(work).reports.filter((report) => report.status === "Reviewed").map((report) => <p key={report.id}>{report.date} · package {report.packageId} · {report.laborHours} reviewed hours · {report.quantity} {report.unit} · report {report.id}. Check the cost source below for a matching posted labor fact.</p>)}

    <h4>Authorized field-labor reservations</h4>
    {state.laborReservations?.length ? state.laborReservations.map((item) => <p key={item.id}>
      {item.workDate} · package {item.packageId} · {item.person} · {item.authorizedHours} authorized person-hours / {moneyMinor(item.reservedMinor,currency)} reserved · {item.actualHours} reviewed hours / {moneyMinor(item.incurredMinor,currency)} incurred · {item.status} · rate version {item.rateVersion}
      {item.incurredMinor > item.reservedMinor ? " · actual-cost overrun requires review" : ""}
    </p>) : <p>No governed labor reservations recorded. Historical reviewed hours do not acquire an invented rate.</p>}

    <h4>Authorized change drill-down</h4>

    {view.changes.length ? view.changes.map((item) => <p key={item.id}>Package {item.packageId} · {moneyMinor(item.amountMinor,currency)} · customer authority and revised Design release {item.revisedReleaseId}</p>) : <p>No authorized revised scope is counted.</p>}

    <h4>Cost composition and sources</h4>

    {state.costs.length ? state.costs.map((item) => <p key={item.id}>{item.kind} · {item.category} · {moneyMinor(item.amount_minor,currency)} · {item.cost_date} · package {item.package_id ?? "job"} · {item.source}{item.reconciles_id ? ` · reduces commitment ${item.reconciles_id}` : ""}</p>) : <p>No incurred or committed costs recorded. Unknown actual costs are not zero.</p>}

    {canFinance && !financeClosed ? <div className={style.grid}>

      <form className={style.form} onSubmit={submit("add-cost",(data)=>({ category: field(data,"category"),kind:field(data,"kind"),amountMinor:dollarsToMinor(field(data,"amount")),costDate:field(data,"date"),source:field(data,"source"),packageId:field(data,"packageId")||undefined,reconcilesId:field(data,"reconcilesId")||undefined }))}>

        <h4>Record sourced cost or commitment</h4><label>Kind<select name="kind"><option>Incurred</option><option>Committed</option></select></label><label>Category<select name="category">{!state.governedLabor && <option>Labor</option>}<option>Material</option><option>Equipment</option><option>Subcontract</option></select></label><label>Amount in {currency}<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Cost date<input name="date" type="date" required /></label><label>Package<select name="packageId"><option value="">Whole job</option>{work.packages?.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Source reference<input name="source" minLength={8} required /></label><label>Reconcile commitment<select name="reconcilesId"><option value="">New cost</option>{state.costs.filter((item)=>item.kind==="Committed").map((item)=><option key={item.id} value={item.id}>{item.category} · {moneyMinor(item.amount_minor,currency)} · {item.source}</option>)}</select></label><button disabled={busy}>Record cost fact</button>

      </form>

      <form className={style.form} onSubmit={submit("set-remaining",(data)=>({ amountMinor:dollarsToMinor(field(data,"amount")),forecastAt:field(data,"date"),source:field(data,"source") }))}>

        <h4>Forecast remaining uncommitted cost</h4><label>Amount in {currency}<input name="amount" type="number" min="0" step="0.01" required /></label><label>Assessment date<input name="date" type="date" required /></label><label>Basis and source<input name="source" minLength={8} required /></label><button disabled={busy}>Record forecast</button>

      </form>

    </div> : null}

    <h4>Billing eligibility by accepted package</h4>

    {view.eligible.length ? view.eligible.map((item)=><p key={item.packageId}>{item.packageName} · release {item.releaseId} · {item.reviewedQuantity ?? "qualitative"} {item.unit ?? "scope"} reviewed · {item.evidence.length} reviewed evidence items</p>) : <p>Unaccepted scope and unreviewed proof cannot enter a billing draft.</p>}

    {canDraft && !financeClosed && view.eligible.length ? <form className={style.form} onSubmit={submit("draft-bill",(data)=>({ lines:[{ packageId:field(data,"packageId"),description:field(data,"description"),amountMinor:dollarsToMinor(field(data,"amount")),quantity:field(data,"quantity"),unit:field(data,"unit"),evidenceId:field(data,"evidenceId") }] }))}>

      <h4>Draft a package billing line</h4><label>Accepted package<select name="packageId" required value={billingPackageId || view.eligible[0]?.packageId || ""} onChange={(event)=>setBillingPackageId(event.target.value)}>{view.eligible.map((item)=><option key={item.packageId} value={item.packageId}>{item.packageName}</option>)}</select></label><label>Line scope<input name="description" minLength={5} required /></label><label>Accepted quantity<input name="quantity" type="number" min="0.001" step="0.001" required /></label><label>Unit<input name="unit" required placeholder="Use accepted completion unit" /></label><label>Amount in {currency}<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Reviewed package evidence<select name="evidenceId" required><option value="">Choose reviewed proof</option>{view.eligible.filter((item)=>item.packageId === (billingPackageId || view.eligible[0]?.packageId)).flatMap((item)=>item.evidence.map((proof)=><option key={proof.id} value={proof.id}>{item.packageName} · {proof.filename}</option>))}</select></label><button disabled={busy}>Save draft billing record</button>

    </form> : null}

    <h4>Billing records and source events</h4>

    {state.bills.map((bill)=>{ const balance = invoiceBalance(state,bill.id); return <article key={bill.id}><strong>{bill.status} · {bill.id} · rev {bill.revision}</strong><p>Invoiced {moneyMinor(balance.billed,currency)}; paid {moneyMinor(balance.paid,currency)}; outstanding {moneyMinor(balance.outstanding,currency)}</p><p>{bill.basis ? `Accepted source: Design rev ${bill.basis.designRevision}, Deploy rev ${bill.basis.deployRevision}, ${bill.basis.lines.length} scoped line(s).` : "Historical bill without an exact stored source basis; return and revise before a new billing decision."}</p><p>{bill.lines.map((line)=>`${line.description}: ${moneyMinor(line.amountMinor,currency)} · package ${line.packageId} · proof ${line.evidenceId}`).join("; ")}</p>
      {(state.billHistory ?? []).filter((entry)=>entry.bill_id===bill.id).map((entry)=><p key={`${entry.bill_id}-${entry.revision}`}>Revision {entry.revision} · {entry.status} · {entry.recorded_at}{entry.review_reason ? ` · ${entry.review_reason}` : ""}</p>)}

      {bill.status==="Returned" && canDraft && !financeClosed ? <form className={style.form} onSubmit={submit("revise-bill",(data)=>({billId:bill.id,billRevision:bill.revision,lines:[{packageId:field(data,"packageId"),description:field(data,"description"),amountMinor:dollarsToMinor(field(data,"amount")),quantity:field(data,"quantity"),unit:field(data,"unit"),evidenceId:field(data,"evidenceId")}] }))}><h4>Correct returned bill</h4><p>Creates a new bill revision and keeps the returned review in history. Current accepted scope and all other reservations are checked again.</p><label>Accepted package<select name="packageId" required>{view.eligible.map((item)=><option key={item.packageId} value={item.packageId}>{item.packageName}</option>)}</select></label><label>Scope<input name="description" defaultValue={bill.lines[0]?.description} minLength={5} required /></label><label>Quantity<input name="quantity" type="number" min="0.001" step="0.001" defaultValue={bill.lines[0]?.quantity} required /></label><label>Unit<input name="unit" defaultValue={bill.lines[0]?.unit} required /></label><label>Amount in {currency}<input name="amount" type="number" min="0.01" step="0.01" defaultValue={bill.lines[0] ? (bill.lines[0].amountMinor/100).toFixed(2) : ""} required /></label><label>Reviewed proof<select name="evidenceId" required>{view.eligible.flatMap((item)=>item.evidence.map((proof)=><option key={proof.id} value={proof.id}>{item.packageName} · {proof.filename}</option>))}</select></label><button disabled={busy}>Save corrected revision</button></form> : null}

      {bill.status==="Draft" && canDraft && !financeClosed ? <button disabled={busy} onClick={()=>void send("submit-bill",{billId:bill.id,billRevision:bill.revision})}>Submit for independent Finance review</button> : null}

      {bill.status==="In review" && canFinance && !financeClosed ? <form className={style.form} onSubmit={submit("review-bill",(data)=>({billId:bill.id,billRevision:bill.revision,decision:field(data,"decision"),reason:field(data,"reason")}))}><label>Decision<select name="decision"><option>Reviewed</option><option>Returned</option></select></label><label>Reason<input name="reason" minLength={10} required /></label><button disabled={busy}>Record Finance review</button></form> : null}

      {bill.status==="Reviewed" && canFinance && !financeClosed && !state.cashEvents.some((item)=>item.bill_id===bill.id) ? <form className={style.form} onSubmit={submit("return-unbilled",(data)=>({billId:bill.id,billRevision:bill.revision,reason:field(data,"reason")}))}><label>Return unbilled bill for correction<input name="reason" minLength={10} required /></label><button disabled={busy}>Return unbilled bill</button></form> : null}

      {bill.status==="Reviewed" && canFinance && !financeClosed ? <form className={style.form} onSubmit={submit("record-billed",(data)=>({billId:bill.id,billRevision:bill.revision,amountMinor:dollarsToMinor(field(data,"amount")),eventDate:field(data,"date"),source:field(data,"source")}))}><label>Recorded billed amount<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Date<input name="date" type="date" required /></label><label>External billing reference<input name="source" minLength={8} required /></label><button disabled={busy}>Record billed event</button></form> : null}

      {bill.status==="Reviewed" && canFinance && balance.outstanding !== null && (balance.outstanding ?? 0) > 0 ? <form className={style.form} onSubmit={submit("record-paid",(data)=>({billId:bill.id,billRevision:bill.revision,amountMinor:dollarsToMinor(field(data,"amount")),eventDate:field(data,"date"),source:field(data,"source")}))}><label>Recorded payment<input name="amount" type="number" min="0.01" max={balance.outstanding === null ? undefined : (balance.outstanding / 100).toFixed(2)} step="0.01" required /></label><label>Date<input name="date" type="date" required /></label><label>External payment reference<input name="source" minLength={8} required /></label><button disabled={busy}>Record paid event</button></form> : null}

    </article>; })}

    {state.cashEvents.map((item)=><p key={item.id}>{item.kind} · {moneyMinor(item.amount_minor,currency)} · {item.event_date} · {item.source} · bill {item.bill_id}</p>)}

    <p>Billing draft, recorded invoice and recorded payment are separate facts. This prototype does not submit invoices or collect money.</p>

  </section>;

}
