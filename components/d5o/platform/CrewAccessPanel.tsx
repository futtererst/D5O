"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import styles from "./CrewAccessPanel.module.css";
import type { WorkforcePerson } from "./useWorkforce";
import { WorkforceBookingImpact, type ProposedWorkforce } from "@/components/d5o/admin/WorkforceBookingImpact";

type State = { revision: number; people: WorkforcePerson[] };
export function CrewAccessPanel({ selectedPersonId }: { selectedPersonId?: string }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<WorkforcePerson | null>(null);
  const [creating, setCreating] = useState(false);
  const [futureAssignments, setFutureAssignments] = useState<number | null>(null);
  const [assignmentDates, setAssignmentDates] = useState<string[]>([]);
  const [unavailableDates, setUnavailableDates] = useState<string[]>([]);
  const [pending, setPending] = useState<{ commandId: string; action: string; data: Record<string, unknown>; expectedRevision: number; expectedScheduleRevision: number | null } | null>(null);
  const [retryReady, setRetryReady] = useState(false);
  const [impactBasis, setImpactBasis] = useState<{ personId: string; scheduleRevision: number; workforceRevision: number } | null>(null);
  const [impactRefresh, setImpactRefresh] = useState(0);
  const [proposed, setProposed] = useState<{ personId: string; profileRevision: number; value: ProposedWorkforce } | null>(null);
  const [statusReviewId, setStatusReviewId] = useState<string | null>(null);
  const receiveImpactBasis = useCallback((basis: { personId: string; scheduleRevision: number; workforceRevision: number } | null) => setImpactBasis(basis), []);
  const currentProposal = selected && proposed?.personId === selected.id && proposed.profileRevision === selected.profileRevision
    ? proposed.value : selected ? { active: selected.active, bound: selected.bound,
      qualifications: selected.qualifications, weeklyCapacityHours: selected.weeklyCapacityHours } : undefined;
  const load = useCallback(async () => {
    const response = await fetch("/api/d5o-hosted/workforce?workspace=rybex", { cache: "no-store" });
    const body = await response.json() as State & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Workforce unavailable");
    setState(body);
    setSelected((current) => {
      const personId = selectedPersonId ?? current?.id;
      return personId ? body.people.find((person) => person.id === personId) ?? null : null;
    });
    setImpactRefresh((value) => value + 1);
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
      if (body.found) { await load(); setPending(null); setRetryReady(false); setError("The original change committed; no second command was sent."); }
      else { setRetryReady(true); setError("No receipt exists yet. You may retry the original command with its retained revision and input."); }
    } catch (failure) { setRetryReady(false); setError(failure instanceof Error ? failure.message : "Receipt unavailable"); }
    finally { setBusy(false); }
  }
  async function retryOriginal() {
    if (!pending || !retryReady) return;
    setBusy(true); setRetryReady(false);
    try {
      const check = await fetch(`/api/d5o-hosted/admin-receipt?workspace=rybex&commandId=${encodeURIComponent(pending.commandId)}`, { cache: "no-store" });
      if (!check.ok) throw new Error("Receipt unavailable");
      if ((await check.json() as { found: boolean }).found) {
        await load(); setPending(null); setError("The original change committed; no second command was sent."); return;
      }
      const response = await fetch("/api/d5o-hosted/workforce", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: "rybex", action: pending.action, data: pending.data,
          commandId: pending.commandId, expectedRevision: pending.expectedRevision,
          expectedScheduleRevision: pending.expectedScheduleRevision }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        if (response.status === 503) throw new Error("Retry outcome uncertain");
        setPending(null); await load();
        setError(`${result.error ?? "Workforce change rejected"}. Your input remains available; compare the current revision.`);
        return;
      }
      await load(); setPending(null); setError("The original workforce command was saved once.");
      window.dispatchEvent(new Event("d5o-workforce-updated"));
    } catch {
      try {
        const check = await fetch(`/api/d5o-hosted/admin-receipt?workspace=rybex&commandId=${encodeURIComponent(pending.commandId)}`, { cache: "no-store" });
        if (check.ok && (await check.json() as { found: boolean }).found) {
          await load(); setPending(null); setError("The original change committed despite the lost response; no duplicate was sent.");
        } else setError("The retry outcome remains uncertain. Keep the retained command and check its receipt again.");
      } catch { setError("The retry and receipt checks are unavailable. Keep the retained command before another attempt."); }
    } finally { setBusy(false); }
  }
  async function command(action: string, data: Record<string, unknown>) {
    if (!state) return;
    if (pending) { setError("Resolve the pending command before starting another workforce change."); return; }
    const changesExistingPerson = Boolean(data.id);
    const urgentDeactivation = action === "set-active" && data.active === false;
    if (changesExistingPerson && !urgentDeactivation && (!impactBasis || impactBasis.personId !== data.id || impactBasis.workforceRevision !== state.revision)) {
      setError("Refresh the current Crew impact before saving this workforce change. Your entries remain in the form."); return;
    }
    const current = { commandId: crypto.randomUUID(), action, data, expectedRevision: state.revision,
      expectedScheduleRevision: changesExistingPerson && impactBasis && impactBasis.personId === data.id ? impactBasis.scheduleRevision : null };
    setPending(current); setRetryReady(false);
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/d5o-hosted/workforce", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: "rybex", action, data,
          commandId: current.commandId, expectedRevision: current.expectedRevision,
          expectedScheduleRevision: current.expectedScheduleRevision })
      });
      const result = await response.json() as { error?: string };
      if (!response.ok && response.status !== 503) { setPending(null); await load(); throw new Error(`${result.error ?? "Workforce change rejected"}. Your form remains available; compare the current revision.`); }
      if (!response.ok) throw new Error("Outcome uncertain");
      await load(); setPending(null); setNotice("Workforce change saved. Review current Crew impact before another change.");
      if (action === "save-person" && !changesExistingPerson) setCreating(false);
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
    <div className={styles.heading}><div><h2>{selected ? selected.displayName : creating ? "Add roster person" : "People directory"}</h2><span>{selected ? "Profile, account binding and affected Crew bookings" : "Qualifications, capacity and account binding for fictional roster people."}</span></div>
      {!selectedPersonId && !selected && <button type="button" className={styles.primary} onClick={() => setCreating((value) => !value)}>{creating ? "Close form" : "Add person"}</button>}</div>
    {selectedPersonId && <p><Link href="/work/admin/workforce?workspace=rybex">← All people</Link></p>}
    {error ? <p role="alert" className={styles.message}>{error}</p> : null}
    {notice ? <p role="status" className={styles.message}>{notice}</p> : null}
    {pending ? <p role="status">Command {pending.commandId} is pending. <button type="button" disabled={busy} onClick={() => void reconcile()}>Check receipt</button>{retryReady ? <button type="button" disabled={busy} onClick={() => void retryOriginal()}>Retry original command</button> : null}</p> : null}
    {!state ? <p role="status">Loading committed workforce…</p> : <>
      {!selected && !creating && <div className={styles.list}><div className={styles.listHead}><span>Person</span><span>Status</span><span>Qualifications</span><span>Capacity</span><span>Account</span><span>Details</span></div>{state.people.map((item) => <div key={item.id}>
        <strong data-label="Person">{item.displayName}</strong><span data-label="Status">{item.active ? "Active" : "Inactive"}</span><span data-label="Qualifications">{item.qualifications.join(", ") || "None recorded"}</span><span data-label="Capacity">{item.weeklyCapacityHours}h/week</span>
        <span data-label="Account">{item.bound ? "Bound" : "Unbound"}</span><Link data-label="Details" href={`/work/admin/workforce/${item.id}?workspace=rybex`}>Details →</Link>
      </div>)}{!state.people.length ? <p>No roster people yet. Add a fictional person to begin.</p> : null}</div>}
      {selected && <section className={styles.detail}><h3>Crew booking impact</h3><WorkforceBookingImpact personId={selected.id} proposed={statusReviewId === selected.id && currentProposal
        ? { ...currentProposal, active: !selected.active } : currentProposal} refreshKey={impactRefresh} onBasis={receiveImpactBasis} /></section>}
      {selected && <div className={styles.detail}><h3>Profile and capacity</h3><p>Roster identity: {selected.person} · {selected.active ? "Active" : "Inactive"}. {futureAssignments !== null ? `${futureAssignments} future assignment(s) need review before an access change.` : "Check Crew before changing access."}</p><p>Current assignment dates: {assignmentDates.join(", ") || "none shown"}. Unavailable dates: {unavailableDates.join(", ") || "none shown"}.</p></div>}
      {selected && statusReviewId === selected.id && <p>
        <button type="button" disabled={busy || Boolean(pending) || Boolean(selected.active === false && !impactBasis)}
          onClick={() => {
            if (window.confirm(`${selected.active ? "Deactivate" : "Reactivate"} ${selected.displayName}? Current bookings remain unchanged; Crew must resolve any issue.`))
              void command("set-active", { id: selected.id, active: !selected.active });
          }}>Confirm {selected.active ? "deactivation" : "reactivation"}</button>
        {selected.active && !impactBasis ? " Security deactivation remains available while booking impact is unavailable." : null}
      </p>}
      {(selected || creating) && <form className={styles.form} key={selected ? `profile-${selected.id}` : "new-profile"} onInput={(event) => {
        if (!selected) return;
        const values = new FormData(event.currentTarget);
        setProposed({ personId: selected.id, profileRevision: selected.profileRevision,
          value: { active: selected.active, bound: selected.bound,
            qualifications: String(values.get("qualifications") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
            weeklyCapacityHours: Number(values.get("capacity")) } });
      }} onSubmit={save}>
        <h3>{selected ? "Edit profile and qualifications" : "Create fictional roster person"}</h3>
        <label>Stable roster identity<input name="person" required minLength={2} defaultValue={selected?.person ?? ""} readOnly={Boolean(selected)} placeholder="Fictional worker name" /></label>
        <label>Display name<input name="displayName" required defaultValue={selected?.displayName ?? ""} /></label>
        <label>Qualifications, comma separated<input name="qualifications" required defaultValue={selected?.qualifications.join(", ") ?? ""} /></label>
        <label>Weekly capacity (hours)<input name="capacity" required type="number" min="1" max="80" step="0.5" defaultValue={selected?.weeklyCapacityHours ?? 40} /></label>
        <button className="d5o-primary" disabled={busy || Boolean(pending) || Boolean(selected && !impactBasis)}>{selected ? "Save person" : "Add person"}</button>
        {selected && !selectedPersonId ? <button type="button" onClick={() => setSelected(null)}>Close details</button> : null}
      </form>}
      {selected?.bound && <form className={styles.form} onSubmit={(event) => {
        event.preventDefault(); const values = new FormData(event.currentTarget);
        if (window.confirm(`Correct the current binding for ${selected.displayName}? Earlier reports and evidence stay with the original account.`))
          void command("correct-binding", { id: selected.id, email: String(values.get("email") ?? "").trim(), reason: String(values.get("reason") ?? "").trim() });
      }}><h3>Correct account binding</h3>
        <p>Current account: {selected.email ?? selected.workerUserId}. Published or draft future bookings must be corrected in Crew first. No old report, evidence or booking is transferred.</p>
        <label>Replacement confirmed account<input name="email" type="email" required autoComplete="off" /></label>
        <label>Correction reason<input name="reason" minLength={12} maxLength={500} required /></label>
        <button disabled={busy || Boolean(pending) || (futureAssignments ?? 0) > 0}>Correct binding</button>
        <Link href={`/work/admin/audit?workspace=rybex&subject=${selected.id}`}>View change history →</Link>
      </form>}
      {selected?.active && !selected.bound &&
        <form className={styles.form} key={`binding-${selected.id}`} onSubmit={(event) => {
          event.preventDefault(); const data = new FormData(event.currentTarget);
          void command("bind-person", { id: selected.id, email: String(data.get("email") ?? "").trim() });
        }}><h3>Bind {selected.displayName} to an account</h3><p>Choose an existing confirmed sign-in account. This grants only field-worker access; it does not create an account or authorize business reviews.</p><label>Confirmed sign-in email<input name="email" type="email" required autoComplete="off" /></label><button disabled={busy || Boolean(pending)}>Bind account</button></form>}
      {selected && <div className={styles.detail}><h3>Access and history</h3><Link href={`/work/admin/audit?workspace=rybex&subject=${selected.id}`}>View change history →</Link><p><button type="button" disabled={busy || Boolean(pending)} onClick={() => setStatusReviewId(selected.id)}>Review {selected.active ? "deactivation" : "reactivation"}</button></p></div>}
    </>}
  </section>;
}
