"use client";

import type { DeliveryAction } from "@/lib/d5o/hosted/delivery-role-actions";
import type { SupportAction } from "@/lib/d5o/hosted/support-role-actions";
import { serviceActionHref, serviceRoleLabel, type ServiceAction } from "./service-actions";

type RoleAction = { kind: string; workId: string; packageId?: string | null; packageName?: string; decisionId?: string | null; revision: number; status: string; title: string; workTitle?: string; customer?: string; site?: string; dueDate?: string | null; phase: string; focus?: string; ownership: string };
type RecordSummary = { id: string; title: string; customer: string; site: string; stage: string };
export type FocusedQueuePage<T extends RecordSummary> = { roleActions?: RoleAction[]; serviceActions?: ServiceAction[]; deliveryActions?: DeliveryAction[]; supportActions?: SupportAction[]; records: T[]; total: number; nextCursor: string | null };
type Task = { key: string; canonical: string; title: string; work: string; customer: string; site?: string | null; detail: string; owner: string; blocker?: string | null; due?: string | null; impact?: "Critical" | "High" | "Standard" | null; href: string; position: "action" | "preparation" | "waiting" | "information" };

function deliveryLink(workspace: string, action: DeliveryAction) {
  const params = new URLSearchParams({ workspace, view: "record", record: action.workId, section: "Deploy", focus: action.focus,
    decision: action.decisionId, sourceRevision: String(action.sourceRevision), decisionRevision: String(action.revision) });
  if (action.packageId) params.set("package", action.packageId);
  if (action.releaseId) params.set("release", action.releaseId);
  return `/work?${params}`;
}
function supportLink(workspace: string, action: SupportAction) {
  const params = new URLSearchParams({ workspace, view: "record", record: action.workId, section: "Operate", focus: action.kind,
    decision: action.decisionId, decisionRevision: String(action.decisionRevision), turnover: action.turnoverId ?? "",
    documentKind: action.documentKind ?? "", sourceRevision: String(action.sourceRevision), deployRevision: String(action.deployRevision) });
  return `/work?${params}`;
}
function roleLink(workspace: string, action: RoleAction) {
  const phaseView = action.phase === "Define" ? "define" : action.phase === "Develop" ? "develop" : "record";
  const params = new URLSearchParams({ workspace, view: phaseView, record: action.workId, sourceRevision: String(action.revision) });
  if (phaseView === "record") params.set("section", action.phase);
  if (action.packageId) params.set("package", action.packageId);
  if (action.focus) params.set("focus", action.focus);
  if (action.decisionId) params.set("decision", action.decisionId);
  if (action.kind === "Billing review") { params.set("focus", "finance"); params.set("taskKind", "bill-review"); }
  if (action.kind === "Design review") params.set("focus", "reviews");
  if (action.kind === "Field report review") params.set("focus", "reports");
  return `/work?${params}`;
}
function tasksFor<T extends RecordSummary>(workspace: string, page: FocusedQueuePage<T>): Task[] {
  const delivery = (page.deliveryActions ?? []).map((action): Task => ({ key: `delivery:${action.workId}:${action.decisionId}:${action.kind}`, canonical: `delivery:${action.workId}:${action.packageId ?? "work"}:${action.kind}:${action.decisionId}`, title: action.kind,
    work: action.title, customer: action.customer, site: action.site, detail: action.packageId ? `Package scope · revision ${action.revision}` : `Whole work · revision ${action.revision}`,
    owner: action.responsibleRole, blocker: action.blocker, href: deliveryLink(workspace, action),
    position: action.position === "available" ? "action" : action.position === "preparation" ? "preparation" : "waiting" }));
  const support = (page.supportActions ?? []).map((action): Task => ({ key: `support:${action.workId}:${action.decisionId}:${action.kind}:${action.documentKind ?? ""}`, canonical: `support:${action.workId}:${action.decisionId}:${action.kind}:${action.documentKind ?? ""}`, title: ({
    "receive-handoff": "Link accepted delivery handoff", "add-asset": "Identify supported asset", "accept-support": "Accept support responsibility",
    activate: "Assess support activation", "supply-document": "Supply turnover document", "review-document": "Review turnover document"
  } as Record<SupportAction["kind"], string>)[action.kind], work: action.title, customer: action.customer, site: action.site,
    detail: `${action.documentKind ? `${action.documentKind} · ` : ""}source revision ${action.decisionRevision}`, owner: action.responsibleRole,
    blocker: action.blocker, href: supportLink(workspace, action),
    position: action.position === "available" ? "action" : action.position === "preparation" ? "preparation" : "waiting" }));
  const service = (page.serviceActions ?? []).map((action): Task => ({ key: `service:${action.requestId}:${action.kind}:${action.revision}`, canonical: `service:${action.requestId}:${action.requestCycleAt}:${action.kind}`, title: action.kind,
    work: action.requestTitle, customer: action.customer ?? "Customer not recorded", site: action.site, detail: `${action.coverage} · ${action.childWorkId ? "Service visit linked" : "Service visit pending"} · revision ${action.revision}`,
    owner: serviceRoleLabel(action.responsibleRole), blocker: action.blocker, due: action.dueDate, impact: action.impact, href: serviceActionHref(workspace, action),
    position: action.ownership === "Information only" ? "information" : action.actionable ? "action" : "waiting" }));
  const role = (page.roleActions ?? []).map((action): Task => ({ key: `role:${action.workId}:${action.kind}:${action.packageId ?? ""}:${action.revision}`, canonical: `role:${action.workId}:${action.packageId ?? "work"}:${action.kind}:${action.decisionId ?? action.revision}`, title: action.kind,
    work: action.workTitle ?? action.title, customer: action.customer ?? action.phase, site: action.site, detail: `${action.packageId ? "Package scope · " : ""}revision ${action.revision}`,
    owner: action.ownership, due: action.dueDate, href: roleLink(workspace, action), position: "action" }));
  const seen = new Set<string>();
  return [...delivery, ...support, ...service, ...role].filter((task) => {
    if (seen.has(task.canonical)) return false;
    seen.add(task.canonical); return true;
  }).sort((left, right) => {
    const first = left.due && !Number.isNaN(Date.parse(left.due)) ? Date.parse(left.due) : Number.POSITIVE_INFINITY;
    const second = right.due && !Number.isNaN(Date.parse(right.due)) ? Date.parse(right.due) : Number.POSITIVE_INFINITY;
    return first - second || ({ Critical: 0, High: 1, Standard: 2 }[left.impact ?? "Standard"] - { Critical: 0, High: 1, Standard: 2 }[right.impact ?? "Standard"]) || left.title.localeCompare(right.title) || left.canonical.localeCompare(right.canonical);
  });
}

