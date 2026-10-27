"use client";

import { useState, type FormEvent } from "react";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import { currentWorkAcceptanceScope } from "@/components/d5o/platform/deploy-model";
import { operateState } from "@/components/d5o/platform/operate-model";
import { supportDocumentationPositions } from "@/components/d5o/platform/support-documentation";
import { SupportDocumentationPanel } from "@/components/d5o/platform/SupportDocumentationPanel";
import type { OperateCommand } from "@/lib/d5o/prototype-work/operate-command";

type Intent = Omit<OperateCommand, "workId" | "expectedRevision" | "commandId">;
type Props = { work: WorkRecord; role: string; policy: { requireDocumentationReview: boolean } | null;
  busy: boolean; onCommand: (intent: Intent) => Promise<boolean> };
const value = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const evidenceHref = (work: WorkRecord, id: string) =>
  `/api/d5o-hosted/customer-decision-evidence?workspace=${encodeURIComponent(work.workspace)}&workId=${encodeURIComponent(work.id)}&evidenceId=${encodeURIComponent(id)}`;

export function CustomerOperateActions({ work, role, policy, busy, onCommand }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const state = operateState(work), receipt = work.deploy?.workAcceptance;
  const exact = !!currentWorkAcceptanceScope(work) && receipt?.receipt === "Accepted";
  const documents = supportDocumentationPositions(work);
  const required = policy?.requireDocumentationReview === true;
  const reviewed = documents.filter((item) => item.kind === "as-built" && item.status === "Reviewed").length;
  const pending = documents.filter((item) => item.kind === "as-built" && item.status !== "Reviewed");
  const canReceive = role === "operations_leader";
  const submit = (create: (data: FormData) => Intent) => async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSubmitting(true);
    const form = event.currentTarget;
    try { if (await onCommand(create(new FormData(form)))) form.reset(); }
    finally { setSubmitting(false); }
  };
  return <div className="d5o-customer-operate" aria-label="Operate employee actions">
    <h4>Accepted delivery and support responsibility</h4>
    <p>Whole-Work acceptance: {receipt?.receipt ?? "Pending"}. Exact current scope: {exact ? "verified" : "unavailable"}.
      Support: {state.activation?.status ?? "Pending"}. Financial closeout: {state.finance.status}.</p>
    {receipt?.source?.startsWith("evidence:") ? <a href={evidenceHref(work, receipt.source.slice(9))}
      target="_blank" rel="noreferrer">Open retained customer acceptance</a> : null}
    {(work.packages ?? []).map((item) => {
      const releases = work.design?.releases.filter((release) => release.packageId === item.id && release.status === "Accepted") ?? [];
      const turnovers = work.deploy?.turnovers.filter((turnover) => releases.some((release) => turnover.releaseIds.includes(release.id))) ?? [];
      return <section key={item.id}><h5>{item.name}</h5><p>Accepted Design release: {releases.at(-1)?.id ?? "None"}.
        Field completion: {turnovers.at(-1)?.completionId ?? "Pending"}.
        Operations receipt: {turnovers.at(-1)?.receipt ?? "Pending"}.</p>
        {turnovers.map((turnover) => <p key={turnover.id}>Outstanding issue or obligation: {turnover.obligations || "None recorded"}</p>)}
      </section>;
    })}
    <p>Documentation policy: {policy ? required ? "Independent as-built review required before support acceptance" :
      "Additional as-built review optional" : "Pinned policy unavailable"}. Reviewed as-built documents: {reviewed}.
      {pending.length ? ` ${pending.length} as-built obligation(s) need review.` : ""}</p>
    {canReceive && exact && !state.source && <form onSubmit={submit((data) => ({ action: "receive-handoff",
      note: value(data, "note") }))}><label>Handoff review and remaining conditions
      <input name="note" minLength={10} required /></label><button disabled={busy || submitting}>Receive accepted handoff</button></form>}
    {state.source && !state.assets.length && !state.assetLinks?.some((item) => item.status === "Accepted") &&
      ["project_manager", "operations_leader"].includes(role) &&
      <form onSubmit={submit((data) => ({ action: "add-asset", name: value(data, "name"),
        kind: value(data, "kind"), location: value(data, "location"), documentation: value(data, "documentation") }))}>
        <h5>Identify the supported system</h5><label>System name<input name="name" required /></label>
        <label>Type<input name="kind" required /></label><label>Location<input name="location" required /></label>
        <label>Document reference<input name="documentation" /></label>
        <button disabled={busy || submitting}>Record supported asset identity</button></form>}
    {state.source && <SupportDocumentationPanel work={work} hosted actorRole={role} onCommand={onCommand} />}
    {canReceive && state.source && state.assets.length > 0 && !state.support &&
      <form onSubmit={submit((data) => ({ action: "accept-support", customerContact: value(data, "customerContact"),
        escalation: value(data, "escalation"), intakeRoute: value(data, "intakeRoute"),
        warrantyDisposition: value(data, "warrantyDisposition"), serviceDisposition: value(data, "serviceDisposition"),
        documentation: value(data, "documentation"), residualOwner: value(data, "residualOwner") }))}>
        <h5>Accept support responsibility</h5><p>Review the retained Deploy evidence and continuing obligations above.
          {required && pending.length ? " Required independent document review remains open; the command will reject acceptance." : ""}</p>
        <label>Customer support contact<input name="customerContact" required /></label>
        <label>Escalation path<input name="escalation" required /></label>
        <label>Request intake route<input name="intakeRoute" required /></label>
        <label>Warranty disposition<input name="warrantyDisposition" required /></label>
        <label>Service disposition<input name="serviceDisposition" required /></label>
        <label>Reviewed documentation reference<input name="documentation" required /></label>
        <label>Residual obligation owner<input name="residualOwner" /></label>
        <button disabled={busy || submitting}>Accept support ownership</button></form>}
    {state.support && <p>Support responsibility accepted by {state.support.owner};
      intake via {state.support.intakeRoute}. Residual owner: {state.support.residualOwner || "none recorded"}.</p>}
    {canReceive && state.support && !state.activation && <button disabled={busy || submitting}
      onClick={() => void onCommand({ action: "activate", note: "Reviewed accepted delivery and operational readiness" })}>
      Activate support</button>}
    {state.activation?.status === "Active" && <p role="status">Support Active. Financial closeout remains {state.finance.status}.</p>}
    {role === "billing_commercial_lead" && state.activation?.status === "Active" &&
      state.finance.status === "Pending" && <form onSubmit={submit((data) => ({ action: "update-finance",
        status: "In review", note: value(data, "financeNote") }))}>
        <h5>Review financial closeout obligation</h5>
        <p>Start a separate Finance review. This does not record payment or closeout.</p>
        <label>Finance review and next action<input name="financeNote" minLength={10} required /></label>
        <button disabled={busy || submitting}>Start Finance review</button></form>}
    {state.finance.status !== "Closed" && <p>Finance follow-up: {state.finance.owner || "Finance"} —
      {state.finance.note || "Closeout has not been recorded."} Support activation does not close this obligation.</p>}
  </div>;
}
