"use client";

import { useState, type FormEvent } from "react";
import { dateKeyForSchedule, weekdays, type Assignment, type AvailabilityBlock, type PersonProfile } from "./schedule-model";

export function AvailabilityEditor({ profiles, blocks, assignments, weekIndex, anchorDate, onChange, canEdit = true, initialPerson = "", initialDay = 0 }: {
  profiles: PersonProfile[];
  blocks: AvailabilityBlock[];
  assignments: Assignment[];
  weekIndex: number;
  anchorDate: string;
  onChange: (blocks: AvailabilityBlock[]) => Promise<void>;
  canEdit?: boolean;
  initialPerson?: string;
  initialDay?: number;
}) {
  const [person, setPerson] = useState(initialPerson);
  const [day, setDay] = useState(initialDay);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const current = blocks.filter((block) => block.week === weekIndex);
  const affected = assignments.filter((assignment) => assignment.week === weekIndex && assignment.day === day && assignment.people.includes(person));

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const explanation = reason.trim() || "Unavailable";
    if (!person) { setMessage("Choose a person."); return; }
    if (current.some((block) => block.person === person && block.day === day)) {
      setMessage(`${person} is already marked unavailable on ${weekdays[day]}.`);
      return;
    }
    const id = `availability-${crypto.randomUUID()}`;
    try { await onChange([...blocks, { id, person, week: weekIndex, day, date: dateKeyForSchedule(anchorDate, weekIndex, day), reason: explanation }]); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Availability save failed."); return; }
    setMessage(`${person} marked unavailable on ${weekdays[day]}.${affected.length ? ` ${affected.length} existing assignment${affected.length === 1 ? "" : "s"} now need resolution on the crew schedule.` : ""}`);
    setReason("");
  }

  return <section className="d5o-availability-editor" aria-label="Availability plan">
    <header><div><p>AVAILABILITY PLAN · THIS WEEK</p><h2>{canEdit ? "Record scheduling unavailability" : "Recorded absences"}</h2><span>Unavailability blocks new bookings and flags existing assignments for scheduler review. Do not enter medical or personal details.</span></div><strong>{current.length} unavailable day{current.length === 1 ? "" : "s"}</strong></header>
    {canEdit ? <form onSubmit={add}>
      <label>Person<select value={person} onChange={(event) => setPerson(event.target.value)} required><option value="">Choose a person</option>{profiles.map((profile) => <option key={profile.name} value={profile.name}>{profile.displayName ?? profile.name}</option>)}</select></label>
      <label>Day<select value={day} onChange={(event) => setDay(Number(event.target.value))}>{weekdays.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label>
      <label>Operational note (optional)<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={140} placeholder="Unavailable for this day" /></label>
      <button className="d5o-primary">Mark unavailable</button>
    </form> : null}
    {canEdit && person && affected.length ? <p className="d5o-availability-warning">If marked unavailable, {affected.length} existing assignment{affected.length === 1 ? "" : "s"} for {person} on {weekdays[day]} will need rescheduling.</p> : null}
    {canEdit && message ? <p className="d5o-crew-message" role="status">{message}</p> : null}
    <ul>{current.map((block) => <li key={block.id}><span><strong>{block.person}</strong> · {weekdays[block.day]} · {block.reason}</span>{canEdit ? <button type="button" aria-label={`Remove ${block.person} unavailability on ${weekdays[block.day]}`} onClick={() => { onChange(blocks.filter((item) => item.id !== block.id)).then(() => setMessage(`${block.person} availability restored for ${weekdays[block.day]}.`)).catch((error) => setMessage(error instanceof Error ? error.message : "Availability save failed.")); }}>Remove</button> : null}</li>)}</ul>
  </section>;
}
