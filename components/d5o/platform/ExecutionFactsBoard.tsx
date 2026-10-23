"use client";

import { useState } from "react";
import type { WorkRecord } from "./work-types";
import type { SharedSchedule } from "./schedule-model";
import { assessPackageCompletion, currentAcceptedRelease, currentReviewedCompletion, deployState } from "./deploy-model";

type Filter = "all" | "held" | "field" | "review" | "accepted";
type Row = { record: WorkRecord; pkg: NonNullable<WorkRecord["packages"]>[number]; releaseId: string | null;
  position: Exclude<Filter, "all">; actual: string; plan: string; next: string; crew: string };

export function ExecutionFactsBoard({ workspaceName, work, schedule, onOpen, onSchedule }: {
  workspaceName: string; work: WorkRecord[]; schedule: SharedSchedule | null;
  onOpen: (item: WorkRecord) => void; onSchedule: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const rows: Row[] = work.flatMap((record) => (record.packages ?? []).map((pkg) => {
    const release = currentAcceptedRelease(record, pkg.id);
    const completion = currentReviewedCompletion(record, pkg.id);
    const assessed = assessPackageCompletion(record, pkg.id);
    const turnover = deployState(record).turnovers.find((item) => item.status === "Client accepted" && item.releaseIds.includes(release?.id ?? ""));
    const publication = schedule?.publications.filter((item) => item.assignments.some((assignment) => assignment.workId === record.id && assignment.packageId === pkg.id)).at(-1);
    const crewCount = publication?.assignments.filter((assignment) => assignment.workId === record.id && assignment.packageId === pkg.id).length ?? 0;
    const position: Row["position"] = turnover ? "accepted" : !release || record.blockers.length ? "held" : completion ? "review" : "field";
    const basis = assessed.basis;
    return { record, pkg, releaseId: release?.id ?? null, position,
      actual: assessed.reviewedQuantity === null ? `${assessed.reportIds.length} reviewed reports` : `${assessed.reviewedQuantity} ${basis?.kind === "Measured" ? basis.unit : ""} reviewed`,
      plan: basis?.kind === "Measured" ? `${basis.plannedQuantity} ${basis.unit} planned` : basis?.kind === "Qualitative" ? basis.criterion : "Plan unknown",
      next: turnover ? "Scoped client acceptance recorded" : !release ? "Receive a current Design release" :
        record.blockers[0] ?? (completion ? "Assemble turnover and obtain customer acceptance" : assessed.blockers[0] ?? "Review completion"),
      crew: crewCount ? `${crewCount} published shift${crewCount === 1 ? "" : "s"}` : "No published crew shift" };
  }));
  const shown = rows.filter((item) => filter === "all" || item.position === filter);
  const count = (key: Filter) => key === "all" ? rows.length : rows.filter((item) => item.position === key).length;
  const filters: Array<{ key: Filter; label: string }> = [
    { key: "all", label: "All packages" }, { key: "held", label: "Release or condition" },
    { key: "field", label: "Field work" }, { key: "review", label: "Completion reviewed" },
    { key: "accepted", label: "Client accepted" }
  ];
  return <section className="d5o-execution-board">
    <header className="d5o-board-hero"><div><p>EXECUTION & CONTROL · {workspaceName.toUpperCase()}</p>
      <h1>Package delivery facts</h1><span>Current releases, reviewed actuals, completion decisions and scoped acceptance from the same Work Records.</span></div>
    </header>
    <section className="d5o-execution-layout"><article className="d5o-execution-main"><header><p>PACKAGE CONTROL BOARD</p>
      <h2>What is current, measured and awaiting a decision</h2>
      <nav className="d5o-execution-filters" aria-label="Filter work packages">{filters.map((option) =>
        <button key={option.key} className={filter === option.key ? "is-active" : ""} onClick={() => setFilter(option.key)}>
          {option.label}<b>{count(option.key)}</b></button>)}</nav></header>
      <div className="d5o-package-board-head"><span>WORK / PACKAGE</span><span>OWNER / CREW PLAN</span><span>PLANNED / REVIEWED</span><span>CURRENT CONTROL</span></div>
      {shown.map((item) => <button key={`${item.record.id}:${item.pkg.id}`} onClick={() => onOpen(item.record)}>
        <div><small>{item.record.title}</small><strong>{item.pkg.name}</strong><em>{item.record.site}</em></div>
        <div><strong>{item.pkg.owner}</strong><small>{item.crew}</small></div>
        <div className="d5o-package-progress"><span><small>Planned</small><strong>{item.plan}</strong></span><span><small>Reviewed</small><strong>{item.actual}</strong></span></div>
        <div className={item.position === "held" ? "is-held" : ""}><b>{item.position === "held" ? "Hold / no current release" : item.position === "field" ? "Field work" : item.position === "review" ? "Completion reviewed" : "Client accepted"}</b>
          <small>{item.next}</small><small>{item.releaseId ? `Release ${item.releaseId.slice(0, 8)}` : "Release unknown"}</small></div>
      </button>)}{!shown.length ? <p className="d5o-empty-state">No packages match this position.</p> : null}
    </article></section>
    <section className="d5o-execution-pulse" aria-label="Delivery totals">
      <article><span>PACKAGES</span><strong>{rows.length}</strong><small>Shared Work Package identities</small></article>
      <article><span>FIELD WORK</span><strong>{count("field")}</strong><small>Current release; completion outstanding</small></article>
      <article><span>COMPLETION REVIEWED</span><strong>{count("review")}</strong><small>Exact scope and verification reviewed</small></article>
      <article><span>CLIENT ACCEPTED</span><strong>{count("accepted")}</strong><small>Scoped customer acceptance</small></article>
    </section>
    <section className="d5o-execution-crew"><div><p>CREW COVERAGE</p><h2>Plan and responses remain in Crew Schedule</h2>
      <span>Published bookings are visible here; they do not grant field-start authority.</span></div><button onClick={onSchedule}>Open crew schedule →</button></section>
    <details className="d5o-execution-guidance"><summary>How delivery facts are counted</summary><p>Historical percentages do not count as reviewed quantities. Planning, reviewed work, verification and customer acceptance remain separate decisions. A report is not completion.</p></details>
  </section>;
}