export function FocusedMyWorkBoard<T extends RecordSummary>({ workspace, page, onOpen, onLoadMore, loading }: {
  workspace: string; page: FocusedQueuePage<T>; onOpen: (record: T) => void; onLoadMore: () => void; loading: boolean;
}) {
  const tasks = tasksFor(workspace, page);
  const actionable = tasks.filter((task) => task.position === "action" || task.position === "preparation");
  const waiting = tasks.filter((task) => task.position === "waiting");
  const information = tasks.filter((task) => task.position === "information");
  const renderTask = (task: Task) => <a className="d5o-focused-task" key={task.key} href={task.href}>
    <span className="d5o-focused-task-kind">{task.position === "preparation" ? "Prepare or resolve" : task.position === "waiting" ? "Waiting" : task.position === "information" ? "For reference" : "Decision available"}</span>
    <strong>{task.title}</strong><span>{task.work} · {task.customer}{task.site ? ` · ${task.site}` : ""}</span><small>{task.detail}</small>
    {task.blocker ? <p>{task.blocker}</p> : null}<small>Responsible: {task.owner}{task.due ? ` · Due ${task.due}` : ""}</small><b>Open exact task →</b>
  </a>;
  return <section className="d5o-focused-work">
    <header><p>MY WORK</p><h1>What needs your attention</h1><span>Tasks reflect your current account and role. Each decision checks eligibility and the exact source again when saved.</span>
      <button type="button" onClick={() => window.location.reload()}>Refresh tasks</button></header>
    <section aria-label="Action needed"><h2>Action needed <span>{actionable.length}</span></h2>{actionable.length ? <div className="d5o-focused-task-grid">{actionable.map(renderTask)}</div> : <p>No current action is available to your role.</p>}</section>
    <details><summary>Waiting on another role <span>{waiting.length}</span></summary>{waiting.length ? <div className="d5o-focused-task-grid">{waiting.map(renderTask)}</div> : <p>No waiting decisions.</p>}</details>
    {information.length ? <details><summary>Information and handoffs <span>{information.length}</span></summary><div className="d5o-focused-task-grid">{information.map(renderTask)}</div></details> : null}
    <details><summary>Browse Work Records <span>{page.total}</span></summary><p>Open a full record for context and history. Record ownership does not by itself create a decision for you.</p>
      <div className="d5o-focused-task-grid">{page.records.map((record) => <button key={record.id} type="button" className="d5o-focused-task" onClick={() => onOpen(record)}><strong>{record.title}</strong><span>{record.customer} · {record.site}</span><small>{record.stage}</small><b>View Work Record →</b></button>)}</div>
      {page.nextCursor ? <button type="button" disabled={loading} onClick={onLoadMore}>{loading ? "Loading…" : "Load more Work Records"}</button> : null}</details>
  </section>;
}
