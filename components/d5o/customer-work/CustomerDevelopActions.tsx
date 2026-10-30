"use client";
import { useCallback, useEffect, useState } from "react";
import { personHoursForShift } from "@/lib/d5o/hosted/booking-hours";
import { currentCrewBooking } from "@/lib/d5o/hosted/current-crew-booking";

type Demand = { qualification?: string; minimumPeople?: number; estimatedPersonHours?: number;
  requiredSlots?: Array<{ date: string; shift: string }> };
type Release = { id?: string; packageId?: string; status?: string; crewDemandSnapshot?: Demand };
type Work = { id: string; design?: { authorityRevision?: number; releases?: Release[] };
  deploy?: { authorityRevision?: number; permits?: Array<{ packageId?: string; releaseId?: string;
    status?: string }> } };
type Assignment = { id: string; workId: string; packageId: string; week: number; day: number;
  date: string; shift: string; people: string[] };
type Publication = { id: string; week: number; assignments: Assignment[] };
type Schedule = { revision: number; state: { anchorDate?: string; assignments?: Assignment[];
  availabilityBlocks?: Array<{ person: string; date: string }>;
  publications?: Publication[]; receipts?: Array<{ assignmentId: string; publicationId: string;
    response?: string }> } };
type Person = { person: string; displayName: string; qualifications: string[];
  qualificationExpiresOn?: Record<string, string>;
  weeklyCapacityHours: number; active: boolean; bound: boolean };
type Snapshot = { sourceRevision: number; role: string; work: Work;
  schedule: Schedule; workforce: { people: Person[] } };

