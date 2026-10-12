"use client";

import { useEffect, useState } from "react";
import { shiftHours, type Assignment, type WorkspaceKey } from "./schedule-model";
import { lifecycleProfiles, stateFor } from "./lifecycle-profiles";
import { connectedLifecyclePosition, connectedWorkPosition } from "./connected-work-position";
import type { WorkRecord } from "./work-types";

type Work = { id: string; workspace: WorkspaceKey; title: string; type: string; customer: string; site: string; stage: string; owner: string; nextAction: string; progress: number; value: string; status: "attention" | "moving" | "complete"; blockers: string[]; source?: Work };
type Filter = "all" | "blocked" | "attention" | "moving" | "complete";
type Page = { records: Work[]; total: number; nextCursor: string | null; overview: { total: number; attention: number; stages: Record<string, number> } };

export function PortfolioBoard({ workspaceKey, work, scheduleAssignments, search, setSearch, filter, setFilter, onOpen, hostedPreview = false }: {
  workspaceKey: WorkspaceKey; work: Work[]; scheduleAssignments: Assignment[]; search: string;
  setSearch: (value: string) => void; filter: Filter; setFilter: (value: Filter) => void; onOpen: (item: Work) => void; hostedPreview?: boolean;
}) {
  const [view, setView] = useState<"register" | "lifecycle">("register");
  const [selectedStage, setSelectedStage] = useState<number | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const lifecycle = lifecycleProfiles[workspaceKey].states;

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ view: "portfolio", q: search, filter });
        if (selectedStage !== null) params.set("position", String(selectedStage));
        if (hostedPreview) params.set("workspace", workspaceKey);
        const response = await fetch(`${hostedPreview ? "/api/d5o-hosted/prototype-search" : "/api/work/search"}?${params}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Portfolio is unavailable.");
        const next = await response.json() as Page;
        if (!controller.signal.aborted) setPage(next);
      } catch {
        if (!controller.signal.aborted) { setPage(null); setError("Portfolio could not load. Try again."); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [workspaceKey, search, filter, selectedStage, work, hostedPreview]);

  async function loadMore() {
    if (!page?.nextCursor || loading) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ view: "portfolio", q: search, filter, cursor: page.nextCursor });
      if (selectedStage !== null) params.set("position", String(selectedStage));
      if (hostedPreview) params.set("workspace", workspaceKey);
      const response = await fetch(`${hostedPreview ? "/api/d5o-hosted/prototype-search" : "/api/work/search"}?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("The register changed.");
      const next = await response.json() as Page;
      setPage({ ...next, records: [...page.records, ...next.records] });
    } catch { setError("The register changed. Refresh the view and try again."); }
    finally { setLoading(false); }
  }

  const records = (page?.records ?? []).map((item) => work.find((local) => local.id === item.id) ?? item);
  const scheduled = scheduleAssignments.filter((item) => (item.week ?? 0) === 0);
  const scheduleFor = (item: Work) => scheduled.filter((assignment) => assignment.workId === item.id);
  const positionOf = (item: Work) => connectedLifecyclePosition(item as WorkRecord) ?? lifecycle.indexOf(stateFor(item.workspace, item.stage, item.progress));

  return <section className="d5o-portfolio-concept">
    <header><div><p>PORTFOLIO · WORK RECORDS</p><h1>Portfolio control</h1><span>Lifecycle position, next decision, owner, current condition, and crew commitment for each Work Record.</span></div><div className="d5o-portfolio-summary"><article><strong>{page?.overview.total ?? "—"}</strong><span>Work Records</span></article><article><strong>{page?.overview.attention ?? "—"}</strong><span>Need attention</span></article><article><strong>{scheduled.length}</strong><span>Crew slots this week</span></article></div></header>
    <section className="d5o-portfolio-flow"><header><p>REFERENCE LIFECYCLE VIEW</p><span>{lifecycleProfiles[workspaceKey].name} · presentation grouping inferred from recorded position and progress. Open a Work Record for its governed stage.</span></header><div>{lifecycle.map((stage, index) => <button key={stage} aria-pressed={selectedStage === index} className={selectedStage === index ? "is-selected" : ""} onClick={() => { setSelectedStage((current) => current === index ? null : index); setView("register"); }}><b>0{index + 1}</b><strong>{stage}</strong><span>{page?.overview.stages[index] ?? 0} records</span></button>)}</div></section>
    <section className="d5o-portfolio-consol"><div className="d5o-portfolio-toolbar"><div className="d5o-portfolio-view"><button className={view === "register" ? "is-active" : ""} onClick={() => setView("register")}>Register</button><button className={view === "lifecycle" ? "is-active" : ""} onClick={() => { setSelectedStage(null); setView("lifecycle"); }}>Lifecycle board</button>{selectedStage !== null ? <button className="d5o-clear-stage" onClick={() => setSelectedStage(null)}>Clear: {lifecycle[selectedStage]} ×</button> : null}</div><div className="d5o-portfolio-filter"><input aria-label="Find work" placeholder="Search work, customer, site or owner" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="Filter by health" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}><option value="all">All health</option><option value="blocked">Open conditions</option><option value="attention">Needs attention</option><option value="moving">Moving</option><option value="complete">Complete</option></select></div></div>
      <div className="d5o-portfolio-page-status" role="status">{loading ? "Loading work…" : page ? `${records.length} of ${page.total} matching Work Records` : error || "Loading work…"}</div>
      {view === "register" ? <div className="d5o-portfolio-register"><div className="d5o-portfolio-colhead"><span>WORK RECORD</span><span>POSITION / HEALTH</span><span>NEXT ACTION / OWNER</span><span>VALUE</span></div>{records.map((item) => { const plan = scheduleFor(item); const hours = plan.reduce((sum, assignment) => sum + shiftHours(assignment.shift) * assignment.people.length, 0); const connected = connectedWorkPosition(item as WorkRecord); return <button key={item.id} onClick={() => onOpen(item.source ?? item)}><div><small>{item.type} · {item.site}</small><strong>{item.title}</strong><span>{item.customer}</span></div><div><b className={item.status}>{item.status === "attention" ? "Needs attention" : item.status === "complete" ? "Complete" : "Moving"}</b><span>{connected?.label ?? item.stage}</span></div><div><strong>{connected?.nextAction ?? item.nextAction}</strong><span>{item.owner}</span>{connected?.warning ? <em>{connected.warning}</em> : !connected && item.blockers.length ? <em>{item.blockers[0]}</em> : null}<small className="d5o-portfolio-crew-context">{plan.length ? `${plan.length} crew slot${plan.length === 1 ? "" : "s"} · ${hours}h planned this week` : "No crew slot this week"}</small></div><div><strong>{connected?.value ?? item.value}</strong><span>{connected ? `${item.progress}% legacy observation · not measured completion` : `${item.progress}% on current path`}</span></div></button>; })}{!records.length && !loading ? <p className="d5o-empty-state">{error || "No Work Record matches the current filters."}</p> : null}</div> : <div className="d5o-portfolio-lanes">{lifecycle.map((stage, index) => <section key={stage}><header><b>0{index + 1}</b><strong>{stage}</strong><span>{page?.overview.stages[index] ?? 0}</span></header>{records.filter((item) => positionOf(item) === index).map((item) => <button key={item.id} onClick={() => onOpen(item.source ?? item)}><small>{item.stage}</small><strong>{item.title}</strong><span>{item.nextAction}</span><em className={item.status}>{item.status === "attention" ? "Condition open" : item.status === "complete" ? "Complete" : "Moving"}</em></button>)}</section>)}</div>}
      {page?.nextCursor ? <div className="d5o-portfolio-pagination"><button disabled={loading} onClick={() => { void loadMore(); }}>{loading ? "Loading…" : "Load more Work Records"}</button></div> : null}
      {error && records.length ? <p className="d5o-portfolio-load-error" role="alert">{error}</p> : null}
    </section>
  </section>;
}
