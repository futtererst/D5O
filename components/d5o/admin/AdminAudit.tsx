"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import styles from "./AdminAudit.module.css";

type Event = { at: string; actor: string; action: string; subject: string;
  reference: string; detail: string };
type Page = { items: Event[]; total: number; offset: number };

export function AdminAudit({ workspace, initialSubject = "" }: { workspace: string; initialSubject?: string }) {
  const [page, setPage] = useState<Page | null>(null);
  const [filters, setFilters] = useState({ actor: "", action: "", subject: initialSubject, from: "", to: "" });
  const [draft, setDraft] = useState(filters);
  const [offset, setOffset] = useState(0);
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
  function apply(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setOffset(0); setFilters(draft); }
  return <section className={styles.audit} aria-label="Workspace administrative audit">
    <h2>Retained administrative history</h2>
    <p>Workspace-scoped command history. Older actions without a retained rationale show their recorded action and reference; no missing reason is inferred.</p>
    <form onSubmit={apply} className={styles.filters}>
      <label>Actor email<input value={draft.actor} onChange={(e) => setDraft({ ...draft, actor: e.target.value })} /></label>
      <label>Action<input value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} /></label>
      <label>Subject or detail<input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label>
      <label>From<input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
      <label>To<input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
      <button type="submit">Filter events</button>
    </form>
    {error && <p role="alert" className={styles.error}>Audit could not be loaded. Your filters are preserved. <button type="button" onClick={() => void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Audit unavailable"))}>Try again</button><span className={styles.srOnly}>{error}</span></p>}
    <p role="status">{loading ? "Loading audit…" : page ? `${page.total} retained events` : "Audit is unavailable."}</p>
    <div className={styles.events}>{page?.items.map((item) =>
      <article key={`${item.action}:${item.reference}`}>
        <strong>{item.action}</strong><span> · {new Date(item.at).toLocaleString()}</span>
        <p>{item.actor} · subject {item.subject || "workspace"}</p><p>{item.detail}</p>
        <small>Command / event {item.reference}</small>
      </article>)}</div>
    <div className={styles.pagination}>
      <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button>
      <button type="button" disabled={!page || offset + 25 >= page.total} onClick={() => setOffset(offset + 25)}>Next</button>
    </div>
  </section>;
}
