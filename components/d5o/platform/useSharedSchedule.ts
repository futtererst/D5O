"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { datedAssignments, datedAvailability, type Assignment, type AvailabilityBlock, type CrewDemandSlot, type PackageCrewDemand, type SharedSchedule, type WorkspaceKey } from "./schedule-model";

type Change =
  | { action: "save-assignments"; assignments: Assignment[] }
  | { action: "save-booking"; assignment: Assignment; sourceSlot?: CrewDemandSlot }
  | { action: "save-availability"; availabilityBlocks: AvailabilityBlock[] }
  | { action: "save-demand"; demand: PackageCrewDemand }
  | { action: "publish"; week: number };

export function useSharedSchedule(workspace: WorkspaceKey, hostedPreview = false) {
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
  const current = useRef<SharedSchedule | null>(null);
  const refresh = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Sign in to your authorized workspace to view the shared schedule." : "The shared schedule is unavailable.");
    const payload = await response.json() as { schedule: SharedSchedule; canEdit: boolean; canManageAvailability?: boolean; requiresPublication?: boolean; delivery?: { sent: number; failed: number; attempting: number; unavailable?: boolean } };
    if (payload.schedule.workspace !== workspace) throw new Error("Schedule workspace mismatch.");
    current.current = payload.schedule;
    setSchedule(payload.schedule);
    setCanEdit(payload.canEdit);
    setCanManageAvailability(payload.canManageAvailability === true);
    setRequiresPublication(payload.requiresPublication === true);
    setDelivery(payload.delivery ?? null);
    setError("");
    return payload.schedule;
  }, [workspace, endpoint]);
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
  const mutate = useCallback(async (change: Change) => {
    const state = current.current;
    if (!state) throw new Error("Load the shared schedule before changing it.");
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
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...command, expectedRevision: state.revision, commandId: crypto.randomUUID() }) });
    const result = await response.json() as { schedule?: SharedSchedule; error?: string; message?: string; delivery?: { sent: number; failed: number; attempting: number; unavailable?: boolean }; deliveryWarning?: string };
    if (!response.ok || !result.schedule) {
      if (response.status === 409) await refresh();
      const message = result.message ?? result.error ?? "Schedule change failed.";
      setError(message);
      throw new Error(message);
    }
    current.current = result.schedule;
    setSchedule(result.schedule);
    setDelivery(result.delivery ?? null);
    setDeliveryWarning(result.deliveryWarning ?? "");
    setError("");
    return result.schedule;
  }, [refresh, endpoint, hostedPreview, requiresPublication]);
  const dismissLegacy = useCallback(() => {
    localStorage.setItem(`d5o.crew-board-import-dismissed.v1:${workspace}`, "1");
    setLegacyPlan(null);
  }, [workspace]);
  return { schedule, canEdit, canManageAvailability, requiresPublication, error, delivery, deliveryWarning, legacyPlan, refresh, mutate, dismissLegacy };
}
