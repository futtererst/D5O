"use client";

import { useState, type FormEvent } from "react";
import type { OperateCommand } from "@/lib/d5o/prototype-work/operate-command";
import type { DeliveryAction } from "@/lib/d5o/hosted/delivery-role-actions";
import type { SupportAction } from "@/lib/d5o/hosted/support-role-actions";
import type { ServiceReturnAction } from "@/lib/d5o/hosted/service-return-actions";
import { connectedWorkPosition } from "./connected-work-position";
import type { WorkRecord } from "./work-types";
import { serviceActionHref, serviceRoleLabel, type ServiceAction } from "./service-actions";

type RoleAction = { kind: string; workId: string; packageId?: string | null; packageName?: string; decisionId?: string | null; sourceRevision?: number; revision: number; status: string; title: string; workTitle?: string; customer?: string; site?: string; dueDate?: string | null; phase: string; focus?: string; ownership: string; position?: "preparation" | "waiting" | "action"; blocker?: string | null };
type RecordSummary = { id: string; title: string; customer: string; site: string; stage: string };
export type FocusedQueuePage<T extends RecordSummary> = { roleActions?: RoleAction[]; serviceActions?: ServiceAction[]; deliveryActions?: DeliveryAction[]; supportActions?: SupportAction[]; serviceReturnQueue?: ServiceReturnAction[]; records: T[]; total: number; nextCursor: string | null };
type Task = { key: string; canonical: string; title: string; work: string; customer: string; site?: string | null; detail: string; owner: string; category: string; blocker?: string | null; due?: string | null; impact?: "Critical" | "High" | "Standard" | null; href: string; position: "action" | "preparation" | "waiting" | "information"; supportAction?: SupportAction };

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
    owner: action.responsibleRole, category: "Service", blocker: action.blocker, due: action.dueDate, impact: action.impact,
    href: serviceReturnLink(workspace, action), position: "action" }));
  const delivery = (page.deliveryActions ?? []).map((action): Task => ({ key: `delivery:${action.workId}:${action.decisionId}:${action.kind}`, canonical: `delivery:${action.workId}:${action.packageId ?? "work"}:${action.kind}:${action.decisionId}`, title: action.kind,
    work: action.title, customer: action.customer, site: action.site, detail: action.packageId ? `${action.packageName ?? "Package name unavailable"} · revision ${action.revision}` : `Whole work · revision ${action.revision}`,
    owner: action.responsibleRole, category: "Delivery", blocker: action.blocker, href: deliveryLink(workspace, action),
    position: action.position === "available" ? "action" : action.position === "preparation" ? "preparation" : "waiting" }));
  const support = (page.supportActions ?? []).map((action): Task => ({ key: `support:${action.workId}:${action.decisionId}:${action.kind}:${action.documentKind ?? ""}`, canonical: `support:${action.workId}:${action.decisionId}:${action.kind}:${action.documentKind ?? ""}`,
    title: action.kind === "add-asset" && action.blocker?.startsWith("Asset identity conflict:")
      ? "Resolve supported asset identity" : supportLabels[action.kind], work: action.title, customer: action.customer, site: action.site,
    detail: `${action.packageName ? `${action.packageName} · ` : ""}${action.documentKind ? `${action.documentKind} · ` : ""}source revision ${action.decisionRevision}`, owner: action.responsibleRole,
    category: action.kind === "add-asset" ? "Asset setup" : "Support", blocker: action.blocker, href: supportLink(workspace, action), supportAction: action,
    position: action.position === "available" ? "action" : action.position === "preparation" ? "preparation" : "waiting" }));
  const service = (page.serviceActions ?? []).map((action): Task => ({ key: `service:${action.requestId}:${action.kind}:${action.revision}`, canonical: `service:${action.requestId}:${action.requestCycleAt}:${action.kind}`, title: action.kind,
    work: action.requestTitle, customer: action.customer ?? "Customer not recorded", site: action.site, detail: `${action.coverage} · ${action.childWorkId ? "Service visit linked" : "Service visit pending"} · revision ${action.revision}`,
    owner: serviceRoleLabel(action.responsibleRole), category: "Service", blocker: action.blocker, due: action.dueDate, impact: action.impact, href: serviceActionHref(workspace, action),
    position: action.ownership === "Information only" ? "information" : action.actionable ? "action" : "waiting" }));
  const role = (page.roleActions ?? []).map((action): Task => ({ key: `role:${action.workId}:${action.kind}:${action.packageId ?? ""}:${action.revision}`, canonical: `role:${action.workId}:${action.packageId ?? "work"}:${action.kind}:${action.decisionId ?? action.revision}`, title: action.kind === "Design review" ? action.title : action.kind,
    work: action.workTitle ?? action.title, customer: action.customer ?? action.phase, site: action.site, detail: `${action.packageId ? `${action.packageName ?? "Package"} · ` : ""}revision ${action.revision}`,
    owner: action.ownership, category: action.phase, blocker: action.blocker, due: action.dueDate, href: roleLink(workspace, action), position: action.position ?? "action" }));
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

