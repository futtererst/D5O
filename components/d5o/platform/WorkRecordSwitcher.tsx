"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { connectedWorkPosition } from "./connected-work-position";
import type { WorkRecord } from "./work-types";

type SwitchableRecord = {
  id: string;
  title: string;
  customer: string;
  site: string;
  type: string;
  stage: string;
  owner: string;
  status: "attention" | "moving" | "complete";
};

const displayedStage = (record: SwitchableRecord) => connectedWorkPosition(record as unknown as WorkRecord)?.label ?? record.stage;

type Filter = "all" | "mine" | "attention" | "recent";
const limit = 25;
type SearchPage = { records: SwitchableRecord[]; nextCursor: string | null; total: number };

export function WorkRecordSwitcher<T extends SwitchableRecord>({ records, selected, workspaceName, currentUser, accent, onSelect, onOverview, hostedWorkspace }: {
  records: T[];
  selected?: T;
  workspaceName: string;
  currentUser: string;
  accent: string;
  onSelect: (record: T) => void;
  onOverview: () => void;
  hostedWorkspace?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [page, setPage] = useState<SearchPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [openingId, setOpeningId] = useState("");
  const [error, setError] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const openingAbort = useRef<AbortController | null>(null);

  useEffect(() => { if (open) searchRef.current?.focus(); }, [open]);

  useEffect(() => {
    if (!open || filter === "recent") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ q: query, filter, owner: currentUser });
        if (hostedWorkspace) params.set("workspace", hostedWorkspace);
        const response = await fetch(`${hostedWorkspace ? "/api/d5o-hosted/prototype-search" : "/api/work/search"}?${params}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Search is unavailable. Try again.");
        const result = await response.json() as SearchPage;
        if (!controller.signal.aborted) setPage(result);
      } catch {
        if (!controller.signal.aborted) { setPage(null); setError("Search is unavailable. Try again."); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, query, filter, currentUser, hostedWorkspace]);

  async function loadMore() {
    if (!page?.nextCursor || loading) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: query, filter, owner: currentUser, cursor: page.nextCursor });
      if (hostedWorkspace) params.set("workspace", hostedWorkspace);
      const response = await fetch(`${hostedWorkspace ? "/api/d5o-hosted/prototype-search" : "/api/work/search"}?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("The work list changed. Search again.");
      const next = await response.json() as SearchPage;
      setPage({ records: [...page.records, ...next.records], nextCursor: next.nextCursor, total: next.total });
    } catch { setError("The work list changed. Search again."); }
    finally { setLoading(false); }
  }

  function close() {
    openingAbort.current?.abort();
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function choose(record: T) {
    setRecentIds((current) => [record.id, ...current.filter((id) => id !== record.id)].slice(0, 8));
    onSelect(record);
    close();
  }

  async function chooseResult(record: SwitchableRecord) {
    const local = records.find((item) => item.id === record.id);
    if (local) { choose(local); return; }
    const controller = new AbortController();
    openingAbort.current = controller;
    setOpeningId(record.id);
    setError("");
    try {
      const params = new URLSearchParams({ record: record.id });
      if (hostedWorkspace) params.set("workspace", hostedWorkspace);
      const response = await fetch(`${hostedWorkspace ? "/api/d5o-hosted/prototype-search" : "/api/work/search"}?${params}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("record_unavailable");
      const payload = await response.json() as { record?: T };
      if (!payload.record || payload.record.id !== record.id) throw new Error("record_unavailable");
      if (controller.signal.aborted) return;
      choose(payload.record);
    } catch { if (!controller.signal.aborted) setError("This Work Record could not be loaded. Refresh and search again."); }
    finally { if (openingAbort.current === controller) openingAbort.current = null; setOpeningId(""); }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const controls = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")];
    if (!controls.length) return;
    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
    else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
  }

  const normalized = query.trim().toLocaleLowerCase();
  const recent = filter === "recent" ? records.filter((record) => (recentIds.includes(record.id) || record.id === selected?.id)
    && (!normalized || [record.id, record.title, record.customer, record.site, record.type, record.stage].some((value) => value.toLocaleLowerCase().includes(normalized))))
    .sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id)).slice(0, limit) : [];
  const shown = filter === "recent" ? recent : page?.records ?? [];
  const total = filter === "recent" ? recent.length : page?.total ?? 0;

  return <>
    <div className="d5o-sidebar-record-context">
      <span className="d5o-sidebar-record-label">CURRENT WORK RECORD</span>
      {selected ? <><strong className="d5o-sidebar-record-title" title={selected.title}>{selected.title}</strong><small className="d5o-sidebar-record-meta" title={`${selected.customer} · ${displayedStage(selected)}`}>{selected.customer} · {displayedStage(selected)}</small></> : <span className="d5o-sidebar-record-empty">No Work Record selected</span>}
      <button ref={triggerRef} type="button" className="d5o-sidebar-record-switch" onClick={() => { setQuery(""); setFilter("all"); setPage(null); setError(""); setLoading(true); setOpen(true); }}>Find or switch work <span aria-hidden="true">⌕</span></button>
      {selected ? <button type="button" className="d5o-sidebar-record-overview" onClick={onOverview}>Open record overview <span aria-hidden="true">→</span></button> : null}
    </div>
    {open && createPortal(<div className="d5o-work-switch-scrim" style={{ "--d5o-accent": accent } as CSSProperties} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialogRef} className="d5o-work-switch-dialog" role="dialog" aria-modal="true" aria-labelledby="d5o-work-switch-title" onKeyDown={handleKeyDown}>
        <header><div><small>{workspaceName.toUpperCase()} · WORK RECORDS</small><h2 id="d5o-work-switch-title">Find work</h2><p>Search by title, customer, site, type, stage, or record ID.</p></div><button type="button" className="d5o-work-switch-close" aria-label="Close Work Record switcher" onClick={close}>×</button></header>
        <div className="d5o-work-switch-controls"><label htmlFor="d5o-work-switch-search">Search Work Records</label><input ref={searchRef} id="d5o-work-switch-search" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(null); setError(""); setLoading(filter !== "recent"); }} placeholder="Search work, customer, site, or ID" /><nav aria-label="Work Record filters">{([ ["all", "All"], ["mine", "My work"], ["attention", "Needs attention"], ["recent", "Recent"] ] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => { setFilter(key); setPage(null); setError(""); setLoading(key !== "recent"); }}>{label}</button>)}</nav></div>
        <div className="d5o-work-switch-results" aria-live="polite"><p>{loading && !page && filter !== "recent" ? "Searching this workspace…" : error || (total ? `Showing ${shown.length} of ${total} matching Work Records` : "No matching Work Records")}</p>{shown.length ? shown.map((record) => <button key={record.id} type="button" disabled={Boolean(openingId)} className={record.id === selected?.id ? "is-current" : ""} onClick={() => void chooseResult(record)}><span><strong>{record.title}</strong><small>{record.customer} · {record.site}</small><small>{record.type} · {displayedStage(record)}</small></span><span className={`d5o-work-switch-status is-${record.status}`}>{openingId === record.id ? "Opening…" : record.id === selected?.id ? "Current" : record.status === "attention" ? "Needs attention" : record.status === "complete" ? "Complete" : "Moving"}</span></button>) : !loading && !error ? <div className="d5o-work-switch-empty">Try another search or filter. Only Work Records in this workspace are available.</div> : null}{filter !== "recent" && page?.nextCursor ? <button type="button" className="d5o-work-switch-more" disabled={loading} onClick={() => void loadMore()}>{loading ? "Loading…" : "Load more Work Records"}</button> : null}</div>
      </section>
    </div>, document.body)}
  </>;
}
