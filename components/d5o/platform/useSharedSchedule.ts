"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { datedAssignments, datedAvailability, type Assignment, type AvailabilityBlock, type CrewDemandSlot, type PackageCrewDemand, type SharedSchedule, type WorkspaceKey } from "./schedule-model";

type Change =
  | { action: "save-assignments"; assignments: Assignment[] }
  | { action: "save-booking"; assignment: Assignment; sourceSlot?: CrewDemandSlot }
  | { action: "save-availability"; availabilityBlocks: AvailabilityBlock[] }
  | { action: "save-demand"; demand: PackageCrewDemand }
  | { action: "publish"; week: number };

type PendingScheduleCommand = { actorId: string; workspace: WorkspaceKey; commandId: string;
  body: Record<string, unknown>; action: Change["action"] };

export function useSharedSchedule(workspace: WorkspaceKey, hostedPreview = false, actorId?: string) {
  const endpoint = hostedPreview
    ? `/api/d5o-hosted/prototype-schedule?workspace=${encodeURIComponent(workspace)}`
    : "/api/work/schedule";
  const [schedule, setSchedule] = useState<SharedSchedule | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [canManageAvailability, setCanManageAvailability] = useState(false);
  const [requiresPublication, setRequiresPublication] = useState(false);
  const [error, setError] = useState("");
  const [delivery, setDelivery] = useState<{ sent: number; failed: number; attempting: number; unavailable?: boolean } | null>(null);
  const [deliveryWarning, setDeliveryWarning] = useState("");
  const [legacyPlan, setLegacyPlan] = useState<Assignment[] | null>(null);
  const [pending, setPending] = useState<PendingScheduleCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const pendingRef = useRef<PendingScheduleCommand | null>(null);
  const inFlight = useRef(false);
  const current = useRef<SharedSchedule | null>(null);
  useEffect(() => {
    pendingRef.current = null; current.current = null;
    const frame = requestAnimationFrame(() => { setPending(null); setSchedule(null); setStale(false); setError(""); });
    return () => cancelAnimationFrame(frame);
  }, [workspace, actorId]);
  const refresh = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) { pendingRef.current = null; setPending(null); current.current = null; setSchedule(null); }
      throw new Error(response.status === 401 || response.status === 403 ? "Sign in to your authorized workspace to view the shared schedule." : "The shared schedule is unavailable.");
    }
    const payload = await response.json() as { schedule: SharedSchedule; actorId?: string; canEdit: boolean; canManageAvailability?: boolean; requiresPublication?: boolean; delivery?: { sent: number; failed: number; attempting: number; unavailable?: boolean } };
    if (payload.schedule.workspace !== workspace) throw new Error("Schedule workspace mismatch.");
    if (hostedPreview && payload.actorId !== actorId) {
      pendingRef.current = null; setPending(null); current.current = null; setSchedule(null);
      throw new Error("The signed-in account changed. Reload this workspace before editing its schedule.");
    }
    current.current = payload.schedule;
    setSchedule(payload.schedule);
    setCanEdit(payload.canEdit);
    setCanManageAvailability(payload.canManageAvailability === true);
    setRequiresPublication(payload.requiresPublication === true);
    setDelivery(payload.delivery ?? null);
    setError("");
    return payload.schedule;
  }, [workspace, endpoint, hostedPreview, actorId]);
  useEffect(() => {
    let active = true;
    const frame = requestAnimationFrame(() => refresh().then((loaded) => {
      if (!active) return;
      try {
        if (hostedPreview) return;
        const raw = localStorage.getItem(`d5o.crew-board.v1:${workspace}`);
        const dismissed = localStorage.getItem(`d5o.crew-board-import-dismissed.v1:${workspace}`);
        if (!raw || dismissed) return;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        const old = datedAssignments(parsed as Assignment[], loaded.anchorDate);
        const comparable = (items: Assignment[]) => JSON.stringify(items.map(({ date: _date, ...item }) => item));
        if (comparable(old) !== comparable(loaded.assignments)) setLegacyPlan(old);
      } catch { /* Invalid legacy browser data is left untouched. */ }
    }).catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : "Schedule unavailable."); }));
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [refresh, workspace, hostedPreview]);
  useEffect(() => {
    const update = () => { if (document.visibilityState === "visible") void refresh().catch(() => undefined); };
    const timer = window.setInterval(update, 15000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, [refresh]);
  const sendCommand = useCallback(async (command: PendingScheduleCommand) => {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command.body) });
    let result: { schedule?: SharedSchedule; error?: string; message?: string; delivery?: { sent: number; failed: number; attempting: number; unavailable?: boolean }; deliveryWarning?: string };
    try { result = await response.json(); } catch { throw new Error("uncertain_schedule_response"); }
    if (response.status >= 500) throw new Error("uncertain_schedule_response");
    if (!response.ok) {
      pendingRef.current = null; setPending(null);
      if (response.status === 409 && result.error === "stale_schedule") setStale(true);
      const message = result.message ?? result.error ?? "Schedule change was rejected. Your input remains available.";
      setError(message);
      throw new Error(message);
    }
    if (!result.schedule) throw new Error("uncertain_schedule_response");
    pendingRef.current = null; setPending(null); setStale(false);
    current.current = result.schedule;
    setSchedule(result.schedule);
    setDelivery(result.delivery ?? null);
    setDeliveryWarning(result.deliveryWarning ?? "");
    setError("");
    return result.schedule;
  }, [endpoint]);
  const mutate = useCallback(async (change: Change) => {
    if (inFlight.current || pendingRef.current) throw new Error("Resolve the pending schedule command before submitting another change.");
    const state = current.current;
    if (!state) throw new Error("Load the shared schedule before changing it.");
    if (hostedPreview && !actorId) throw new Error("Confirm the signed-in account before changing the schedule.");
    const payload = change.action === "save-assignments" ? { ...change, assignments: datedAssignments(change.assignments, state.anchorDate) }
      : change.action === "save-booking" ? { ...change, assignment: datedAssignments([change.assignment], state.anchorDate)[0] }
      : change.action === "save-availability" ? { ...change, availabilityBlocks: datedAvailability(change.availabilityBlocks, state.anchorDate) } : change;
    let command: Record<string, unknown> = payload as Record<string, unknown>;
    if (hostedPreview && requiresPublication && change.action === "save-availability") {
      const before = state.availabilityBlocks;
      const added = payload.action === "save-availability" ? payload.availabilityBlocks.filter((item) => !before.some((old) => old.id === item.id)) : [];
      const removed = before.filter((item) => !change.availabilityBlocks.some((next) => next.id === item.id));
      if (added.length + removed.length !== 1) throw new Error("Change one availability day at a time.");
      command = added.length ? { action: "record-unavailability", data: {
        person: added[0].person, week: added[0].week, day: added[0].day,
        date: added[0].date, note: added[0].reason
      } } : { action: "clear-unavailability", data: { id: removed[0].id } };
    }
    const retained: PendingScheduleCommand = { actorId: actorId ?? "local", workspace, commandId: crypto.randomUUID(),
      action: change.action, body: { ...command, expectedRevision: state.revision, commandId: "" } };
    retained.body.commandId = retained.commandId;
    pendingRef.current = retained; setPending(retained); inFlight.current = true; setBusy(true); setError("");
    try { return await sendCommand(retained); }
    catch (failure) {
      if (pendingRef.current) {
        const message = "Save outcome is uncertain. Keep this draft and check the original command before another change.";
        setError(message); throw new Error(message);
      }
      throw failure;
    } finally { inFlight.current = false; setBusy(false); }
  }, [workspace, actorId, hostedPreview, requiresPublication, sendCommand]);
  const reconcilePending = useCallback(async () => {
    const command = pendingRef.current;
    if (!command || inFlight.current) return;
    if (command.workspace !== workspace || command.actorId !== (actorId ?? "local")) {
      pendingRef.current = null; setPending(null); throw new Error("The account or workspace changed. The prior draft cannot be submitted here.");
    }
    inFlight.current = true; setBusy(true);
    try {
      if (hostedPreview) {
        const identity = await fetch(`${endpoint}&identity=1`, { cache: "no-store" });
        if (identity.status === 401 || identity.status === 403) {
          pendingRef.current = null; setPending(null); current.current = null; setSchedule(null);
          throw new Error("The earlier account no longer has workspace access. Its pending input was removed from this tab.");
        }
        if (!identity.ok) throw new Error("Account check unavailable. Keep the pending command and try reconciliation later.");
        const result = await identity.json() as { actorId?: string; workspace?: string };
        if (result.actorId !== command.actorId || result.workspace !== command.workspace) {
          pendingRef.current = null; setPending(null); current.current = null; setSchedule(null);
          throw new Error("A different account is signed in. The previous account's pending change was removed from this tab.");
        }
      }
      const result = await sendCommand(command); // Exact command replay resolves both committed and pre-commit interruption.
      try { await refresh(); } catch { setError("The original command was confirmed, but the latest schedule could not be loaded. Refresh before another change."); }
      return result;
    } catch (failure) {
      if (pendingRef.current) setError("The original command remains unresolved. Keep its input and reconcile again before a new change.");
      throw failure;
    } finally { inFlight.current = false; setBusy(false); }
  }, [workspace, actorId, hostedPreview, endpoint, sendCommand, refresh]);
  const reviewCurrent = useCallback(async () => { await refresh(); setStale(false); }, [refresh]);
  const dismissLegacy = useCallback(() => {
    localStorage.setItem(`d5o.crew-board-import-dismissed.v1:${workspace}`, "1");
    setLegacyPlan(null);
  }, [workspace]);
  return { schedule, canEdit, canManageAvailability, requiresPublication, error, delivery, deliveryWarning, legacyPlan,
    pending, busy, stale, refresh, reviewCurrent, mutate, reconcilePending, dismissLegacy };
}
