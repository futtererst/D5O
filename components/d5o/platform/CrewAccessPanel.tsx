"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import styles from "./CrewAccessPanel.module.css";
import type { WorkforcePerson } from "./useWorkforce";

type State = { revision: number; people: WorkforcePerson[] };
export function CrewAccessPanel({ selectedPersonId }: { selectedPersonId?: string }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<WorkforcePerson | null>(null);
  const [futureAssignments, setFutureAssignments] = useState<number | null>(null);
  const [assignmentDates, setAssignmentDates] = useState<string[]>([]);
  const [unavailableDates, setUnavailableDates] = useState<string[]>([]);
  const [pending, setPending] = useState<{ commandId: string; action: string; data: Record<string, unknown>; expectedRevision: number } | null>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/d5o-hosted/workforce?workspace=rybex", { cache: "no-store" });
    const body = await response.json() as State & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Workforce unavailable");
    setState(body);
    if (selectedPersonId) setSelected(body.people.find((person) => person.id === selectedPersonId) ?? null);
  }, [selectedPersonId]);
  useEffect(() => { void Promise.resolve().then(load).catch((failure) => setError(failure instanceof Error ? failure.message : "Workforce unavailable")); }, [load]);
  useEffect(() => {
    if (!selected?.workerUserId) { const timer = window.setTimeout(() => setFutureAssignments(null), 0); return () => window.clearTimeout(timer); }
    let active = true;
    void fetch(`/api/d5o-hosted/admin-directory?workspace=rybex&userId=${encodeURIComponent(selected.workerUserId)}`, { cache: "no-store" })
      .then((response) => response.json()).then((body: { items?: Array<{ futureAssignments: number }> }) => {
        if (active) setFutureAssignments(body.items?.[0]?.futureAssignments ?? null);
      }).catch(() => { if (active) setFutureAssignments(null); });
    return () => { active = false; };
  }, [selected?.workerUserId]);
  useEffect(() => {
    if (!selected?.person) return;
    let active = true;
    void fetch("/api/d5o-hosted/prototype-schedule?workspace=rybex", { cache: "no-store" })
      .then((response) => response.json()).then((body: { schedule?: { assignments?: Array<{ date?: string; people?: string[] }>; availabilityBlocks?: Array<{ date?: string; person?: string }> } }) => {
        if (!active) return;
        setAssignmentDates((body.schedule?.assignments ?? []).filter((item) => item.people?.includes(selected.person)).map((item) => item.date ?? "undated").slice(0, 10));
        setUnavailableDates((body.schedule?.availabilityBlocks ?? []).filter((item) => item.person === selected.person).map((item) => item.date ?? "recorded shift").slice(0, 10));
      }).catch(() => { if (active) { setAssignmentDates([]); setUnavailableDates([]); } });
    return () => { active = false; };
  }, [selected?.person]);
  async function reconcile() {
    if (!pending) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/d5o-hosted/admin-receipt?workspace=rybex&commandId=${encodeURIComponent(pending.commandId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Receipt check failed. Keep the current form and command identity.");
      const body = await response.json() as { found: boolean };
      if (body.found) { await load(); setPending(null); setError("The original change committed; no second command was sent."); }
      else setError("No receipt yet. Outcome remains uncertain; check again before retrying the same command.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Receipt unavailable"); }
    finally { setBusy(false); }
  }
  async function command(action: string, data: Record<string, unknown>) {
    if (!state) return;
    if (pending) { setError("Resolve the pending command before starting another workforce change."); return; }
    const current = { commandId: crypto.randomUUID(), action, data, expectedRevision: state.revision };
    setPending(current);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/d5o-hosted/workforce", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: "rybex", action, data,
          commandId: current.commandId, expectedRevision: current.expectedRevision })
      });
      const result = await response.json() as { error?: string };
      if (!response.ok && response.status !== 503) { setPending(null); await load(); throw new Error(`${result.error ?? "Workforce change rejected"}. Your form remains available; compare the current revision.`); }
      if (!response.ok) throw new Error("Outcome uncertain");
      await load(); setPending(null); setSelected(null);
      window.dispatchEvent(new Event("d5o-workforce-updated"));
    } catch (failure) {
      if (pending === null) {
        try {
          const response = await fetch(`/api/d5o-hosted/admin-receipt?workspace=rybex&commandId=${encodeURIComponent(current.commandId)}`, { cache: "no-store" });
          const receipt = await response.json() as { found?: boolean };
          if (response.ok && receipt.found) { await load(); setPending(null); setError("Change committed despite the lost response; no duplicate was sent."); return; }
        } catch { /* Retain the original command for explicit reconciliation. */ }
      }
      setError(failure instanceof Error ? failure.message : "Workforce outcome uncertain. Reconcile the command before retrying.");
    }
    finally { setBusy(false); }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const person = String(values.get("person") ?? "").trim();
    const displayName = String(values.get("displayName") ?? "").trim();
    const qualifications = String(values.get("qualifications") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    void command("save-person", { ...(selected ? { id: selected.id } : {}),
      person, displayName, qualifications, weeklyCapacityHours: Number(values.get("capacity")), active: selected?.active ?? true });
  }
  return <section className={styles.panel} aria-label="Workforce administration">
    <div className={styles.heading}><div><p>WORKFORCE · SYSTEM ADMINISTRATOR</p><h2>People and qualifications</h2><span>Create a fictional roster person, record skills and weekly capacity, then connect an existing confirmed account. Only active, qualified, bound people can be booked. Account creation remains in the isolated Auth administrator flow.</span></div></div>
    {error ? <p role="alert" className={styles.message}>{error}</p> : null}
    {pending ? <p role="status">Command {pending.commandId} is pending. <button type="button" disabled={busy} onClick={() => void reconcile()}>Check receipt</button></p> : null}
    {!state ? <p role="status">Loading committed workforce…</p> : <>
      <div className={styles.list}>{state.people.map((item) => <div key={item.id}>
        <strong>{item.displayName}</strong><span>{item.qualifications.join(" · ")} · {item.weeklyCapacityHours}h/week</span>
        <small>{!item.active ? "Inactive" : item.bound ? `Account bound: ${item.email ?? item.workerUserId ?? "confirmed"}` : "Unbound — planning only"}</small>
        <button type="button" disabled={busy} onClick={() => setSelected(item)}>Edit</button>
        <Link href={`/work/admin/workforce/${item.id}?workspace=rybex`}>Person details</Link>
        <button type="button" disabled={busy || Boolean(pending)} onClick={() => { setSelected(item);
          if (window.confirm(`${item.active ? "Deactivate" : "Reactivate"} ${item.displayName}? Review future assignments in Crew. Historical records will remain.`)) void command("set-active", { id: item.id, active: !item.active }); }}>{item.active ? "Deactivate" : "Reactivate"}</button>
      </div>)}{!state.people.length ? <p>No committed workforce records yet.</p> : null}</div>
      <form className={styles.form} key={selected?.id ?? "new"} onSubmit={save}>
        {selected && <p>Roster ID {selected.id} · revision {selected.profileRevision} · {selected.bound ? "account-bound" : "planning only"}.
          {futureAssignments !== null ? ` ${futureAssignments} future assignment(s) require review before an access change.` : " Review Crew for assignment impact."}</p>}
        {selected && <p>Current assignment dates: {assignmentDates.join(", ") || "none shown"}. Unavailable dates: {unavailableDates.join(", ") || "none shown"}. Detailed booking amendments remain in Crew.</p>}
        <label>Stable roster identity<input name="person" required minLength={2} defaultValue={selected?.person ?? ""} readOnly={Boolean(selected)} placeholder="Fictional worker name" /></label>
        <label>Display name<input name="displayName" required defaultValue={selected?.displayName ?? ""} /></label>
        <label>Qualifications, comma separated<input name="qualifications" required defaultValue={selected?.qualifications.join(", ") ?? ""} /></label>
        <label>Weekly capacity (hours)<input name="capacity" required type="number" min="1" max="80" step="0.5" defaultValue={selected?.weeklyCapacityHours ?? 40} /></label>
        <button className="d5o-primary" disabled={busy || Boolean(pending)}>{selected ? "Save person" : "Add person"}</button>
        {selected ? <button type="button" onClick={() => setSelected(null)}>Cancel</button> : null}
      </form>
      {selected?.bound && <form className={styles.form} onSubmit={(event) => {
        event.preventDefault(); const values = new FormData(event.currentTarget);
        if (window.confirm(`Correct the current binding for ${selected.displayName}? Earlier reports and evidence stay with the original account.`))
          void command("correct-binding", { id: selected.id, email: String(values.get("email") ?? "").trim(), reason: String(values.get("reason") ?? "").trim() });
      }}><strong>Correct an incorrect account binding</strong>
        <p>Current account: {selected.email ?? selected.workerUserId}. Published or draft future bookings must be corrected in Crew first. No old report, evidence or booking is transferred.</p>
        <label>Replacement confirmed account<input name="email" type="email" required autoComplete="off" /></label>
        <label>Correction reason<input name="reason" minLength={12} maxLength={500} required /></label>
        <button disabled={busy || Boolean(pending) || (futureAssignments ?? 0) > 0}>Correct binding</button>
        <Link href={`/work/admin/audit?workspace=rybex&subject=${selected.id}`}>View change history →</Link>
      </form>}
      {state.people.filter((item) => item.active && !item.bound).map((item) =>
        <form className={styles.form} key={item.id} onSubmit={(event) => {
          event.preventDefault(); const data = new FormData(event.currentTarget);
          void command("bind-person", { id: item.id, email: String(data.get("email") ?? "").trim() });
        }}><strong>Connect {item.displayName}</strong><label>Existing confirmed sign-in email<input name="email" type="email" required autoComplete="off" /></label><button disabled={busy}>Bind account</button></form>)}
      <p className={styles.note}>These fictional workforce records are scoped to the isolated Rybex workspace. A binding grants only field-worker access; it does not authorize releases, reviews or Finance decisions.</p>
    </>}
  </section>;
}
