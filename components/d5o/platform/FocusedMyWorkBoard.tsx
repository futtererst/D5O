"use client";

import { useState } from "react";
import type { DeliveryAction } from "@/lib/d5o/hosted/delivery-role-actions";
import type { SupportAction } from "@/lib/d5o/hosted/support-role-actions";
import type { ServiceReturnAction } from "@/lib/d5o/hosted/service-return-actions";
import { connectedWorkPosition } from "./connected-work-position";
import type { WorkRecord } from "./work-types";
import { serviceActionHref, serviceRoleLabel, type ServiceAction } from "./service-actions";

type RoleAction = { kind: string; workId: string; packageId?: string | null; packageName?: string; decisionId?: string | null; sourceRevision?: number; revision: number; status: string; title: string; workTitle?: string; customer?: string; site?: string; dueDate?: string | null; phase: string; focus?: string; ownership: string; position?: "preparation" | "waiting" | "action"; blocker?: string | null };
type RecordSummary = { id: string; title: string; customer: string; site: string; stage: string };
export type FocusedQueuePage<T extends RecordSummary> = { roleActions?: RoleAction[]; serviceActions?: ServiceAction[]; deliveryActions?: DeliveryAction[]; supportActions?: SupportAction[]; serviceReturnQueue?: ServiceReturnAction[]; records: T[]; total: number; nextCursor: string | null };
type Task = { key: string; canonical: string; title: string; work: string; customer: string; site?: string | null; detail: string; owner: string; blocker?: string | null; due?: string | null; impact?: "Critical" | "High" | "Standard" | null; href: string; position: "action" | "preparation" | "waiting" | "information" };

