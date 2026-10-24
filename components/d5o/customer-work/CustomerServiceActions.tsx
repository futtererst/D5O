"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import type { OperateCommand } from "@/lib/d5o/prototype-work/operate-command";
import { operateState } from "@/components/d5o/platform/operate-model";
import { ServicePricingPanel } from "@/components/d5o/platform/ServicePricingPanel";

type Action = Omit<OperateCommand, "workId" | "expectedRevision" | "commandId">;
const field = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

export function CustomerServiceActions({ work, sourceRevision, role, onChanged }: {
  work: WorkRecord; sourceRevision: number; role: string; onChanged: () => Promise<void>;
}) {
  const state = operateState(work);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [jobApproval, setJobApproval] = useState<Record<string, boolean>>({});
  const canPrepare = role === "project_manager";
  const canOperate = role === "operations_leader";
  const canOpen = canPrepare || canOperate;
  useEffect(() => {
    let active = true;
    const requests = state.requests.filter((request) => request.serviceEstimate?.status === "Approved");
    void Promise.all(requests.map(async (request) => {
      const url = `/api/d5o-hosted/service-approval?workspace=${encodeURIComponent(work.workspace)}` +
        `&parentPresentationId=${encodeURIComponent(work.id)}&requestId=${encodeURIComponent(request.id)}`;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return [request.id, false] as const;
      const body = await response.json() as { result?: { canCreateJob?: boolean } };
      return [request.id, body.result?.canCreateJob === true] as const;
    })).then((results) => { if (active) setJobApproval(Object.fromEntries(results)); })
      .catch(() => { if (active) setJobApproval({}); });
    return () => { active = false; };
  }, [work.id, work.workspace, state.requests]);
  async function send(action: Action) {
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch(`/api/d5o-hosted/prototype-operate-command?workspace=${encodeURIComponent(work.workspace)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...action, workId: work.id, expectedRevision: sourceRevision,
          expectedDecisionRevision: work.operate?.authorityRevision ?? 0,
          expectedDeployRevision: work.deploy?.authorityRevision ?? 0,
          commandId: crypto.randomUUID() })
      });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.message ?? result.error ?? "The service decision was not recorded");
      await onChanged();
      setSuccess("Decision recorded. Current responsibilities have been refreshed.");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replaceAll("_", " ") : "Service decision unavailable");
      return false;
    } finally { setBusy(false); }
  }
  function submit(action: (data: FormData) => Action) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void send(action(new FormData(event.currentTarget)));
    };
  }
  if (state.activation?.status !== "Active") return <p>Service requests become available after support activation.</p>;
  return <section className="d5o-customer-actions" aria-label="Connected service responsibilities">
    <h3>Connected service</h3>
    <p>Customer authorization, additional threshold approval, service authorization, and job creation are separate decisions. Changes to the estimate or scope require a new review.</p>
    {error && <p role="alert">{error}</p>}{success && <p role="status">{success}</p>}
    {canPrepare && state.assets.length > 0 && <details><summary>Record service coverage terms</summary>
      <form onSubmit={submit((data) => ({ action: "add-agreement", assetId: field(data, "assetId"),
        name: field(data, "name"), kind: "Service agreement", effectiveFrom: field(data, "from"),
        effectiveTo: field(data, "to"), serviceCategories: [field(data, "category")],
        laborCovered: true, partsCovered: false, travelCovered: false,
        includes: field(data, "includes"), excludes: field(data, "excludes"),
        responseHours: 4, calendar: field(data, "calendar") === "Continuous" ? "Continuous" : "Business hours",
        source: field(data, "source") }))}>
        <label>Asset<select name="assetId" required>{state.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
        <label>Agreement name<input name="name" required minLength={5} /></label>
        <label>Service category<input name="category" required minLength={3} /></label>
        <label>Response calendar<select name="calendar"><option>Business hours</option><option>Continuous</option></select></label>
        <label>Effective from<input name="from" type="date" required /></label>
        <label>Effective to<input name="to" type="date" required /></label>
        <label>Included work<input name="includes" required /></label>
        <label>Excluded work<input name="excludes" required /></label>
        <label>Customer terms source<input name="source" required /></label>
        <button disabled={busy}>Save coverage terms</button>
      </form></details>}
    {canOperate && state.agreements.filter((item) => item.status === "Draft").map((agreement) =>
      <form key={agreement.id} onSubmit={submit((data) => ({ action: "approve-agreement",
        id: agreement.id, note: field(data, "reason") }))}>
        <strong>Review {agreement.name}</strong>
        <label>Independent review reason<input name="reason" required minLength={15} /></label>
        <button disabled={busy}>Approve coverage terms</button>
      </form>)}
    {canOpen && state.assets.length > 0 && <form onSubmit={submit((data) => ({ action: "open-request",
      assetId: field(data, "assetId"), title: field(data, "title"),
      description: field(data, "description"), contact: field(data, "contact"),
      impact: field(data, "impact") as "Standard" | "High" | "Critical" }))}>
      <h4>Open service request</h4>
      <label>Asset<select name="assetId" required>{state.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
      <label>Issue<input name="title" required minLength={5} /></label>
      <label>Observed condition<textarea name="description" required minLength={10} /></label>
      <label>Customer contact<input name="contact" required minLength={3} /></label>
      <label>Impact<select name="impact"><option>Standard</option><option>High</option><option>Critical</option></select></label>
      <button disabled={busy}>Open service request</button>
    </form>}
    {state.requests.map((request) => <section key={request.id}>
      <h4>{request.title} · {request.status}</h4>
      <p>{request.coverage} · {request.description}</p>
      {canOperate && request.status === "New" && <form onSubmit={submit((data) => ({
        action: "triage-request", requestId: request.id,
        serviceCategory: field(data, "category") }))}>
        <label>Service category<input name="category" required minLength={3} /></label>
        <button disabled={busy}>Triage request</button>
      </form>}
      {(["Chargeable", "Partially covered"].includes(request.coverage) || request.serviceEstimate) &&
        <ServicePricingPanel work={work} request={request} hosted busy={busy}
          actorRole={role} onCommand={send} onChanged={onChanged} />}
      {canPrepare && ["Triaged", "In progress"].includes(request.status) &&
        (request.coverage === "Covered" || request.serviceAuthorization?.estimateRevision ===
          request.serviceEstimate?.revision) &&
        (request.coverage === "Covered" || jobApproval[request.id] === true) &&
        !state.jobs.some((job) => job.requestId === request.id && job.status !== "Cancelled") &&
        <button disabled={busy} onClick={() => void send({ action: "create-job",
          requestId: request.id, dueDate: new Date().toISOString().slice(0, 10) })}>
          Create executable service job</button>}
      {state.jobs.filter((job) => job.requestId === request.id).map((job) =>
        <p key={job.id}>Service job: {job.status} · due {job.dueDate}</p>)}
    </section>)}
  </section>;
}
