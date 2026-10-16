"use client";

import { useState } from "react";
import { type Assignment, type ScheduleDemand } from "./schedule-model";

export function ScheduleDemandQueue({ demand, assignments, week, canEdit, onPlan, onReviewPlan, onOpenWork }: {
  demand: ScheduleDemand[];
  assignments: Assignment[];
  anchorDate: string;
  week: number;
  canEdit: boolean;
  onPlan: (item: ScheduleDemand) => void;
  onReviewPlan: (item: ScheduleDemand) => void;
  onOpenWork: (item: ScheduleDemand) => void;
}) {
  const [today] = useState(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
  const allBookingsFor = (item: ScheduleDemand) => assignments.filter((booking) => booking.week === week && booking.workId === item.workId && booking.packageId === item.packageId);
  const bookingsFor = (item: ScheduleDemand) => allBookingsFor(item).filter((booking) => booking.date === item.date && booking.shift === item.shift);
  const invalidBookingsFor = (item: ScheduleDemand) => allBookingsFor(item).filter((booking) => !item.requiredSlots.some((slot) => booking.date === slot.date && booking.shift === slot.shift));
  const unstaffed = demand.filter((item) => item.configured && bookingsFor(item).length === 0 && invalidBookingsFor(item).length === 0);
  const needsCorrection = demand.filter((item) => item.configured && bookingsFor(item).length === 0 && invalidBookingsFor(item).length > 0);
  const understaffed = demand.filter((item) => item.configured && bookingsFor(item).length > 0 && new Set(bookingsFor(item).flatMap((booking) => booking.people)).size < item.minimumPeople);
  const missing = demand.filter((item) => !item.configured);
  const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }).replace(",", "");
  const pastDue = (item: ScheduleDemand) => item.date < today;
  const pastUnstaffed = unstaffed.filter(pastDue);
  const schedulable = unstaffed.filter((item) => !pastDue(item));
  const key = (item: ScheduleDemand) => `${item.workId}:${item.packageId}:${item.date}:${item.shift}`;
  if (!unstaffed.length && !needsCorrection.length && !understaffed.length && !missing.length) return null;
  return <section className="d5o-demand-board" id="d5o-crew-coverage" aria-label="Work awaiting a crew">
    <header><div><p>ACTION REQUIRED · PACKAGE DEMAND</p><h2>Work needing a crew</h2><span>Assign people to current required shifts. Past dates need a reviewed package plan before new scheduling.</span></div><div className="d5o-demand-totals">{schedulable.length ? <strong>{schedulable.length} slot{schedulable.length === 1 ? "" : "s"} to schedule</strong> : null}{pastUnstaffed.length ? <span>{pastUnstaffed.length} past required date{pastUnstaffed.length === 1 ? "" : "s"}</span> : null}{understaffed.length ? <span>{understaffed.length} partly staffed slot{understaffed.length === 1 ? "" : "s"}</span> : null}{needsCorrection.length ? <span>{needsCorrection.length} booking mismatch{needsCorrection.length === 1 ? "" : "es"}</span> : null}{missing.length ? <span>{missing.length} package{missing.length === 1 ? "" : "s"} need requirements</span> : null}</div></header>
    <div className="d5o-demand-list">
      {unstaffed.map((item) => <article key={key(item)} className="d5o-demand-row">
        <div className="d5o-demand-identity"><span className={`d5o-demand-priority is-${item.priority.toLowerCase()}`}>{item.priority}</span><h3>{item.packageName}</h3><p>{item.workTitle} · {item.site}</p></div>
        <div><b>CREW NEEDED</b><strong>{item.minimumPeople}+ qualified people</strong><small>{item.qualification}</small></div>
        <div><b>REQUIRED DATE & SHIFT</b><strong>{dateLabel(item.date)}</strong><small>{item.shift} · {pastDue(item) ? "Past required date; review the Design plan" : "set on Work Package Plan"}</small></div>
        <div className="d5o-demand-actions">{pastDue(item) ? <button type="button" onClick={() => onOpenWork(item)}>Review package plan →</button> : <><button type="button" disabled={!canEdit} onClick={() => onPlan(item)}>Schedule crew →</button><button type="button" onClick={() => onOpenWork(item)}>View work</button></>}</div>
      </article>)}
      {needsCorrection.map((item) => <article key={key(item)} className="d5o-demand-row is-mismatch"><div className="d5o-demand-identity"><span className="d5o-demand-priority is-high">BOOKING MISMATCH</span><h3>{item.packageName}</h3><p>{item.workTitle} · {item.site}</p></div><div><b>CREW NEEDED</b><strong>{item.minimumPeople}+ qualified people</strong><small>{item.qualification}</small></div><div><b>REQUIRED DATE & SHIFT</b><strong>{dateLabel(item.date)}</strong><small>{item.shift} · an existing booking differs</small></div><div className="d5o-demand-actions"><button type="button" onClick={() => onReviewPlan(item)}>Review booking →</button><button type="button" onClick={() => onOpenWork(item)}>View work</button></div></article>)}
      {understaffed.map((item) => { const booked = new Set(bookingsFor(item).flatMap((booking) => booking.people)).size; return <article key={key(item)} className="d5o-demand-row is-mismatch"><div className="d5o-demand-identity"><span className="d5o-demand-priority is-high">CREW SHORT</span><h3>{item.packageName}</h3><p>{item.workTitle} · {item.site}</p></div><div><b>CREW NEEDED</b><strong>{item.minimumPeople - booked} more qualified {item.minimumPeople - booked === 1 ? "person" : "people"}</strong><small>{booked} of {item.minimumPeople} assigned · {item.qualification}</small></div><div><b>REQUIRED DATE & SHIFT</b><strong>{dateLabel(item.date)}</strong><small>{item.shift}</small></div><div className="d5o-demand-actions"><button type="button" onClick={() => onReviewPlan(item)}>Complete crew →</button><button type="button" onClick={() => onOpenWork(item)}>View work</button></div></article>; })}
      {missing.map((item) => <article key={key(item)} className="d5o-demand-row is-missing"><div className="d5o-demand-identity"><span className="d5o-demand-priority">RULE NEEDED</span><h3>{item.packageName}</h3><p>{item.workTitle} · {item.site}</p></div><div className="d5o-demand-explanation">A required date, shift, skill, or crew size is missing. Set these on the Work Record Plan before scheduling.</div><div className="d5o-demand-actions"><button type="button" onClick={() => onOpenWork(item)}>Set requirements →</button></div></article>)}
    </div>
  </section>;
}
