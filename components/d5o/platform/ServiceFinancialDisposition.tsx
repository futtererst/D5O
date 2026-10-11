"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { WorkRecord } from "./work-types";
import { CustomerDecisionEvidence } from "./CustomerDecisionEvidence";
import { ServiceInvoicePanel } from "./ServiceInvoicePanel";
import { ServiceActualCostPanel } from "./ServiceActualCostPanel";
import style from "./OperateWorkspace.module.css";

type Basis = {
  requestId: string; requestCycleAt: string; coverage: string; requestStatus: string;
  agreementName?: string; agreementSource?: string; agreementRevision?: string;
  agreementIncludes?: string; agreementExcludes?: string;
  coveredScope?: string; uncoveredScope?: string; uncoveredAmountMinor?: string;
  currency?: string; estimateRevision?: string; policyId?: string; policyVersion?: string;
  authorizationEvidenceId?: string; reviewedHours?: number; reviewedQuantity?: number;
  authorizationConditions?: string; billingTermsKnown?: boolean;
  billingTermsRevision?: number; billingTermsEvidenceId?: string;
  billingTermsChecksum?: string; billingTermsStatement?: string;
  billingTermsRecordedBy?: string; billingTermsRecordedAt?: string;
  billingTerms?: { billingBasis: string; billingTrigger: string; paymentTerms: string;
    customerParty: string; customerOrganization: string; customerRole: string;
    authorityBasis: string };
  jobStatus?: string; releaseId?: string; workAcceptanceId?: string;
  designRevision?: number; deployRevision?: number; eligibleForFinanceReview: boolean;
};
type Decision = {
  status: "Prepared" | "Ready for billing" | "Hold"; revision: number;
  prepared_by: string; prepared_at: string; reviewed_by?: string; reviewed_at?: string;
  review_reason?: string; billing_terms_statement?: string;
  billing_terms_evidence_id?: string;
};
type Read = {
  basis: Basis; basisDigest: string; revision: number;
  termsSource: Record<string, unknown>; termsSourceDigest: string; termsRevision: number;
  workRevision: number; operateRevision: number;
  decision: Decision | null; decisionCurrent: boolean;
  history: Array<{ revision: number; action: string; at: string }>;
};
const money = (minor: string | undefined, currency: string | undefined) => {
  if (!minor || !currency || !/^\d+$/.test(minor) || !Number.isSafeInteger(Number(minor)))
    return "Unknown";
  try {
    const format = new Intl.NumberFormat(undefined, { style: "currency", currency });
    return format.format(Number(minor) / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
  } catch { return "Unknown"; }
};

export function ServiceFinancialDisposition({
  work, requestId, requestTitle, actorRole, focusKind
}: { work: WorkRecord; requestId: string; requestTitle?: string; actorRole?: string; focusKind?: string | null }) {
  const [position, setPosition] = useState<Read | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState("");
  const endpoint = `/api/d5o-hosted/service-finance?workspace=${encodeURIComponent(work.workspace)}`;
  const refresh = useCallback(async () => {
    const response = await fetch(`${endpoint}&workId=${encodeURIComponent(work.id)}&requestId=${encodeURIComponent(requestId)}`,
      { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Service Finance basis unavailable");
    setPosition(body as Read);
  }, [endpoint, work.id, requestId]);
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (live) void refresh().catch((cause) => { if (live) setError(String(cause)); });
    });
    return () => { live = false; };
  }, [refresh]);

  async function submit(event: FormEvent<HTMLFormElement>, action: "record-terms" | "prepare" | "review-ready" | "review-hold") {
    event.preventDefault();
    if (!position) return;
    const form = event.currentTarget;
    setBusy(true); setError("");
    try {
      const data = new FormData(form);
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workId: work.id, requestId, action, commandId: crypto.randomUUID(),
          expectedWorkRevision: position.workRevision,
          expectedOperateRevision: position.operateRevision,
          expectedDesignRevision: position.basis.designRevision,
          expectedDeployRevision: position.basis.deployRevision,
          expectedFinanceRevision: position.revision, basisDigest: position.basisDigest,
          expectedTermsRevision: position.termsRevision,
          termsSourceDigest: position.termsSourceDigest,
          note: String(data.get("note") ?? "").trim(),
          billingTermsEvidenceId: action === "prepare" ? basis?.billingTermsEvidenceId : undefined,
          billingTermsStatement: action === "prepare" ? basis?.billingTermsStatement : undefined,
          evidenceId: selectedEvidence,
          billingBasis: String(data.get("billingBasis") ?? ""),
          billingTrigger: String(data.get("billingTrigger") ?? ""),
          paymentTerms: String(data.get("paymentTerms") ?? "").trim(),
          customerParty: String(data.get("customerParty") ?? "").trim(),
          customerOrganization: String(data.get("customerOrganization") ?? "").trim(),
          customerRole: String(data.get("customerRole") ?? "").trim(),
          authorityBasis: String(data.get("authorityBasis") ?? "").trim()
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Service Finance decision rejected");
      await refresh();
      form.reset();
      if (action === "record-terms") setSelectedEvidence("");
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  const basis = position?.basis;
  const decision = position?.decision;
  return <section className={style.card} aria-label="Service financial disposition">
    <div className={style.cardHead}><h3>{requestTitle ? `${requestTitle} · service financial disposition` : "Service financial disposition"}</h3>
      <p>Coverage, customer authorization, physical completion and billing remain separate decisions.</p></div>
    {error ? <p role="alert">{error}</p> : null}
    {!basis ? <p>Loading the exact service basis…</p> : <>
      <div className={style.row}><b>{basis.coverage} · {basis.requestStatus}</b>
        <span>Current request cycle {basis.requestCycleAt}</span>
        <small>Covered: {basis.coveredScope || "No covered scope recorded"}.
          Agreement: {basis.agreementName || "Unknown"} r{basis.agreementRevision || "?"}
          · {basis.agreementSource || "Source unknown"}.</small>
        <small>Uncovered: {basis.uncoveredScope || "No uncovered scope recorded"}.
          Approved estimate r{basis.estimateRevision || "?"}
          · customer-authorized {money(basis.uncoveredAmountMinor, basis.currency)}
          · retained document {basis.authorizationEvidenceId || "missing"}.</small>
        <small>Reviewed execution: {basis.reviewedQuantity ?? "unknown"} service visit;
          {basis.reviewedHours ?? "unknown"} actual hours. Release {basis.releaseId || "missing"};
          accepted scope {basis.workAcceptanceId || "missing"}.</small>
      </div>
      <p>Actual incurred cost is shown in the sourced cost ledger below · billing terms: {basis.billingTermsKnown
        ? basis.billingTermsStatement : "not established by a current retained terms supplement"}
        · see the retained invoice and payment position below. Actual hours are not a time-and-materials charge.</p>
      {basis.authorizationConditions ? <small>Separate operational authorization condition: {basis.authorizationConditions}</small> : null}
      {basis.billingTermsKnown && basis.billingTerms ? <div className={style.row}>
        <b>Customer billing terms · revision {basis.billingTermsRevision}</b>
        <span>{basis.billingTerms.billingBasis} · {basis.billingTerms.billingTrigger}
          · {basis.billingTerms.paymentTerms}</span>
        <small>Fictional customer authority: {basis.billingTerms.customerParty},
          {basis.billingTerms.customerRole}, {basis.billingTerms.customerOrganization}
          · {basis.billingTerms.authorityBasis}</small>
        <small>Recorded by {basis.billingTermsRecordedBy} on {basis.billingTermsRecordedAt}.
          Document SHA-256 {basis.billingTermsChecksum}.</small>
        <a href={`/api/d5o-hosted/customer-decision-evidence?workspace=${encodeURIComponent(work.workspace)}&workId=${encodeURIComponent(work.id)}&requestId=${encodeURIComponent(requestId)}&evidenceId=${encodeURIComponent(basis.billingTermsEvidenceId ?? "")}`}
          target="_blank" rel="noreferrer">Review retained terms PDF</a>
      </div> : null}
      {decision ? <div className={style.row}><b>{position?.decisionCurrent ? decision.status : `${decision.status} · historical basis`}</b>
        <span>Decision r{decision.revision} · prepared by {decision.prepared_by} on {decision.prepared_at}</span>
        {decision.reviewed_by ? <small>Finance reviewer {decision.reviewed_by} · {decision.reviewed_at}
          · {decision.review_reason}</small> : null}</div> : <p>No Finance disposition has been recorded.</p>}
      {!basis.eligibleForFinanceReview ? <p role="alert">Current completed service source is incomplete or changed. Reconcile its request, approved price, release and acceptance before review.</p> : null}
      {actorRole === "project_manager" && basis.eligibleForFinanceReview && (!focusKind || ["Service terms follow-up", "Service Finance source"].includes(focusKind)) ? <form className={style.form}
        onSubmit={(event) => void submit(event, "record-terms")}>
        <b>Record customer billing-terms supplement for the uncovered {money(basis.uncoveredAmountMinor, basis.currency)}</b>
        <p>This supplements the original authorization. It does not change covered scope or reopen the closed request.</p>
        <CustomerDecisionEvidence key={position?.termsSourceDigest}
          workspace={work.workspace} workId={work.id}
          purpose="service-billing-terms" scopeId={requestId}
          evidenceId={selectedEvidence} onEvidence={setSelectedEvidence} disabled={busy} />
        <label>Billing basis<select name="billingBasis" required defaultValue="Fixed fee for approved uncovered scope">
          <option>Fixed fee for approved uncovered scope</option>
        </select></label>
        <label>Billing trigger<select name="billingTrigger" required defaultValue="Accepted service scope">
          <option>Accepted service scope</option>
        </select></label>
        <label>Payment terms<select name="paymentTerms" required defaultValue="">
          <option value="">Select documented terms</option>
          <option>Net 30 days from invoice</option>
          <option>Due on receipt of invoice</option>
        </select></label>
        <label>Fictional customer representative<input name="customerParty" required minLength={5} /></label>
        <label>Customer organization<input name="customerOrganization" required minLength={5} /></label>
        <label>Representative role<input name="customerRole" required minLength={5} /></label>
        <label>Stated authority basis<input name="authorityBasis" required minLength={15} /></label>
        <label>Recorder note confirming the document states these exact terms<input name="note" required minLength={15} /></label>
        <button disabled={busy || !selectedEvidence}>Record retained supplement</button>
      </form> : null}
      {actorRole === "project_manager" && basis.eligibleForFinanceReview && (!focusKind || ["Service Finance preparation", "Service invoice preparation"].includes(focusKind)) ?
        <form className={style.form} onSubmit={(event) => void submit(event, "prepare")}>
          <b>Prepare exact service basis for independent Finance review</b>
          {basis.billingTermsKnown
            ? <p>Current terms revision {basis.billingTermsRevision} and its retained document will be bound automatically.</p>
            : <p>No current retained billing terms. Finance can hold this prepared basis; operational conditions do not establish billing terms.</p>}
          <label>Preparation reason and unresolved obligations<input name="note" required minLength={15} /></label>
          <button disabled={busy}>Prepare Finance review</button>
        </form> : null}
      {actorRole === "billing_commercial_lead" && decision?.status === "Prepared" &&
        position?.decisionCurrent && basis.eligibleForFinanceReview && (!focusKind || focusKind === "Service Finance review") ? <>
          <form className={style.form} onSubmit={(event) => void submit(event, "review-ready")}>
            <label>Why the retained terms make this exact amount billable<input name="note" required minLength={20} /></label>
            <button disabled={busy || !decision.billing_terms_evidence_id || !decision.billing_terms_statement}>
              Mark supported amount ready for billing</button>
          </form>
          <form className={style.form} onSubmit={(event) => void submit(event, "review-hold")}>
            <label>Concrete Finance hold reason and next source needed<input name="note" required minLength={20} /></label>
            <button disabled={busy}>Hold billing</button>
          </form>
        </> : null}
      <small>{position?.history.length ?? 0} retained Finance event(s). Ready for billing does not itself issue an invoice or record payment.</small>
      {(!focusKind || focusKind.startsWith("Service invoice") || focusKind === "Service payment recording") ? <ServiceInvoicePanel work={work} requestId={requestId} actorRole={actorRole} focusKind={focusKind} /> : null}
      {(!focusKind || focusKind.startsWith("Service cost")) ? <ServiceActualCostPanel work={work} requestId={requestId} actorRole={actorRole} /> : null}
    </>}
  </section>;
}