type OperateIntent = Omit<OperateCommand, "expectedRevision" | "commandId">;

function AssetWorkPane({ task, records, actorId, actorRole, onCommand, onCommitted }: {
  task: Task; records: WorkRecord[]; actorId?: string; actorRole?: string;
  onCommand: (command: OperateIntent) => Promise<boolean>; onCommitted: () => void;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [candidateKey, setCandidateKey] = useState("");
  const [busy, setBusy] = useState(false);
  const work = records.find((item) => item.id === task.supportAction?.workId);
  const action = task.supportAction;
  const source = work?.operate?.source;
  const acceptance = work?.deploy?.workAcceptance;
  const current = !!work && !!action && !!source && !!acceptance &&
    action.decisionId === acceptance.id && action.decisionRevision === acceptance.revision &&
    action.sourceRevision === (work.operate?.authorityRevision ?? 0) &&
    action.deployRevision === (work.deploy?.authorityRevision ?? 0);
  const candidates = records.filter((record) => record.id !== work?.id && record.workspace === work?.workspace &&
    record.customer.trim().toLowerCase() === work?.customer.trim().toLowerCase() &&
    record.site.trim().toLowerCase() === work?.site.trim().toLowerCase())
    .flatMap((record) => (record.operate?.assets ?? []).map((asset) => ({ record, asset, key: `${record.id}:${asset.id}` })));
  const candidate = candidates.find((item) => item.key === candidateKey);
  const duplicateIdentity = !!candidate?.asset.externalId && records.flatMap((record) => record.operate?.assets ?? [])
    .filter((asset) => asset.externalId?.trim().toLowerCase() === candidate.asset.externalId?.trim().toLowerCase()).length > 1;
  const canLink = !!candidate && !duplicateIdentity && actorRole === "operations_leader" &&
    candidate.asset.status === "Supported" && candidate.record.operate?.activation?.status === "Active" &&
    candidate.record.operate?.support?.ownerActorId === actorId && source?.acceptedByActorId !== actorId;
  const canPrepare = current && task.position !== "waiting" && !!onCommand;
  async function submitNew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!work || !canPrepare) return;
    const data = new FormData(event.currentTarget), value = (key: string) => String(data.get(key) ?? "").trim();
    setBusy(true);
    try {
      if (await onCommand({ workId: work.id, action: "add-asset", name: value("name"), kind: value("kind"),
        location: value("location"), externalId: value("externalId"), manufacturer: value("manufacturer"),
        model: value("model"), serial: value("serial"), documentation: value("documentation") })) onCommitted();
    } finally { setBusy(false); }
  }
  async function submitExisting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!work || !candidate || !current || !canLink) return;
    setBusy(true);
    try {
      if (await onCommand({ workId: work.id, action: "link-existing-asset", sourceWorkId: candidate.record.id,
        assetId: candidate.asset.id, note: String(new FormData(event.currentTarget).get("note") ?? "").trim() })) onCommitted();
    } finally { setBusy(false); }
  }
  return <>
    <header className="d5o-workbench-pane-head"><div><small>ASSET SETUP · ACCEPTED DELIVERY REVISION {source?.revision ?? "UNKNOWN"}</small>
      <h2>Identify supported asset</h2><p>Connect accepted delivery to the system Operations will support.</p></div></header>
    <div className="d5o-workbench-inherited"><small>CONTEXT · FROM THE ACCEPTED WORK</small><p><b>Job</b> {work?.title ?? task.work}</p><p><b>Customer</b> {task.customer}</p><p><b>Site</b> {task.site || "Not recorded"}</p></div>
    {!current ? <p role="alert" className="d5o-workbench-warning">This task changed or its accepted source is unavailable. Refresh My Work before acting.</p> :
      task.position === "waiting" ? <p className="d5o-workbench-warning">This is waiting on {task.owner}. Your queue visibility does not grant permission to record the asset.</p> : <>
        <fieldset className="d5o-workbench-choice"><legend>What are you identifying?</legend>
          <label><input type="radio" name="asset-mode" checked={mode === "new"} onChange={() => setMode("new")} /> New asset or system</label>
          <label><input type="radio" name="asset-mode" checked={mode === "existing"} onChange={() => setMode("existing")} /> Existing supported asset</label>
        </fieldset>
        {mode === "new" ? <form className="d5o-workbench-form" onSubmit={submitNew}>
          <label>Asset or system name <span>*</span><input name="name" required placeholder="Name used by the support team" /></label>
          <label>Type <span>*</span><input name="kind" required placeholder="For example, route, panel or system" /></label>
          <label>Location <span>*</span><input name="location" required placeholder="Where this system is supported" /></label>
          <details><summary>Additional identity and documents</summary><label>External identity<input name="externalId" /></label><label>Manufacturer<input name="manufacturer" /></label><label>Model<input name="model" /></label><label>Serial number<input name="serial" /></label><label>Document reference<input name="documentation" /></label></details>
          <div className="d5o-workbench-actions"><button type="submit" disabled={busy || !canPrepare}>Save asset identity</button><a href={`/work?workspace=${encodeURIComponent(work?.workspace ?? "")}&view=record&record=${encodeURIComponent(work?.id ?? "")}&section=Deploy`}>View accepted turnover</a></div>
        </form> : <form className="d5o-workbench-form" onSubmit={submitExisting}>
          <label>Existing asset or system <span>*</span><select required value={candidateKey} onChange={(event) => setCandidateKey(event.target.value)}><option value="">Select a recorded system</option>{candidates.map(({ record, asset, key }) => <option key={key} value={key}>{asset.name} · {asset.location} · {record.title}</option>)}</select></label>
          {!candidates.length ? <p>No existing system is recorded for this customer and site. Choose “New asset or system” if the accepted work created one.</p> : null}
          {candidate ? <p>{duplicateIdentity ? "This external identity appears on more than one asset and needs reconciliation." : canLink ? "You are the current Operations support owner for this system. Confirm the exact delivery relationship." : "The current independent Operations support owner must accept this delivery under the existing system."}</p> : null}
          <label>Why this delivery belongs to that system <span>*</span><input name="note" required /></label>
          <div className="d5o-workbench-actions"><button type="submit" disabled={busy || !canLink}>Link accepted delivery</button><a href={`/work?workspace=${encodeURIComponent(work?.workspace ?? "")}&view=record&record=${encodeURIComponent(work?.id ?? "")}&section=Deploy`}>View accepted turnover</a></div>
        </form>}
      </>}
    <p className="d5o-workbench-next"><b>Next:</b> Operations separately accepts support responsibility and assesses activation. Saving an identity does neither.</p>
    <details className="d5o-workbench-context"><summary>Decision history and full task</summary><p>Source {source?.workAcceptanceId ?? "not linked"} · revision {source?.revision ?? "unknown"}.</p><a href={task.href}>Open full task and history</a></details>
  </>;
}

