"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import styles from "./AdminAudit.module.css";

type Event = { at: string; actor: string; action: string; subject: string;
  reference: string; detail: string };
type Page = { items: Event[]; total: number; offset: number };
const actionNames: Record<string, string> = {
  assigned: "Workspace access assigned", suspended: "Workspace access suspended",
  restored: "Workspace access restored", "membership.succession": "Administrator added",
  "workforce.save-person": "Roster profile changed", "workforce.set-active": "Roster status changed",
  "workforce.bind-person": "Account binding requested", "binding.bound": "Account bound to roster person",
  "binding.corrected": "Account binding corrected", "identity.invite": "Invitation requested",
  "identity.recovery": "Account recovery requested", "delegation.add": "Decision delegate added",
  "delegation.revoke": "Decision delegate revoked", "configuration.activate": "Configuration activated",
  "configuration.validate-publish": "Configuration published", "configuration.create-draft": "Configuration draft created",
};
function actionLabel(action: string) { return actionNames[action] ?? action.replaceAll(/[._-]/g, " "); }

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
    <h2>Administrative history</h2>
    <p>Recorded workspace changes. Older events may not contain a rationale; missing details are not inferred.</p>
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
    <div className={styles.events}><div className={styles.eventHead}><span>When (local time)</span><span>Actor</span><span>Action</span><span>Subject</span><span>Details</span></div>{page?.items.map((item) =>
      <article key={`${item.action}:${item.reference}`}>
        <time dateTime={item.at}>{new Date(item.at).toLocaleString(undefined, { timeZoneName: "short" })}</time>
        <span>{item.actor}</span><strong>{actionLabel(item.action)}</strong><span>{item.subject || "Workspace"}</span>
        <details><summary>View event</summary><p>{item.detail || "No further detail was retained."}</p><dl><dt>Original command</dt><dd>{item.action}</dd><dt>Event / command reference</dt><dd>{item.reference}</dd><dt>Subject reference</dt><dd>{item.subject || "Workspace"}</dd></dl></details>
      </article>)}{page && page.items.length === 0 && <p>No events match these filters.</p>}</div>
    <div className={styles.pagination}>
      <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button>
      <button type="button" disabled={!page || offset + 25 >= page.total} onClick={() => setOffset(offset + 25)}>Next</button>
    </div>
  </section>;
}