function weekDay(anchor: string, date: string) {
  const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86400000);
  return { week: Math.floor(diff / 7), day: diff % 7 };
}
export function CustomerDevelopActions({ workspace, workId, role, onChanged }: {
  workspace: string; workId: string; role: string; onChanged: () => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [people, setPeople] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/d5o-hosted/customer-develop-action?workspace=${encodeURIComponent(workspace)}&workId=${encodeURIComponent(workId)}`,
      { cache: "no-store" });
    const data = await response.json() as Snapshot & { error?: string };
    if (!response.ok) throw Error(data.error ?? "Develop state unavailable");
    setSnapshot(data);
  }, [workspace, workId]);
  useEffect(() => { let active = true;
    const frame = requestAnimationFrame(() => {
      void refresh().catch((cause) => { if (active) setError(String(cause)); });
    });
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [refresh]);
  const release = snapshot?.work.design?.releases?.find((item) => item.status === "Accepted");
  const demand = release?.crewDemandSnapshot;
  const slot = demand?.requiredSlots?.[0];
  const bookingHours = personHoursForShift(slot?.shift ?? "");
  const nextDate = slot ? new Date(Date.parse(`${slot.date}T00:00:00Z`) + 86400000)
    .toISOString().slice(0, 10) : "";
  const overnight = Boolean(slot?.shift && /^\d\d:\d\d[–-]\d\d:\d\d$/.test(slot.shift)
    && slot.shift.split(/[–-]/)[1] <= slot.shift.split(/[–-]/)[0]);
  const unavailable = (person: string) => (snapshot?.schedule.state.availabilityBlocks ?? [])
    .some((block) => block.person === person && (block.date === slot?.date
      || overnight && block.date === nextDate));
  const qualified = (snapshot?.workforce.people ?? []).filter((item) =>
    item.active && item.bound && item.qualifications.includes(demand?.qualification ?? "")
    && (!item.qualificationExpiresOn?.[demand?.qualification ?? ""]
      || item.qualificationExpiresOn[demand?.qualification ?? ""] >= (overnight ? nextDate : slot?.date ?? ""))
    && !(snapshot?.schedule.state.availabilityBlocks ?? []).some((block) =>
      block.person === item.person && (block.date === slot?.date
        || overnight && block.date === nextDate))
    && bookingHours > 0 && item.weeklyCapacityHours >= bookingHours);
  const bookingState = currentCrewBooking(snapshot?.schedule.state.assignments ?? [],
    snapshot?.schedule.state.publications ?? [], workId, release?.packageId ?? "", slot);
  const booking = bookingState.current;
  const published = bookingState.published;
  const priorBooking = bookingState.prior;
  const priorPublication = bookingState.activePriorPublication;
  const withdrawPriorWeek = Boolean(booking && priorPublication
    && priorPublication.week !== booking.week);
  const acknowledged = (snapshot?.schedule.state.receipts ?? []).some((item) =>
    item.assignmentId === booking?.id && item.publicationId === published?.id
      && item.response === "acknowledged");
  const permitted = snapshot?.work.deploy?.permits?.some((item) =>
    item.packageId === release?.packageId && item.releaseId === release?.id
      && item.status === "Authorized") ?? false;
  async function act(action: "save-booking" | "publish-week" | "cancel-draft-booking" | "authorize-start",
    weekOverride?: number) {
    if (!snapshot || !release?.packageId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const day = slot && snapshot.schedule.state.anchorDate
        ? weekDay(snapshot.schedule.state.anchorDate, slot.date) : null;
      const chosen = qualified.filter((item) => people.includes(item.person));
      if (action === "save-booking" && (!slot || !day || bookingHours <= 0 || bookingHours > 24
        || chosen.length < (demand?.minimumPeople ?? 1)
        || day.day < 0 || day.day > 4))
        throw Error("Choose enough qualified workers for the weekday demand slot.");
      const payload = { workId, packageId: release.packageId, action,
        commandId: crypto.randomUUID(), expectedRevision: snapshot.schedule.revision,
        ...(action === "save-booking" ? { assignment: {
          id: priorBooking?.id ?? `booking-${crypto.randomUUID()}`,
          crew: `Assigned ${chosen.map((item) => item.displayName).join(", ")}`,
          people: chosen.map((item) => item.person), workId, packageId: release.packageId,
          week: day?.week, day: day?.day, date: slot?.date, shift: slot?.shift,
          personHoursPerWorker: bookingHours } } : {}),
        ...(action === "publish-week" ? { week: weekOverride ?? booking?.week } : {}),
        ...(action === "cancel-draft-booking" ? { assignmentId: booking?.id } : {}),
        ...(action === "authorize-start" ? { reason: reason.trim(),
          sourceRevision: snapshot.sourceRevision,
          designRevision: snapshot.work.design?.authorityRevision ?? 0,
          scheduleRevision: snapshot.schedule.revision,
          deployRevision: snapshot.work.deploy?.authorityRevision ?? 0 } : {}) };
      const response = await fetch(`/api/d5o-hosted/customer-develop-action?workspace=${encodeURIComponent(workspace)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw Error(result.error ?? "Develop command failed");
      await Promise.all([refresh(), onChanged()]);
      setMessage(`${action.replaceAll("-", " ")} recorded by the authoritative command.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Develop command failed"); }
    finally { setBusy(false); }
  }
  if (!snapshot) return <div className="d5o-customer-design-actions"><h4>Develop actions</h4>
    <p>{error || "Loading current workforce and schedule…"}</p></div>;
  return <div className="d5o-customer-design-actions"><h4>Develop actions</h4>
    <p>Early solution approval is preparation. Develop completes only after the accepted package has a qualified, acknowledged booking and an authorized field start.</p>
    {!release ? <p role="status">An accepted Design package is required before scheduling.</p> : <>
      <p>Package: {release.packageId} · Required capability: {demand?.qualification ?? "not recorded"}
        {slot ? ` · ${slot.date} ${slot.shift}` : ""}</p>
      <section><h5>Workforce readiness</h5>
        {(snapshot.workforce.people ?? []).length ? <ul>{snapshot.workforce.people.map((item) =>
          <li key={item.person}>{item.displayName} · {item.qualifications.join(", ") || "No qualification"} ·
            {item.weeklyCapacityHours} hours/week capacity · {unavailable(item.person)
              ? "unavailable for requested shift" : "no recorded absence for requested shift"} ·
            {qualified.some((candidate) => candidate.person === item.person) ? "eligible" : "not eligible"}</li>)}</ul>
          : <p role="status">No active, bound resource meets this package demand. An administrator must correct the workforce profile.</p>}
        <p>Availability, overlap and remaining capacity are checked again by the scheduling command.</p>
      </section>
      {["admin", "project_manager", "operations_leader"].includes(role) && !booking &&
        <form onSubmit={(event) => { event.preventDefault(); void act("save-booking"); }}>
          <h5>Assign qualified resources</h5><label>Eligible workers · choose at least {demand?.minimumPeople ?? 1}
            <select multiple value={people} size={Math.min(6, Math.max(2, qualified.length))}
              onChange={(event) => setPeople(Array.from(event.target.selectedOptions,
                (option) => option.value))} required>
              {qualified.map((item) => <option key={item.person} value={item.person}>{item.displayName}</option>)}
            </select></label>
          <button disabled={busy || people.length < (demand?.minimumPeople ?? 1)}>{priorBooking
            ? "Save corrected crew booking" : "Save crew booking"}</button>
        </form>}
      {priorBooking && !booking && <p role="status">The earlier {priorBooking.date} booking is historical after the Design schedule correction. Assign crew for the accepted {slot?.date} shift.</p>}
      {booking && <section><h5>Booking</h5><p>{booking.people.join(", ")} · {booking.date} {booking.shift} ·
        {published ? acknowledged ? " acknowledged by worker" : " awaiting worker response" : " draft"}</p>
        {["admin", "project_manager", "operations_leader"].includes(role) && withdrawPriorWeek &&
          <button disabled={busy} onClick={() => void act("publish-week", priorPublication?.week)}>
            Withdraw superseded crew week</button>}
        {["admin", "project_manager", "operations_leader"].includes(role) && !published && !withdrawPriorWeek &&
          <><button disabled={busy} onClick={() => void act("publish-week")}>Publish crew week</button>
            <button disabled={busy} onClick={() => void act("cancel-draft-booking")}>Withdraw draft booking</button></>}
      </section>}
      {permitted && <p role="status">Field start authorized. Develop is complete; the assigned employee can proceed to Deploy.</p>}
      {role === "operations_leader" && published && acknowledged && !permitted && <form
        onSubmit={(event) => { event.preventDefault();
          if (window.confirm("Authorize field start for this accepted package and published crew?"))
            void act("authorize-start"); }}>
        <h5>Execution authorization</h5><p>The command checks the current accepted release, crew publication,
          acknowledgment, commercial authority, and live shift before issuing a permit.</p>
        <label>Authorization reason<textarea value={reason} onChange={(event) => setReason(event.target.value)}
          minLength={15} required /></label>
        <button disabled={busy || reason.trim().length < 15}>Authorize field start</button>
      </form>}
    </>}
    {error && <p role="alert" className="d5o-customer-work-error">{error}</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
