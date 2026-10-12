"use client";

import type { SupportAction } from "@/lib/d5o/hosted/support-role-actions";

const labels: Record<SupportAction["kind"], string> = {
  "receive-handoff": "Link exact accepted delivery handoff",
  "add-asset": "Identify supported asset or system",
  "accept-support": "Accept ongoing support responsibility",
  "activate": "Assess and authorize support activation",
  "supply-document": "Supply accepted turnover documentation",
  "review-document": "Review exact support document"
};

export function SupportActionQueue({ workspace, actions }: { workspace: string; actions: SupportAction[] }) {
  if (!actions.length) return null;
  return <section className="d5o-ops-panel d5o-ops-action-list" aria-label="Support handoff actions">
    <header><div><p>OPERATE · CURRENT SUPPORT BASIS</p><h2>Handoff and support decisions</h2></div><span>{actions.filter((a) => a.position === "available").length} available</span></header>
    <p className="d5o-ops-queue-note">A queue item identifies the source; the authenticated command checks authority and revisions again.</p>
    {(["available", "preparation", "waiting"] as const).map((position) => {
      const items = actions.filter((item) => item.position === position);
      return items.length ? <div key={position}><h3>{position === "available" ? "Available to your role" : position === "preparation" ? "Preparation or remediation" : "Waiting on another authority"}</h3>
        {items.map((item) => {
          const params = new URLSearchParams({ workspace, view: "record", record: item.workId, section: "Operate",
            focus: item.kind, decision: item.decisionId, decisionRevision: String(item.decisionRevision),
            turnover: item.turnoverId ?? "", documentKind: item.documentKind ?? "",
            sourceRevision: String(item.sourceRevision), deployRevision: String(item.deployRevision) });
          return <a key={`${item.kind}:${item.workId}:${item.decisionId}`} href={`/work?${params}`}>
            <strong>{labels[item.kind]}</strong>
            <small>{item.title} · {item.customer}{item.packageName ? ` · ${item.packageName}` : ""} · acceptance {item.decisionId} rev {item.decisionRevision}</small>
            <small>Responsible: {item.responsibleRole}</small>
            {item.blocker ? <small>Next: {item.blocker}</small> : null}<span>Open exact action →</span>
          </a>;
        })}</div> : null;
    })}
  </section>;
}
