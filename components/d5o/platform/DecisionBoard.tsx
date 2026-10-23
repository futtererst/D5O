"use client";

import { useEffect, useState } from "react";
import type { DecisionQueueContext } from "./decision-queue-context";
import { lifecycleProfiles } from "./lifecycle-profiles";

type Work = { id: string; workspace: "rybex" | "rotork"; title: string; customer: string; site: string; stage: string; owner: string; value: string; status: "attention" | "moving" | "complete"; evidence?: { state: "draft" | "verified" | "accepted" }[]; source?: Work };
type Filter = "all" | "blocked" | "actionable" | "completed";
type QueuePage<T> = { records: T[]; total: number; nextCursor: string | null;
  overview: { total: number; blocked: number; actionable: number; completed: number } };

export function DecisionBoard<T extends Work>({ work: localWork, getDecisionContext, onOpen, hostedWorkspace }: { work: T[]; getDecisionContext: (item: T) => DecisionQueueContext; onOpen: (item: T) => void; hostedWorkspace?: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState("");
  const [result, setResult] = useState<{ key: string; page: QueuePage<T> } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const localSignature = localWork.map((item) => `${item.id}:${item.stage}:${item.status}`).join("|");
  const requestKey = `${filter}:${localSignature}`;
  const page = result?.key === requestKey ? result.page : null;
  const error = failure?.key === requestKey ? failure.message : "";
  const loading = (!page && !error) || loadingMore;
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ view: "decisions", filter });
    if (hostedWorkspace) params.set("workspace", hostedWorkspace);
    void fetch(`${hostedWorkspace ? "/api/d5o-hosted/prototype-search" : "/api/work/search"}?${params}`, { cache: "no-store", signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("Decision queue unavailable"); return response.json() as Promise<QueuePage<T>>; })
      .then((next) => { if (!controller.signal.aborted) { setResult({ key: requestKey, page: next }); setFailure(null); } })
      .catch(() => { if (!controller.signal.aborted) setFailure({ key: requestKey, message: "Decision queue unavailable. Try again." }); });
    return () => controller.abort();
  }, [filter, requestKey, hostedWorkspace]);
  async function loadMore() {
    if (!page?.nextCursor || loading) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ view: "decisions", filter, cursor: page.nextCursor });
      if (hostedWorkspace) params.set("workspace", hostedWorkspace);
      const response = await fetch(`${hostedWorkspace ? "/api/d5o-hosted/prototype-search" : "/api/work/search"}?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Decision queue changed");
      const next = await response.json() as QueuePage<T>;
      setResult({ key: requestKey, page: { ...next, records: [...page.records, ...next.records] } });
      setFailure(null);
    } catch { setFailure({ key: requestKey, message: "The decision queue changed. Reopen this view to refresh." }); }
    finally { setLoadingMore(false); }
  }
  const visible = (page?.records ?? []).map((item) => localWork.find((local) => local.id === item.id) ?? item);
  const focus = visible.find((item) => item.id === selectedId) ?? visible[0];
  const focusContext = focus ? getDecisionContext(focus) : null;
  const filters: { key: Filter; label: string }[] = [{ key: "all", label: "All positions" }, { key: "blocked", label: "Work holds" }, { key: "actionable", label: "At review stage" }, { key: "completed", label: "Outcomes" }];
  if (!page) return <section className="d5o-decisions-board"><header><div><p>DECISION QUEUE</p><h1>Put judgment where work can move.</h1></div></header><div className="d5o-ops-panel d5o-queue-loading" role={error ? "alert" : "status"}>{error || "Loading workspace decisions…"}{error ? <button onClick={() => window.location.reload()}>Retry</button> : null}</div></section>;
  return <section className="d5o-decisions-board"><header><div><p>DECISION QUEUE</p><h1>Decisions and prerequisites</h1><span>Find the Work Record and condition that needs attention. A review-stage position can still have prerequisites to resolve before a decision.</span></div></header><nav aria-label="Decision filters">{filters.map((option) => <button key={option.key} className={filter === option.key ? "is-active" : ""} onClick={() => setFilter(option.key)}>{option.label}<b>{page?.overview[option.key === "all" ? "total" : option.key] ?? "—"}</b></button>)}</nav><div className="d5o-decisions-layout"><section className="d5o-decisions-list"><div className="d5o-decisions-list-head"><span>WORK / DECISION</span><span>DECISION PROFILE</span><span>CONDITION</span></div>{visible.map((item) => { const context = getDecisionContext(item); return <button key={item.id} className={focus?.id === item.id ? "is-selected" : ""} onClick={() => setSelectedId(item.id)}><span><small>{item.stage} · {item.customer}</small><strong>{context.decision}</strong><em>{item.title} · {context.blockers.length ? `Open ${context.target}` : "Ready for review"}</em></span><span>{context.profile}</span><b className={context.blockers.length ? "is-held" : ""}>{context.blockers.length ? "Needs prerequisite" : item.status === "complete" ? "Outcome" : "Review"}</b></button>; })}{!visible.length && !loading ? <p className="d5o-empty-state">{error || "No decisions match this view."}</p> : null}{page?.nextCursor ? <div className="d5o-queue-pagination"><button disabled={loading} onClick={() => { void loadMore(); }}>Load more decisions</button></div> : null}</section><aside className="d5o-decision-focus">{focus && focusContext ? <><p>DECISION FOCUS</p><h2>{focusContext.decision}</h2><span>{focus.title} · {focus.site}</span><dl><div><dt>Current condition</dt><dd>{focusContext.blockers[0] || "Current conditions are available for review."}</dd></div><div><dt>Resolve or review in</dt><dd>{focusContext.target}</dd></div><div><dt>Configured path</dt><dd>{lifecycleProfiles[focus.workspace].workType} · {lifecycleProfiles[focus.workspace].states.join(" → ")}</dd></div><div><dt>{focusContext.pinned ? "Decision profile" : "Next responsible actor"}</dt><dd>{focusContext.profile}</dd></div><div><dt>Work Record owner</dt><dd>{focus.owner}</dd></div><div><dt>Proof in context</dt><dd>{(focus.evidence ?? []).filter((entry) => entry.state !== "draft").length} reviewed references · {(focus.evidence ?? []).filter((entry) => entry.state === "draft").length} drafts</dd></div><div><dt>Value protected</dt><dd>{focus.value}</dd></div></dl><button onClick={() => onOpen(focus.source as T ?? focus)}>Open {focusContext.target} in Work Record →</button><small className="d5o-prototype-authority-note">The decision profile is synthetic authority context. Work Record ownership alone does not grant approval rights.</small></> : <p>Select a decision to inspect its context.</p>}</aside></div></section>;
}
