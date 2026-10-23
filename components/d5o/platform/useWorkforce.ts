"use client";

import { useCallback, useEffect, useState } from "react";
import type { PersonProfile, WorkspaceKey } from "./schedule-model";

export type WorkforcePerson = PersonProfile & {
  id: string; person: string; displayName: string; active: boolean; bound: boolean;
  profileRevision: number; workerUserId?: string | null; email?: string | null;
};
type WorkforceState = { revision: number; people: WorkforcePerson[] };

export function useWorkforce(workspace: WorkspaceKey, enabled: boolean) {
  const [state, setState] = useState<WorkforceState | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!enabled || workspace !== "rybex") return;
    const response = await fetch(`/api/d5o-hosted/workforce?workspace=${workspace}`, { cache: "no-store" });
    const data = await response.json() as WorkforceState & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Workforce unavailable");
    setState({ ...data, people: data.people.map((person) => ({ ...person, name: person.person })) }); setError("");
  }, [enabled, workspace]);
  useEffect(() => {
    if (!enabled || workspace !== "rybex") return;
    void Promise.resolve().then(refresh).catch((cause) => setError(cause instanceof Error ? cause.message : "Workforce unavailable"));
    const update = () => { void Promise.resolve().then(refresh).catch(() => undefined); };
    window.addEventListener("focus", update);
    window.addEventListener("d5o-workforce-updated", update);
    return () => { window.removeEventListener("focus", update); window.removeEventListener("d5o-workforce-updated", update); };
  }, [enabled, workspace, refresh]);
  return { state, error, refresh };
}
