"use client";

import { serviceActionHref, serviceRoleLabel, type ServiceAction } from "./service-actions";

export function ServiceActionQueue({ workspace, actions }: { workspace: string; actions: ServiceAction[] }) {
  const pending = actions.filter((action) => action.ownership !== "Information only");
  const handoffs = actions.filter((action) => action.ownership === "Information only");
  if (!actions.length) return null;
  return <section className="d5o-ops-panel d5o-ops-action-list" aria-label="Service commercial and Finance actions">
    <header><div><p>SERVICE COMMERCIAL &amp; FINANCE</p><h2>Current request decisions</h2></div>
      <span>{pending.filter((action) => action.actionable).length} available to your role</span></header>
    {[...pending, ...handoffs].map((action) => <a key={`${action.workId}:${action.requestId}:${action.kind}:${action.revision}`}
      href={serviceActionHref(workspace, action)}>
      <strong>{action.requestTitle} · {action.kind}</strong>
      <small>{action.customer || "Customer not recorded"} · {action.coverage} · {action.requestStatus}
        {action.childWorkId ? ` · visit ${action.childWorkId}` : " · visit not created"}</small>
      <small>{action.status} · {action.ownership} · responsible: {serviceRoleLabel(action.responsibleRole)}
        {action.dueDate ? ` · decision due ${action.dueDate}` : " · no decision deadline recorded"}
        {action.serviceResolutionDueAt ? ` · service resolution due ${action.serviceResolutionDueAt}` : ""}</small>
      <small>{action.blocker}</small>
      <span>{action.actionable ? "Open decision" : "Review position"} →</span>
    </a>)}
    <p className="d5o-ops-queue-note">Links reopen the current request and source. Eligibility is checked again when a command is committed.</p>
  </section>;
}
