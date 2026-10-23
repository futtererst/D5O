"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { D5OProductHeader } from "@/components/d5o/platform/D5OProductHeader";
import type { CrewReceipt, WorkspaceKey } from "@/components/d5o/platform/schedule-model";
import { bookingLocalDate, bookingShiftEnded } from "./booking-position";
import type { WorkerPackageProgress } from "@/lib/d5o/prototype-work/deploy-worker-projection";

type Booking = { publicationId: string; publishedAt: string; assignmentId: string; crew: string; date?: string; shift: string; timeZone?: string; workTitle: string; site: string; packageName: string; workId: string; packageId: string; progress?: WorkerPackageProgress; response: CrewReceipt | null };
type CrewView = { workspace: WorkspaceKey; person: string; revision: number; bookings: Booking[] };

function assignedWorkHref(booking: Booking) {
  return `/work/my-schedule/field?booking=${encodeURIComponent(booking.assignmentId)}&publication=${encodeURIComponent(booking.publicationId)}`;
}

export function CrewScheduleView({ workspace, person, hosted = false }: { workspace: WorkspaceKey; person: string; hosted?: boolean }) {
  const api = hosted ? "/api/d5o-hosted/worker-schedule" : "/api/work/my-schedule";
  const [view, setView] = useState<CrewView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ booking: Booking; response: "acknowledged" | "cannot-attend" } | null>(null);
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch(api, { cache: "no-store" });
    if (!response.ok) throw new Error("Your shared bookings could not be loaded. Sign in again or contact the scheduler.");
    const data = await response.json() as CrewView;
    if (data.workspace !== workspace || data.person !== person) throw new Error("Your crew identity changed. Sign in again.");
    setView(data); setError("");
    return data;
  }, [workspace, person, api]);
  useEffect(() => { const frame = requestAnimationFrame(() => { void refresh().catch((failure) => setError(failure instanceof Error ? failure.message : "Schedule unavailable.")); }); return () => cancelAnimationFrame(frame); }, [refresh]);
  useEffect(() => {
    const update = () => { if (document.visibilityState === "visible" && !pending && !busy) void refresh().catch((failure) => setError(failure instanceof Error ? failure.message : "Schedule unavailable.")); };
    const timer = window.setInterval(update, 15000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, [refresh, pending, busy]);

  async function respond() {
    if (!view || !pending) return;
    if (bookingShiftEnded(pending.booking.date, pending.booking.shift, new Date(), pending.booking.timeZone)) {
      setPending(null); setError("This shift has passed. Ask the scheduler to reconcile its attendance record."); return;
    }
    setBusy(true); setMessage("");
    try {
      let commandId = crypto.randomUUID();
      const submit = async (expectedRevision: number) => {
        const response = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision, publicationId: pending.booking.publicationId,
            assignmentId: pending.booking.assignmentId, response: pending.response, commandId }) });
        return { response, data: await response.json() as CrewView & { error?: string; message?: string } };
      };
      let { response, data } = await submit(view.revision);
      if (response.status === 409) {
        commandId = crypto.randomUUID();
        const latest = await refresh();
        const booking = latest.bookings.find((item) => item.publicationId === pending.booking.publicationId && item.assignmentId === pending.booking.assignmentId);
        if (!booking) { setPending(null); throw new Error("This booking changed. Review the latest date, shift and crew before responding."); }
        if (booking.response) { setPending(null); setMessage("Your current booking already has a recorded response."); return; }
        ({ response, data } = await submit(latest.revision));
      }
      if (!response.ok) throw new Error(data.message ?? "Your response could not be saved. Refresh and try again.");
      setView(data); setPending(null);
      setMessage(pending.response === "acknowledged" ? "Booking accepted and recorded. Open your assigned work below to review instructions and report field activity. Your scheduler can see your response."
        : "You declined this booking. Your scheduler can see the issue and revise the plan.");
    } catch (failure) { const explanation = failure instanceof Error ? failure.message : "Response failed."; await refresh().catch(() => undefined); setError(explanation); }
    finally { setBusy(false); }
  }

  const bookings = view?.bookings ?? [];
  const now = new Date();
  const pastWithoutResponse = bookings.filter((booking) => !booking.response && bookingShiftEnded(booking.date, booking.shift, now, booking.timeZone)).length;
  const awaiting = bookings.filter((booking) => !booking.response && !bookingShiftEnded(booking.date, booking.shift, now, booking.timeZone)).length;
  const cannotAttend = bookings.filter((booking) => booking.response?.response === "cannot-attend").length;
  const todayFor = (booking: Booking) => bookingLocalDate(now, booking.timeZone);
  const nextBooking = bookings.filter((booking) => booking.date && booking.date >= todayFor(booking) && !bookingShiftEnded(booking.date, booking.shift, now, booking.timeZone)).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
  const todayCount = bookings.filter((booking) => booking.date === todayFor(booking)).length;
  return <main className={`d5o-crew-self d5o-crew-self-${workspace}`}>
    <D5OProductHeader workspace={workspace} homeHref={`/work/my-schedule?workspace=${workspace}`} area="My schedule" hostedPreview={hosted} />
    <div className="d5o-crew-self-content"><nav className="d5o-crew-self-nav" aria-label="Worker navigation"><span aria-current="page">My schedule</span>{bookings.length ? <a href="#assigned-bookings">My assigned work</a> : null}</nav><div className="d5o-crew-self-intro"><p className="d5o-crew-self-kicker">MY CREW SCHEDULE · {workspace.toUpperCase()}</p><h1>My schedule and assigned work</h1><p>{person}, review each shared booking and respond. Open its assigned work to read current instructions, report an issue, or record activity when authorized. Your response does not authorize a field start.</p><div className="d5o-crew-self-actions"><button onClick={() => void refresh().catch((failure) => setError(failure instanceof Error ? failure.message : "Refresh failed."))}>Refresh schedule</button><span>{awaiting} awaiting your response{pastWithoutResponse ? ` · ${pastWithoutResponse} past shift${pastWithoutResponse === 1 ? "" : "s"} without a response` : ""}{cannotAttend ? ` · ${cannotAttend} attendance issue${cannotAttend === 1 ? "" : "s"}` : ""}</span></div></div>
      {awaiting > 0 ? <section className="d5o-crew-self-notice" role="status"><strong>{awaiting} shared booking{awaiting === 1 ? "" : "s"} need your response</strong><span>Review the date, shift, site and package below, then accept or decline each booking. Your scheduler will see your response.</span></section> : null}
      {view ? <section className="d5o-crew-self-notice" aria-label="Next assignment"><strong>{todayCount ? `${todayCount} assignment${todayCount === 1 ? "" : "s"} dated today` : "No assignment dated today"}</strong><span>{nextBooking ? <>Next scheduled: {nextBooking.date} · {nextBooking.shift}{nextBooking.timeZone ? ` (${nextBooking.timeZone})` : ""} · {nextBooking.site} · {nextBooking.packageName}. {nextBooking.response ? "Open its issued instructions and reporting page." : "Review and respond to the booking before attending."} <Link href={assignedWorkHref(nextBooking)}>Open assignment →</Link></> : "Your scheduler has not published an upcoming assignment. Past bookings remain below for history."}</span></section> : null}
      {error ? <p className="d5o-crew-self-alert" role="alert">{error}</p> : null}
      {message ? <p className="d5o-crew-self-success" role="status">{message}</p> : null}
      {!view ? <section className="d5o-crew-self-empty">Loading your schedule…</section> : !bookings.length ? <section className="d5o-crew-self-empty"><h2>No crew bookings yet</h2><p>A booking appears here after your scheduler publishes it. A booking does not itself authorize work release.</p></section> : <section id="assigned-bookings" className="d5o-crew-self-list" aria-label="Shared crew bookings">{bookings.map((booking) => <article key={`${booking.publicationId}:${booking.assignmentId}`} className={booking.response?.response === "cannot-attend" ? "has-issue" : ""}><div className="d5o-crew-self-date"><strong>{booking.date ? new Date(`${booking.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" }) : "Day"}</strong><span>{booking.date ?? "Date unavailable"}</span></div><div className="d5o-crew-self-booking"><span className="d5o-crew-self-label">SHARED BOOKING</span><h2>{booking.workTitle}</h2><p>{booking.packageName} · {booking.crew}</p>{booking.progress?.plannedQuantity !== null && booking.progress?.plannedQuantity !== undefined && booking.progress.unit ? <p className="d5o-crew-self-progress">Issued {booking.progress.plannedQuantity} {booking.progress.unit} · Reviewed {booking.progress.reviewedQuantity ?? 0} {booking.progress.unit} · Remaining {booking.progress.remainingQuantity ?? booking.progress.plannedQuantity} {booking.progress.unit}</p> : null}<p>{booking.site} · {booking.shift}{booking.timeZone ? ` (${booking.timeZone})` : ""}</p><small>Shared {new Date(booking.publishedAt).toLocaleString()}</small></div><div className="d5o-crew-self-response">{booking.response ? <><strong>{booking.response.response === "cannot-attend" ? "Declined — scheduler review" : booking.response.source === "carried" ? "Your earlier acceptance still applies" : booking.response.source === "self" ? "Accepted by you" : "Historical coordinator receipt"}</strong><small>{new Date(booking.response.recordedAt).toLocaleString()} · {booking.response.recordedBy.name}</small>{booking.response.response === "acknowledged" ? <><Link className="d5o-crew-self-work-link is-primary" href={assignedWorkHref(booking)}>Open assigned work →</Link><small>Review instructions, report activity, add evidence or raise an issue.</small></> : <small>Your scheduler must resolve this booking before you attend.</small>}</> : bookingShiftEnded(booking.date, booking.shift, now, booking.timeZone) ? <><strong>Past published shift — no response recorded</strong><Link className="d5o-crew-self-work-link" href={assignedWorkHref(booking)}>Review assigned package →</Link><small>Ask the scheduler to reconcile attendance. A late acknowledgment would not authorize past work.</small></> : <><strong>Response needed</strong><Link className="d5o-crew-self-work-link" href={assignedWorkHref(booking)}>Review assigned package →</Link><button className="is-primary" onClick={() => setPending({ booking, response: "acknowledged" })}>Accept booking</button><button onClick={() => setPending({ booking, response: "cannot-attend" })}>Decline booking</button></>}</div></article>)}</section>}
      <p className="d5o-crew-self-boundary">A schedule booking or acknowledgement does not authorize work release. Check the work package, site access, safety and readiness conditions before execution.</p>
    </div>
    {pending ? <div className="d5o-crew-self-overlay" role="presentation"><section role="dialog" aria-modal="true" aria-label="Confirm schedule response"><span className="d5o-crew-self-label">CONFIRM YOUR RESPONSE</span><h2>{pending.response === "acknowledged" ? "Accept this booking?" : "Decline this booking?"}</h2><p>{pending.booking.crew} · {pending.booking.date} · {pending.booking.shift}</p><p>Your signed-in identity and the exact published revision will be recorded. Your scheduler will see this response. It does not release the work package.</p><div><button onClick={() => setPending(null)} disabled={busy}>Cancel</button><button className="is-primary" disabled={busy} onClick={() => void respond()}>{busy ? "Recording…" : "Confirm response"}</button></div></section></div> : null}
  </main>;
}
