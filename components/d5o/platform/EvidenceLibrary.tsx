"use client";

import { useEffect, useMemo, useState } from "react";

type Evidence = { id: string; name: string; kind: string; state: "draft" | "verified" | "accepted"; added: string; source?: string };
type Work = { id: string; title: string; customer: string; site: string; evidence?: Evidence[] };
type PrivateReceipt = { id: string; workId: string; workTitle: string; customer: string;
  site: string; kind: string; scopeId: string | null; revision: number; name: string;
  filename: string; status: string; checksumSha256: string; sizeBytes: number;
  uploadedAt: string; downloadUrl: string };
type Filter = "all" | Evidence["state"];

export function EvidenceLibrary({ work, hostedWorkspace, onOpen }: {
  work: Work[]; hostedWorkspace?: string;
  onOpen: (item: Work, tab: "Evidence" | "Overview") => void
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [privateReceipts, setPrivateReceipts] = useState<PrivateReceipt[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    if (!hostedWorkspace) return;
    let active = true;
    fetch(`/api/d5o-hosted/private-evidence-index?workspace=${encodeURIComponent(hostedWorkspace)}`, {
      cache: "no-store"
    }).then(async (response) => {
      if (!response.ok) throw new Error(response.status === 403 ? "This role cannot browse private documents." : "Private document index is unavailable.");
      return response.json() as Promise<{ entries: PrivateReceipt[]; nextOffset: number | null }>;
    }).then((result) => {
      if (!active) return;
      setPrivateReceipts(result.entries);
      setNextOffset(result.nextOffset);
      setLoadError("");
    }).catch((error) => {
      if (active) setLoadError(error instanceof Error ? error.message : "Private document index is unavailable.");
    });
    return () => { active = false; };
  }, [hostedWorkspace]);
  async function loadMore() {
    if (!hostedWorkspace || nextOffset === null || loading) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/d5o-hosted/private-evidence-index?workspace=${encodeURIComponent(hostedWorkspace)}&offset=${nextOffset}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Private document index is unavailable.");
      const result = await response.json() as { entries: PrivateReceipt[]; nextOffset: number | null };
      setPrivateReceipts((current) => [...current, ...result.entries]);
      setNextOffset(result.nextOffset);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Private document index is unavailable.");
    } finally {
      setLoading(false);
    }
  }
  const records = useMemo(() => new Map(work.map((item) => [item.id, item])), [work]);
  const evidence = work.flatMap((record) => (record.evidence ?? []).map((entry) => ({ ...entry, record })));
  const query = search.toLowerCase();
  const shown = evidence.filter((entry) => (filter === "all" || entry.state === filter) &&
    `${entry.name} ${entry.kind} ${entry.record.title} ${entry.record.customer}`.toLowerCase().includes(query));
  const privateShown = privateReceipts.filter((entry) =>
    `${entry.name} ${entry.filename} ${entry.kind} ${entry.workTitle} ${entry.customer} ${entry.site}`.toLowerCase().includes(query));
  const matchingWork = search.trim() ? work.filter((record) =>
    `${record.title} ${record.customer} ${record.site}`.toLowerCase().includes(query)).slice(0, 8) : [];
  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All references" }, { key: "draft", label: "Awaiting review" },
    { key: "verified", label: "Reviewed" }, { key: "accepted", label: "Accepted" }
  ];
  return <section className="d5o-library-board">
    <header><div><p>EVIDENCE LIBRARY</p><h1>Find proof in the work it supports.</h1>
      <span>Find retained private documents and shared Work Record references. A file receipt is not a review or acceptance decision.</span></div>
      <div><strong>{privateReceipts.length + evidence.length}</strong><span>visible documents and references</span></div></header>
    <section className="d5o-library-register" aria-label="Private documents">
      <header><div><p>PRIVATE CUSTODY</p><strong>Retained documents</strong></div>
        <label>Find document or work<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search file, customer or work" /></label></header>
      {loadError ? <p role="alert" className="d5o-empty-state">{loadError}</p> : null}
      {privateShown.map((entry) => <article className="d5o-private-evidence-row" key={entry.id}>
        <div><strong>{entry.name}</strong><small>{entry.filename} · revision {entry.revision} · {entry.kind.replaceAll("-", " ")}</small>
          <small>{entry.workTitle} · {entry.customer} · {entry.site}</small>
          <small>{entry.status} · SHA-256 {entry.checksumSha256.slice(0, 16)}… · {new Date(entry.uploadedAt).toLocaleDateString()}</small></div>
        <div><a href={entry.downloadUrl} target="_blank" rel="noreferrer">Open retained PDF</a>
          <button type="button" onClick={() => { const record = records.get(entry.workId); if (record) onOpen(record, "Overview"); }}>Open Work Record</button></div>
      </article>)}
      {!privateShown.length && !loadError ? <p className="d5o-empty-state">No retained private document matches this view.</p> : null}
      {nextOffset !== null ? <button type="button" onClick={() => void loadMore()} disabled={loading}>{loading ? "Loading…" : "Load more documents"}</button> : null}
    </section>
    <section className="d5o-library-register"><header><nav aria-label="Evidence status filters">{filters.map((option) =>
      <button key={option.key} className={filter === option.key ? "is-active" : ""} onClick={() => setFilter(option.key)}>{option.label}<b>{evidence.filter((entry) => option.key === "all" || entry.state === option.key).length}</b></button>)}</nav></header>
      <div className="d5o-library-row-head"><span>REFERENCE</span><span>WORK RECORD</span><span>PURPOSE</span><span>STATE</span></div>
      {shown.map((entry) => <button key={`${entry.record.id}:${entry.id}`} onClick={() => onOpen(entry.record, "Evidence")}><span><strong>{entry.name}</strong><small>{entry.source || `Synthetic baseline · ${entry.added}`}</small></span><span><strong>{entry.record.title}</strong><small>{entry.record.customer} · {entry.record.site}</small></span><span>{entry.kind}</span><b className={entry.state}>{entry.state === "draft" ? "Awaiting review" : entry.state === "verified" ? "Reviewed" : "Accepted"}</b></button>)}
      {!shown.length ? <p className="d5o-empty-state">No shared reference matches this view.</p> : null}
    </section>
    {matchingWork.length ? <section className="d5o-library-register" aria-label="Matching Work Records"><header><div><p>WORK RECORDS</p><strong>Open the owning record for full context</strong></div></header>
      {matchingWork.map((record) => <button key={record.id} type="button" onClick={() => onOpen(record, "Overview")}><strong>{record.title}</strong><span>{record.customer} · {record.site}</span><span>Open full record →</span></button>)}
    </section> : null}
  </section>;
}
