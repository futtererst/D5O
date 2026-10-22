"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./AdminOverview.module.css";
import { adminActionLabel } from "./admin-action-label";

type Summary = { members: number; people: number; activePeople: number; activeVersion: string; recent: Array<{ at: string; action: string; actor: string; subject?: string }> };

export function AdminOverview({ workspace }: { workspace: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    const query = `workspace=${encodeURIComponent(workspace)}`;
    void Promise.all([
      fetch(`/api/d5o-hosted/admin-directory?${query}&limit=1`, { cache: "no-store" }),
      fetch(`/api/d5o-hosted/workforce?${query}`, { cache: "no-store" }),
      fetch(`/api/d5o-hosted/admin-configuration?${query}`, { cache: "no-store" }),
      fetch(`/api/d5o-hosted/admin-audit?${query}&offset=0`, { cache: "no-store" }),
    ]).then(async (responses) => {
      if (responses.some((response) => !response.ok)) throw new Error("Administration summary is unavailable.");
      const [directory, workforce, configuration, audit] = await Promise.all(responses.map((response) => response.json())) as [
        { total: number }, { people: Array<{ active: boolean }> },
        { activeVersionId: string; versions: Array<{ id: string; version: number }> },
        { items: Array<{ at: string; action: string; actor: string; subject?: string }> },
      ];
      if (current) { setSummary({ members: directory.total, people: workforce.people.length,
        activePeople: workforce.people.filter((person) => person.active).length,
        activeVersion: String(configuration.versions.find((version) => version.id === configuration.activeVersionId)?.version ?? "unavailable"),
        recent: audit.items.slice(0, 3) }); setError(""); }
    }).catch(() => { if (current) setError("The current summary could not be loaded. Open a section to inspect its records, or try again."); });
    return () => { current = false; };
  }, [workspace, reload]);
  const href = (section: string) => `/work/admin/${section}?workspace=${encodeURIComponent(workspace)}`;
  return <div className={styles.overview}>
    <p>Manage workspace access, people and operating policy. Business approvals remain with their assigned reviewers.</p>
    {error && <p role="alert">{error} <button type="button" onClick={() => setReload((value) => value + 1)}>Try again</button></p>}
    {!summary && !error && <p role="status">Loading current administration summary…</p>}
    {summary && <><div className={styles.metrics}>
      <article><span>Workspace accounts</span><strong>{summary.members}</strong><Link href={href("users")}>Open directory</Link></article>
      <article><span>Roster people</span><strong>{summary.people}</strong><small>{summary.activePeople} active</small><Link href={href("workforce")}>Open workforce</Link></article>
      <article><span>Active configuration</span><strong>v{summary.activeVersion}</strong><Link href={href("configuration")}>Review policy</Link></article>
    </div><div className={styles.lower}>
      <section><h2>Common actions</h2><Link href={href("users")}>Invite or assign access →</Link><Link href={href("workforce")}>Add a roster person →</Link><Link href={href("authority")}>Review delegation and rates →</Link></section>
      <section><h2>Recent administrative changes</h2>{summary.recent.length ? summary.recent.map((item, index) =>
        <p key={`${item.at}:${index}`}><strong>{adminActionLabel(item.action)}</strong>{item.subject && !/^[0-9a-f-]{36}$/i.test(item.subject) && <span>Affected: {item.subject}</span>}<small>{item.actor} · {new Date(item.at).toLocaleString()}</small>{item.subject && /^[0-9a-f-]{36}$/i.test(item.subject) && <small>Subject reference: {item.subject}</small>}</p>) : <p>No retained administrative changes in this page of history.</p>}
        <Link href={href("audit")}>Open audit history →</Link></section>
    </div></>}
  </div>;
}