const supportLabels: Record<SupportAction["kind"], string> = {
  "receive-handoff": "Link accepted delivery handoff", "add-asset": "Identify supported asset", "accept-support": "Accept support responsibility",
  activate: "Assess support activation", "supply-document": "Supply turnover document", "review-document": "Review turnover document"
};

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
function serviceReturnLink(workspace: string, action: ServiceReturnAction) {
  const params = new URLSearchParams({ workspace, view: "record", record: action.workId, section: "Operate",
    focus: "service-return", request: action.requestId, job: action.jobId, taskKind: action.kind,
    requestCycle: action.requestCycleAt, taskRevision: String(action.operateRevision),
    childRevision: String(action.childDeployRevision), acceptance: action.acceptanceId });
  return `/work?${params}`;
}
function roleLink(workspace: string, action: RoleAction) {
  const phaseView = action.phase === "Discover" ? "discover" : action.phase === "Define" ? "define" : action.phase === "Develop" ? "develop" : "record";
  const params = new URLSearchParams({ workspace, view: phaseView, record: action.workId, sourceRevision: String(action.revision) });
  if (phaseView === "record") params.set("section", action.phase);
  if (action.packageId) params.set("package", action.packageId);
  if (action.focus) params.set("focus", action.focus);
  if (action.decisionId) params.set("decision", action.decisionId);
  if (action.focus === "design-release-receipt") {
    params.set("sourceRevision", String(action.sourceRevision ?? action.revision));
    params.set("decisionRevision", String(action.revision));
    params.set("release", action.decisionId ?? "");
  }
  if (action.kind === "Billing review") { params.set("focus", "finance"); params.set("taskKind", "bill-review"); }
  if (action.kind === "Design review") params.set("focus", "reviews");
  if (action.kind === "Field report review") params.set("focus", "reports");
  return `/work?${params}`;
}
function tasksFor<T extends RecordSummary>(workspace: string, page: FocusedQueuePage<T>): Task[] {
  const serviceReturn = (page.serviceReturnQueue ?? []).map((action): Task => ({
    key: `service-return:${action.workId}:${action.jobId}:${action.kind}:${action.operateRevision}`,
    canonical: `service-return:${action.workId}:${action.requestCycleAt}:${action.jobId}:${action.kind}`,
    title: action.kind, work: action.requestTitle, customer: action.customer, site: action.site,
    detail: `${action.workTitle} · service visit ${action.childWorkId} · source revision ${action.operateRevision}`,
    owner: action.responsibleRole, blocker: action.blocker, due: action.dueDate, impact: action.impact,
    href: serviceReturnLink(workspace, action), position: "action" }));
  const delivery = (page.deliveryActions ?? []).map((action): Task => ({ key: `delivery:${action.workId}:${action.decisionId}:${action.kind}`, canonical: `delivery:${action.workId}:${action.packageId ?? "work"}:${action.kind}:${action.decisionId}`, title: action.kind,
    work: action.title, customer: action.customer, site: action.site, detail: action.packageId ? `${action.packageName ?? "Package name unavailable"} · revision ${action.revision}` : `Whole work · revision ${action.revision}`,
    owner: action.responsibleRole, blocker: action.blocker, href: deliveryLink(workspace, action),
    position: action.position === "available" ? "action" : action.position === "preparation" ? "preparation" : "waiting" }));
  const support = (page.supportActions ?? []).map((action): Task => ({ key: `support:${action.workId}:${action.decisionId}:${action.kind}:${action.documentKind ?? ""}`, canonical: `support:${action.workId}:${action.decisionId}:${action.kind}:${action.documentKind ?? ""}`,
    title: action.kind === "add-asset" && action.blocker?.startsWith("Asset identity conflict:")
      ? "Resolve supported asset identity" : supportLabels[action.kind], work: action.title, customer: action.customer, site: action.site,
    detail: `${action.packageName ? `${action.packageName} · ` : ""}${action.documentKind ? `${action.documentKind} · ` : ""}source revision ${action.decisionRevision}`, owner: action.responsibleRole,
    blocker: action.blocker, href: supportLink(workspace, action),
    position: action.position === "available" ? "action" : action.position === "preparation" ? "preparation" : "waiting" }));
  const service = (page.serviceActions ?? []).map((action): Task => ({ key: `service:${action.requestId}:${action.kind}:${action.revision}`, canonical: `service:${action.requestId}:${action.requestCycleAt}:${action.kind}`, title: action.kind,
    work: action.requestTitle, customer: action.customer ?? "Customer not recorded", site: action.site, detail: `${action.coverage} · ${action.childWorkId ? "Service visit linked" : "Service visit pending"} · revision ${action.revision}`,
    owner: serviceRoleLabel(action.responsibleRole), blocker: action.blocker, due: action.dueDate, impact: action.impact, href: serviceActionHref(workspace, action),
    position: action.ownership === "Information only" ? "information" : action.actionable ? "action" : "waiting" }));
  const role = (page.roleActions ?? []).map((action): Task => ({ key: `role:${action.workId}:${action.kind}:${action.packageId ?? ""}:${action.revision}`, canonical: `role:${action.workId}:${action.packageId ?? "work"}:${action.kind}:${action.decisionId ?? action.revision}`, title: action.kind === "Design review" ? action.title : action.kind,
    work: action.workTitle ?? action.title, customer: action.customer ?? action.phase, site: action.site, detail: `${action.packageId ? `${action.packageName ?? "Package"} · ` : ""}revision ${action.revision}`,
    owner: action.ownership, blocker: action.blocker, due: action.dueDate, href: roleLink(workspace, action), position: action.position ?? "action" }));
  const seen = new Set<string>();
  return [...delivery, ...support, ...serviceReturn, ...service, ...role].filter((task) => {
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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = tasks.find((task) => task.key === selectedKey) ?? actionable[0] ?? waiting[0] ?? information[0];
  const renderTask = (task: Task) => <a className={`d5o-worklist-row${selected?.key === task.key ? " is-selected" : ""}`} key={task.key} href={task.href}
    onMouseEnter={() => setSelectedKey(task.key)} onFocus={() => setSelectedKey(task.key)} aria-label={`${task.title}, ${task.work}, ${task.detail}`}>
    <span className="d5o-worklist-row-main"><span className="d5o-focused-task-kind">{task.position === "preparation" ? "Prepare" : task.position === "waiting" ? "Waiting" : task.position === "information" ? "Reference" : "Decision"}</span>
      <strong>{task.title}</strong><small>{task.work} · {task.customer}{task.site ? ` · ${task.site}` : ""}</small></span>
    <span className="d5o-worklist-row-meta"><small>{task.due ? `Due ${task.due}` : task.owner}</small><b aria-hidden="true">→</b></span>
  </a>;
  return <section className="d5o-focused-work">
    <header><p>MY WORK</p><h1>Your worklist</h1><span>Open a task to act on its current scope. Decisions are checked again when saved.</span>
      <button type="button" onClick={() => window.location.reload()}>Refresh tasks</button></header>
    <div className="d5o-worklist-layout"><div className="d5o-worklist-list">
      <section aria-label="Action needed"><h2>Action needed <span>{actionable.length}</span></h2>{actionable.length ? <div className="d5o-worklist-rows">{actionable.map(renderTask)}</div> : <p>No current action is available to your role.</p>}</section>
      <section aria-label="Waiting on another role"><h2>Waiting on another role <span>{waiting.length}</span></h2>{waiting.length ? <div className="d5o-worklist-rows">{waiting.map(renderTask)}</div> : <p>No waiting decisions.</p>}</section>
      {information.length ? <details><summary>Information and handoffs <span>{information.length}</span></summary><div className="d5o-worklist-rows">{information.map(renderTask)}</div></details> : null}
    </div><aside className="d5o-worklist-preview" aria-label="Selected task preview">{selected ? <>
      <span className="d5o-focused-task-kind">{selected.position === "waiting" ? "WAITING ON ANOTHER ROLE" : selected.position === "information" ? "FOR REFERENCE" : "CURRENT TASK"}</span>
      <h2>{selected.title}</h2><p><strong>{selected.work}</strong><br />{selected.customer}{selected.site ? ` · ${selected.site}` : ""}</p>
      <dl><dt>Exact scope</dt><dd>{selected.detail}</dd><dt>Responsible</dt><dd>{selected.owner}</dd>{selected.due ? <><dt>Due</dt><dd>{selected.due}</dd></> : null}</dl>
      {selected.blocker ? <p className="d5o-worklist-blocker"><strong>Before this can proceed</strong><br />{selected.blocker}</p> : null}
      {selected.title === "Identify supported asset" ? <p>This connects accepted delivery to the asset or system Operations will support. Recording its identity does not accept support responsibility or activate service.</p> : null}
      <a className="d5o-worklist-open" href={selected.href}>Open exact task →</a>
    </> : <p>No current task is available.</p>}</aside></div>
    <details><summary>Browse Work Records <span>{page.total}</span></summary><p>Open a full record for context and history. Record ownership does not by itself create a decision for you.</p>
      <div className="d5o-focused-task-grid">{page.records.map((record) => { const position = connectedWorkPosition(record as unknown as WorkRecord); return <button key={record.id} type="button" className="d5o-focused-task" onClick={() => onOpen(record)}><strong>{record.title}</strong><span>{record.customer} · {record.site}</span><small>{position?.label ?? record.stage}</small>{position?.warning ? <small>{position.warning}</small> : null}<b>View Work Record →</b></button>; })}</div>
      {page.nextCursor ? <button type="button" disabled={loading} onClick={onLoadMore}>{loading ? "Loading…" : "Load more Work Records"}</button> : null}</details>
  </section>;
}
