"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Event = { at: string; actor: string; action: string; subject: string;
  reference: string; detail: string };
type Page = { items: Event[]; total: number; offset: number };

export function AdminAudit({ workspace, initialSubject = "" }: { workspace: string; initialSubject?: string }) {
  const [page, setPage] = useState<Page | null>(null);
  const [filters, setFilters] = useState({ actor: "", action: "", subject: initialSubject, from: "", to: "" });
  const [draft, setDraft] = useState(filters);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const query = new URLSearchParams({ workspace, offset: String(offset), ...filters });
    const response = await fetch(`/api/d5o-hosted/admin-audit?${query}`, { cache: "no-store" });
    const body = await response.json() as Page & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Audit unavailable");
    setPage(body); setError("");
  }, [workspace, offset, filters]);
  useEffect(() => { const timer = window.setTimeout(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Audit unavailable")); }, 0);
    return () => window.clearTimeout(timer); }, [load]);
  function apply(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setOffset(0); setFilters(draft); }
  return <section aria-label="Workspace administrative audit">
    <h2>Retained administrative history</h2>
    <p>Workspace-scoped command history. Older actions without a retained rationale show their recorded action and reference; no missing reason is inferred.</p>
    <form onSubmit={apply} style={{ display: "flex", flexWrap: "wrap", gap: ".6rem" }}>
      <label>Actor email<input value={draft.actor} onChange={(e) => setDraft({ ...draft, actor: e.target.value })} /></label>
      <label>Action<input value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} /></label>
      <label>Subject or detail<input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label>
      <label>From<input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
      <label>To<input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
      <button type="submit">Filter events</button>
    </form>
    {error && <p role="alert">{error}</p>}
    <p role="status">{page ? `${page.total} retained events` : "Loading audit…"}</p>
    <div style={{ display: "grid", gap: ".6rem" }}>{page?.items.map((item) =>
      <article key={`${item.action}:${item.reference}`} style={{ background: "white", padding: "1rem", border: "1px solid #d5e0e7", borderRadius: ".6rem" }}>
        <strong>{item.action}</strong><span> · {new Date(item.at).toLocaleString()}</span>
        <p>{item.actor} · subject {item.subject || "workspace"}</p><p>{item.detail}</p>
        <small>Command / event {item.reference}</small>
      </article>)}</div>
    <div style={{ display: "flex", gap: ".6rem", marginTop: "1rem" }}>
      <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button>
      <button type="button" disabled={!page || offset + 25 >= page.total} onClick={() => setOffset(offset + 25)}>Next</button>
    </div>
  </section>;
}
