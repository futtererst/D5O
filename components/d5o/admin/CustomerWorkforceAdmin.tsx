"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Person = { id: string; person: string; displayName: string; qualifications: string[];
  weeklyCapacityHours: number; active: boolean; bound: boolean; profileRevision: number };
type Workforce = { revision: number; people: Person[] };
type Impact = { scheduleRevision: number; items: Array<{ workTitle: string; date: string;
  currentIssues: string[] }> };

export function CustomerWorkforceAdmin({ workspace }: { workspace: string }) {
  const [workforce, setWorkforce] = useState<Workforce | null>(null);
  const [selected, setSelected] = useState<Person | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [outcomeUncertain, setOutcomeUncertain] = useState(false);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [retryReady, setRetryReady] = useState(false);
  const endpoint = `/api/d5o-hosted/workforce?workspace=${encodeURIComponent(workspace)}`;
  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const data = await response.json() as Workforce & { error?: string };
    if (!response.ok) throw Error(data.error ?? "Workforce unavailable");
    setWorkforce(data);
    setImpact(null);
    setSelected((current) => current ? data.people.find((item) => item.id === current.id) ?? null : null);
  }, [endpoint]);
  useEffect(() => { const frame = requestAnimationFrame(() => {
    void load().catch((cause) => setError(String(cause)));
  }); return () => cancelAnimationFrame(frame); }, [load]);
  const selectedId = selected?.id;
  const selectedRevision = selected?.profileRevision;
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void fetch(`/api/d5o-hosted/workforce-impact?workspace=${encodeURIComponent(workspace)}&personId=${selectedId}`,
      { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const data = await response.json() as Impact & { error?: string };
        if (!response.ok) throw Error(data.error ?? "Booking impact unavailable");
        setImpact(data);
      }).catch((cause) => { if (!controller.signal.aborted) setError(String(cause)); });
    return () => controller.abort();
  }, [selectedId, selectedRevision, workspace]);
  async function command(action: "save-person" | "bind-person" | "set-active",
    data: Record<string, unknown>, scheduleRevision: number | null) {
    if (!workforce || busy || outcomeUncertain) return;
    setBusy(true); setError(""); setNotice("");
    const commandId = crypto.randomUUID();
    const payload = { workspace, action, data, commandId,
      expectedRevision: workforce.revision, expectedScheduleRevision: scheduleRevision };
    try {
      const response = await fetch("/api/d5o-hosted/workforce", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        if (response.status >= 500) { setOutcomeUncertain(true); setPending(payload); }
        throw Error(result.error ?? "Workforce command failed");
      }
      await load(); setNotice("Workforce change saved and current roster reloaded.");
    } catch (cause) {
      if (cause instanceof TypeError) { setOutcomeUncertain(true); setPending(payload); }
      setError(cause instanceof Error ? cause.message : "Workforce command failed");
    } finally { setBusy(false); }
  }
  async function reconcile(retry: boolean) {
    if (!pending || busy) return;
    setBusy(true); setError("");
    try {
      const receipt = await fetch(`/api/d5o-hosted/admin-receipt?workspace=${encodeURIComponent(workspace)}` +
        `&commandId=${encodeURIComponent(String(pending.commandId))}`, { cache: "no-store" });
      if (!receipt.ok) throw Error("Receipt unavailable; keep the original command pending.");
      if ((await receipt.json() as { found?: boolean }).found) {
        await load(); setPending(null); setOutcomeUncertain(false); setRetryReady(false);
        setNotice("The original command committed once; no duplicate was sent."); return;
      }
      if (!retry) { setRetryReady(true); setNotice("No receipt exists yet. Retry only the retained original command."); return; }
      const response = await fetch("/api/d5o-hosted/workforce", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending) });
      if (!response.ok) throw Error("The retry outcome is uncertain. Check the receipt again.");
      await load(); setPending(null); setOutcomeUncertain(false); setRetryReady(false);
      setNotice("The retained original command was saved once.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Receipt unavailable"); }
    finally { setBusy(false); }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const qualifications = String(values.get("qualifications") ?? "").split(",")
      .map((item) => item.trim()).filter(Boolean);
    void command("save-person", { ...(selected ? { id: selected.id } : {}),
      person: selected?.person ?? String(values.get("person") ?? "").trim(),
      displayName: String(values.get("displayName") ?? "").trim(), qualifications,
      weeklyCapacityHours: Number(values.get("capacity")), active: selected?.active ?? true },
    selected ? impact?.scheduleRevision ?? null : null);
  }
  return <section aria-label="Workforce administration">
    <p>Maintain qualified, bound people for this tenant. Booking eligibility is checked again when work is scheduled.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {outcomeUncertain && <p role="alert">The last command outcome is uncertain. Check its receipt before another change.</p>}
    {pending && <p><button type="button" disabled={busy} onClick={() => void reconcile(false)}>Check original receipt</button>
      {retryReady && <button type="button" disabled={busy} onClick={() => void reconcile(true)}>Retry original command</button>}</p>}
    <button type="button" onClick={() => { void load().then(() => setError("")); }}>Refresh roster</button>
    {!workforce ? <p role="status">Loading workforce…</p> : <>
      <ul>{workforce.people.map((person) => <li key={person.id}>
        <button type="button" onClick={() => setSelected(person)}>{person.displayName}</button>
        {" · "}{person.qualifications.join(", ") || "No qualification"}{" · "}
        {person.weeklyCapacityHours} hours/week{" · "}{person.bound ? "Bound" : "Unbound"}
      </li>)}</ul>
      {selected && <button type="button" onClick={() => { setSelected(null); setImpact(null); }}>Add another person</button>}
      <form key={selected?.id ?? "new-person"} onSubmit={save}>
        <h2>{selected ? `Edit ${selected.displayName}` : "Add roster person"}</h2>
        {!selected && <label>Stable roster identity<input name="person" required minLength={2} /></label>}
        <label>Display name<input name="displayName" defaultValue={selected?.displayName ?? ""} required /></label>
        <label>Qualifications, comma separated<input name="qualifications"
          defaultValue={selected?.qualifications.join(", ") ?? ""} required /></label>
        <label>Weekly capacity (hours)<input name="capacity" type="number" min="1" max="80" step="0.5"
          defaultValue={selected?.weeklyCapacityHours ?? 40} required /></label>
        {selected && <p>{impact ? `${impact.items.length} current or retained booking(s) reviewed.` : "Checking booking impact…"}</p>}
        <button disabled={busy || outcomeUncertain || Boolean(selected && !impact)}>{selected ? "Save person" : "Add person"}</button>
      </form>
      {selected && impact && <><h2>Booking impact</h2><ul>{impact.items.map((item, index) =>
        <li key={index}>{item.workTitle} · {item.date} · {item.currentIssues.join("; ") || "No current issue"}</li>)}</ul></>}
      {selected && !selected.bound && <form onSubmit={(event) => { event.preventDefault();
        const values = new FormData(event.currentTarget);
        void command("bind-person", { id: selected.id, email: String(values.get("email") ?? "").trim() },
          impact?.scheduleRevision ?? null); }}>
        <h2>Bind a confirmed field-worker account</h2>
        <p>The account must already exist. Binding grants field-worker access only in this tenant.</p>
        <label>Confirmed sign-in email<input name="email" type="email" required /></label>
        <button disabled={busy || outcomeUncertain || !impact}>Bind account</button>
      </form>}
      {selected && <button type="button" disabled={busy || outcomeUncertain || selected.active && !impact}
        onClick={() => { if (window.confirm(`${selected.active ? "Deactivate" : "Reactivate"} ${selected.displayName}?`))
          void command("set-active", { id: selected.id, active: !selected.active },
            selected.active ? null : impact?.scheduleRevision ?? null); }}>
        {selected.active ? "Deactivate" : "Reactivate"} person
      </button>}
    </>}
  </section>;
}