export function FocusedMyWorkBoard<T extends RecordSummary>({ workspace, page, onOpen, onLoadMore, loading, records = [], actorId, actorRole, onOperateCommand, onCommitted }: {
  workspace: string; page: FocusedQueuePage<T>; onOpen: (record: T) => void; onLoadMore: () => void; loading: boolean;
  records?: WorkRecord[]; actorId?: string; actorRole?: string;
  onOperateCommand?: (command: OperateIntent) => Promise<boolean>; onCommitted?: () => void;
}) {
  const tasks = tasksFor(workspace, page);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [waitingOnly, setWaitingOnly] = useState(false);
  const query = search.trim().toLowerCase();
  const shown = tasks.filter((task) => (!waitingOnly || task.position === "waiting") &&
    (!query || [task.title, task.work, task.customer, task.site, task.category].some((value) => value?.toLowerCase().includes(query))));
  const actionable = shown.filter((task) => task.position === "action" || task.position === "preparation");
  const waiting = shown.filter((task) => task.position === "waiting");
  const information = shown.filter((task) => task.position === "information");
  const selected = shown.find((task) => task.key === selectedKey) ?? actionable[0] ?? waiting[0] ?? information[0];
  const renderTask = (task: Task) => <button type="button" className={`d5o-workbench-row${selected?.key === task.key ? " is-selected" : ""}`}
    key={task.key} onClick={() => setSelectedKey(task.key)} aria-pressed={selected?.key === task.key}>
    <span className="d5o-workbench-row-title">{task.title}<small>{task.work}</small></span><span>{task.category}</span>
  </button>;
  return <section className="d5o-focused-work d5o-workbench">
    <header className="d5o-workbench-top"><div><small>D5O / RYBEX</small><h1>My Work</h1></div><button type="button" onClick={() => window.location.reload()}>Refresh</button></header>
    <div className="d5o-workbench-shell"><section className="d5o-workbench-list" aria-label="Worklist">
      <nav className="d5o-workbench-tabs" aria-label="Worklist filters"><button type="button" aria-pressed={!waitingOnly} onClick={() => setWaitingOnly(false)}>Action needed <span>{tasks.filter((task) => task.position === "action" || task.position === "preparation").length}</span></button>
        <button type="button" aria-pressed={waitingOnly} onClick={() => setWaitingOnly(true)}>Waiting <span>{tasks.filter((task) => task.position === "waiting").length}</span></button></nav>
      <label className="d5o-workbench-search"><input type="search" aria-label="Search tasks" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search work, customer or task…" /></label>
      <div className="d5o-workbench-table-head"><span>Task</span><span>Type</span></div>
      {!waitingOnly ? <section aria-label="Action needed"><h2>Action needed</h2>{actionable.length ? actionable.map(renderTask) : <p>No current action matches this view.</p>}</section> : null}
      <section aria-label="Waiting"><h2>Waiting</h2>{waiting.length ? waiting.map(renderTask) : <p>No waiting tasks match this view.</p>}</section>
      {!waitingOnly && information.length ? <details><summary>Information and handoffs · {information.length}</summary>{information.map(renderTask)}</details> : null}
    </section><aside className="d5o-workbench-pane" aria-label="Selected task">{selected ? selected.supportAction?.kind === "add-asset" && onOperateCommand ?
      <AssetWorkPane key={selected.key} task={selected} records={records} actorId={actorId} actorRole={actorRole} onCommand={onOperateCommand} onCommitted={onCommitted ?? (() => window.location.reload())} /> : <>
      <header className="d5o-workbench-pane-head"><small>{selected.position === "waiting" ? "WAITING ON ANOTHER ROLE" : "CURRENT TASK"} · {selected.category}</small><h2>{selected.title}</h2><p>{selected.detail}</p></header>
      <div className="d5o-workbench-inherited"><small>CONTEXT</small><p><b>Job</b> {selected.work}</p><p><b>Customer</b> {selected.customer}</p><p><b>Site</b> {selected.site || "Not recorded"}</p></div>
      {selected.blocker ? <p className="d5o-workbench-warning">{selected.blocker}</p> : null}
      <p><b>Responsible:</b> {selected.owner}{selected.due ? ` · Due ${selected.due}` : ""}</p>
      <a className="d5o-workbench-primary-link" href={selected.href}>{selected.position === "waiting" ? "Review exact position" : "Open exact task"} →</a>
      <p className="d5o-workbench-footnote">The exact decision and your current authority are checked when the task opens and again when it is saved.</p>
    </> : <p>Select a task to see its current scope.</p>}</aside></div>
    <details className="d5o-workbench-browse"><summary>Browse Work Records · {page.total}</summary><p>Open a full record for history and context. Record ownership alone does not grant a decision.</p>
      <div className="d5o-focused-task-grid">{page.records.map((record) => { const position = connectedWorkPosition(record as unknown as WorkRecord); return <button key={record.id} type="button" className="d5o-focused-task" onClick={() => onOpen(record)}><strong>{record.title}</strong><span>{record.customer} · {record.site}</span><small>{position?.label ?? record.stage}</small>{position?.warning ? <small>{position.warning}</small> : null}<b>View Work Record →</b></button>; })}</div>
      {page.nextCursor ? <button type="button" disabled={loading} onClick={onLoadMore}>{loading ? "Loading…" : "Load more Work Records"}</button> : null}</details>
  </section>;
}
