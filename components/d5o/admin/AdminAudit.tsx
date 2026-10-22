"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import styles from "./AdminAudit.module.css";
import { adminActionLabel } from "./admin-action-label";

type Event = { at: string; actor: string; action: string; subject: string;
  reference: string; detail: string };
type Page = { items: Event[]; total: number; offset: number };
type Filters = { actor: string; action: string; subject: string; from: string; to: string };

export function AdminAudit({ workspace, initialFilters, initialOffset = 0 }: {
  workspace: string; initialFilters: Filters; initialOffset?: number;
}) {
  const [page, setPage] = useState<Page | null>(null);
  const [filters, setFilters] = useState(initialFilters);
  const [draft, setDraft] = useState(filters);
  const [offset, setOffset] = useState(initialOffset);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ workspace, offset: String(offset), ...filters });
      const response = await fetch(`/api/d5o-hosted/admin-audit?${query}`, { cache: "no-store" });
      const body = await response.json() as Page & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Audit unavailable");
      setPage(body); setError("");
    } finally { setLoading(false); }
  }, [workspace, offset, filters]);
  useEffect(() => { const timer = window.setTimeout(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Audit unavailable")); }, 0);
    return () => window.clearTimeout(timer); }, [load]);
  function syncUrl(nextFilters: Filters, nextOffset: number) {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(nextFilters)) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    if (nextOffset) url.searchParams.set("offset", String(nextOffset)); else url.searchParams.delete("offset");
    window.history.replaceState(window.history.state, "", url);
  }
  function apply(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setOffset(0); setFilters(draft); syncUrl(draft, 0); }
  return <section className={styles.audit} aria-label="Workspace administrative audit">
    <h2>Administrative history</h2>
    <p>Recorded workspace changes. Older events may not contain a rationale; missing details are not inferred.</p>
    <details className={styles.filterDisclosure}><summary>Filters{Object.values(filters).filter(Boolean).length ? ` · ${Object.values(filters).filter(Boolean).length} applied` : ""}</summary><form onSubmit={apply} className={styles.filters}>
      <label>Actor email<input value={draft.actor} onChange={(e) => setDraft({ ...draft, actor: e.target.value })} /></label>
      <label>Action<input value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} /></label>
      <label>Subject or detail<input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label>
      <label>From<input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
      <label>To<input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
      <button type="submit">Filter events</button>
    </form></details>
    {error && <p role="alert" className={styles.error}>Audit could not be loaded. Your filters are preserved. <button type="button" onClick={() => void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Audit unavailable"))}>Try again</button><span className={styles.srOnly}>{error}</span></p>}
    <p role="status">{loading ? "Loading audit…" : page ? `${page.total} retained events` : "Audit is unavailable."}</p>
    <div className={styles.events}><div className={styles.eventHead}><span>When (local time)</span><span>Actor</span><span>Action</span><span>Subject</span><span>Details</span></div>{page?.items.map((item) =>
      <article key={`${item.action}:${item.reference}`}>
        <time data-label="When" dateTime={item.at}>{new Date(item.at).toLocaleString(undefined, { timeZoneName: "short" })}</time>
        <span data-label="Actor">{item.actor}</span><strong data-label="Action">{adminActionLabel(item.action)}</strong><span data-label="Subject">{item.subject || "Workspace"}</span>
        <details><summary>View event</summary><p>{item.detail || "No further detail was retained."}</p><dl><dt>Original command</dt><dd>{item.action}</dd><dt>Event / command reference</dt><dd>{item.reference}</dd><dt>Subject reference</dt><dd>{item.subject || "Workspace"}</dd></dl></details>
      </article>)}{page && page.items.length === 0 && <p>No events match these filters.</p>}</div>
    <div className={styles.pagination}>
      <button type="button" disabled={offset === 0} onClick={() => { const next=Math.max(0,offset-25); setOffset(next); syncUrl(filters,next); }}>Previous</button>
      <button type="button" disabled={!page || offset + 25 >= page.total} onClick={() => { const next=offset+25; setOffset(next); syncUrl(filters,next); }}>Next</button>
    </div>
  </section>;
}
