"use client";

import { useState } from "react";
import { type Assignment, type ScheduleDemand } from "./schedule-model";

export function missingCrewRequirements(item: ScheduleDemand): string[] {
  if (!item.configured) return ["Required date and shift", "Qualified skill", "People per shift", "Estimated person-hours"];
  const missing: string[] = [];
  if (!item.requiredSlots.length || item.requiredSlots.some((slot) => !slot.date || !slot.shift)) missing.push("Required date and shift");
  if (!item.qualification.trim()) missing.push("Qualified skill");
  if (!item.minimumPeople) missing.push("People per shift");
  if (!Number.isFinite(item.estimatedPersonHours)) missing.push("Estimated person-hours");
  return missing;
}

export function ScheduleDemandQueue({ demand, assignments, week, canEdit, onPlan, onReviewBooking }: {
  demand: ScheduleDemand[]; assignments: Assignment[]; week: number; canEdit: boolean;
  onPlan: (item: ScheduleDemand) => void; onReviewBooking: (booking: Assignment) => void;
}) {
  const [today] = useState(() => new Date().toLocaleDateString("en-CA"));
  const bookingsFor = (item: ScheduleDemand) => assignments.filter((booking) => booking.week === week && booking.workId === item.workId && booking.packageId === item.packageId);
  const matching = (item: ScheduleDemand) => bookingsFor(item).filter((booking) => booking.date === item.date && booking.shift === item.shift);
  const mismatched = (item: ScheduleDemand) => bookingsFor(item).filter((booking) => !item.requiredSlots.some((slot) => booking.date === slot.date && booking.shift === slot.shift));
  const ready = demand.filter((item) => item.configured && !missingCrewRequirements(item).length && !matching(item).length && !mismatched(item).length && item.date >= today);
  const corrections = demand.flatMap((item) => mismatched(item).map((booking) => ({ item, booking })));
  const shortCrew = demand.filter((item) => matching(item).length > 0 && new Set(matching(item).flatMap((booking) => booking.people)).size < item.minimumPeople);
  const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const key = (item: ScheduleDemand) => `${item.workId}:${item.packageId}:${item.date}:${item.shift}`;
  return <section className="d5o-demand-board" id="d5o-crew-coverage" aria-label="Crew planning demand">
    {corrections.length || shortCrew.length ? <div className="d5o-demand-conflicts" role="status"><strong>{corrections.length + shortCrew.length} booking{corrections.length + shortCrew.length === 1 ? "" : "s"} need correction</strong>{corrections.map(({ item, booking }) => <button key={`${key(item)}:${booking.id}`} type="button" onClick={() => onReviewBooking(booking)}>{item.packageName} · {booking.date ? dateLabel(booking.date) : "Date not set"} {booking.shift} · Booking differs from Design demand →</button>)}{shortCrew.map((item) => { const booking = matching(item)[0]; const booked = new Set(matching(item).flatMap((entry) => entry.people)).size; return <button key={key(item)} type="button" onClick={() => onReviewBooking(booking)}>{item.packageName} · {dateLabel(item.date)} {item.shift} · {booked} of {item.minimumPeople} people →</button>; })}</div> : null}
    <details className="d5o-demand-ready"><summary><strong>Ready to schedule</strong><span>{ready.length} defined future slot{ready.length === 1 ? "" : "s"}</span></summary>{ready.length ? <div className="d5o-demand-list">{ready.map((item) => <article key={key(item)} className="d5o-demand-row"><div className="d5o-demand-identity"><h3>{item.packageName}</h3><p>{item.workTitle} · {item.site}</p></div><div><b>CREW NEEDED</b><strong>{item.minimumPeople}+ qualified people</strong><small>{item.qualification}</small></div><div><b>DESIGN DATE & SHIFT</b><strong>{dateLabel(item.date)}</strong><small>{item.shift}</small></div><div className="d5o-demand-actions"><button type="button" disabled={!canEdit} onClick={() => onPlan(item)}>Schedule crew →</button></div></article>)}</div> : <p className="d5o-demand-clear">No defined future slots need a new assignment in this week.</p>}</details>
  </section>;
}

export function PlanningPrerequisites({ demand, assignments, week, onOpenRequirements }: { demand: ScheduleDemand[]; assignments: Assignment[]; week: number; onOpenRequirements: (item: ScheduleDemand) => void }) {
  const [today] = useState(() => new Date().toLocaleDateString("en-CA"));
  const missing = demand.filter((item) => !item.configured || missingCrewRequirements(item).length > 0);
  const outdated = demand.filter((item) => item.configured && !missingCrewRequirements(item).length && item.date < today && !assignments.some((booking) => booking.week === week && booking.workId === item.workId && booking.packageId === item.packageId && booking.date === item.date && booking.shift === item.shift));
  return <details className="d5o-demand-prerequisites"><summary>Planning prerequisites <strong>{missing.length + outdated.length}</strong></summary>{missing.length || outdated.length ? <div>{missing.map((item) => <article key={`${item.workId}:${item.packageId}`}><div><strong>{item.packageName}</strong><span>{item.workTitle} · Missing: {missingCrewRequirements(item).join(", ")}</span></div><button type="button" onClick={() => onOpenRequirements(item)}>Open Design requirements →</button></article>)}{outdated.map((item) => <article key={`${item.workId}:${item.packageId}:${item.date}`}><div><strong>{item.packageName}</strong><span>{item.workTitle} · Required date {item.date} has passed; revise the Design demand before scheduling.</span></div><button type="button" onClick={() => onOpenRequirements(item)}>Open Design requirements →</button></article>)}</div> : <p>All visible packages have current planning requirements.</p>}</details>;
}
