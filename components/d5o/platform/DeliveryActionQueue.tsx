"use client";

import type { DeliveryAction } from "@/lib/d5o/hosted/delivery-role-actions";

export function DeliveryActionQueue({ workspace, actions }: { workspace: string; actions: DeliveryAction[] }) {
  if (!actions.length) return null;
  const groups = [
    { position: "available", heading: "Decisions available to your role" },
    { position: "preparation", heading: "Preparation or remediation required" },
    { position: "waiting", heading: "Waiting on an eligible independent reviewer or another role" }
  ] as const;
  return <section className="d5o-ops-panel d5o-ops-action-list" aria-label="Delivery and closeout actions">
    <header><div><p>DELIVERY · CURRENT AUTHORITY BASIS</p><h2>Delivery and closeout decisions</h2></div><span>{actions.filter((a) => a.position === "available").length} available</span></header>
    <p className="d5o-ops-queue-note">Each link opens its exact current source. The decision command checks membership, independence and revisions again when submitted.</p>
    {groups.map((group) => {
      const items = actions.filter((a) => a.position === group.position);
      return items.length ? <div key={group.position}><h3>{group.heading}</h3>{items.map((action) => {
        const params = new URLSearchParams({ workspace, view: "record", record: action.workId,
          section: "Deploy", focus: action.focus, decision: action.decisionId,
          sourceRevision: String(action.sourceRevision), decisionRevision: String(action.revision) });
        if (action.packageId) params.set("package", action.packageId);
        if (action.releaseId) params.set("release", action.releaseId);
        return <a key={`${action.kind}:${action.workId}:${action.packageId ?? "work"}:${action.decisionId}`}
          href={`/work?${params.toString()}`}>
          <strong>{action.kind}</strong>
          <small>{action.title} · {action.customer} · {action.packageId ? `package ${action.packageId} · ` : "whole Work Record · "}source {action.decisionId} · revision {action.revision}</small>
          <small>Responsible role: {action.responsibleRole}</small>
          {action.blocker ? <small>Prerequisite: {action.blocker}</small> : null}
          <span>Open exact action →</span>
        </a>;
      })}</div> : null;
    })}
  </section>;
}
