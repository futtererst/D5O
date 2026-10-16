"use client";

import { useEffect, useMemo, useState } from "react";
import { tasksFor, type FocusedQueuePage } from "./FocusedMyWorkBoard";

type RecordSummary = { id: string; title: string; customer: string; site: string; stage: string };

export function TaskInboxRail({ workspace, currentRecordId, currentFocus, currentPackageId }: { workspace: string; currentRecordId?: string; currentFocus?: string | null; currentPackageId?: string | null }) {
  const [page, setPage] = useState<FocusedQueuePage<RecordSummary> | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ workspace, view: "actions", filter: "all" });
    fetch(`/api/d5o-hosted/prototype-search?${params}`, { cache: "no-store", signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("Task inbox unavailable"); return response.json() as Promise<FocusedQueuePage<RecordSummary>>; })
      .then((result) => { if (!controller.signal.aborted) { setPage(result); setError(""); } })
      .catch(() => { if (!controller.signal.aborted) setError("Task inbox unavailable. Refresh to try again."); });
    return () => controller.abort();
  }, [workspace, refresh]);
  useEffect(() => {
    const refreshOnReturn = () => setRefresh((value) => value + 1);
    window.addEventListener("focus", refreshOnReturn);
    return () => window.removeEventListener("focus", refreshOnReturn);
  }, []);

  const tasks = useMemo(() => page ? tasksFor(workspace, page) : [], [page, workspace]);
  const query = search.trim().toLowerCase();
  const shown = tasks.filter((task) => (waiting ? task.position === "waiting" : task.position === "action" || task.position === "preparation") &&
    (!query || [task.title, task.work, task.customer, task.site, task.category].some((value) => value?.toLowerCase().includes(query))));
  const activeCount = tasks.filter((task) => task.position === "action" || task.position === "preparation").length;
  const waitingCount = tasks.filter((task) => task.position === "waiting").length;

  return <aside className="d5o-task-inbox-rail" aria-label="Your task inbox">
    <header><div><small>YOUR WORKSPACE</small><h2>My work</h2></div><button type="button" aria-label="Refresh task inbox" title="Refresh task inbox" onClick={() => setRefresh((value) => value + 1)}>↻</button></header>
    <label className="d5o-task-inbox-search"><span className="sr-only">Search tasks</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks, jobs, customers…" /></label>
    <div className="d5o-task-inbox-tabs" role="group" aria-label="Task position"><button type="button" aria-pressed={!waiting} onClick={() => setWaiting(false)}>Action needed <b>{activeCount}</b></button><button type="button" aria-pressed={waiting} onClick={() => setWaiting(true)}>Waiting <b>{waitingCount}</b></button></div>
    <div className="d5o-task-inbox-rows" role="list" aria-live="polite">
      {error ? <p role="alert">{error}</p> : !page ? <p>Loading your tasks…</p> : shown.length ? shown.map((task) => {
        const target = new URL(task.href, "http://local.invalid").searchParams;
        const current = target.get("record") === currentRecordId && target.get("focus") === (currentFocus ?? null) && target.get("package") === (currentPackageId ?? null);
        return <a key={task.key} role="listitem" href={task.href} aria-current={current ? "page" : undefined} className={current ? "is-current-record" : ""}>
          <small>{task.category}{task.due ? ` · Due ${task.due}` : ""}</small><strong>{task.title}</strong><span>{task.work}</span><em>{task.customer}</em>
        </a>;
      }) : <p>{query ? "No matching tasks." : waiting ? "No work is waiting on another role." : "No action needs your attention."}</p>}
    </div>
    <a className="d5o-task-inbox-all" href={`/work?workspace=${encodeURIComponent(workspace)}&view=my-work`}>Open all work →</a>
  </aside>;
}
