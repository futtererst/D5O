"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceKey } from "./schedule-model";
import type { CatalogMutation, CatalogWorkPackage, CatalogWorkRecord, SharedWorkCatalog } from "./work-catalog-model";
import type { WorkRecord } from "./work-types";

type Change = CatalogMutation extends infer T ? T extends { expectedRevision: number } ? Omit<T, "expectedRevision"> : never : never;
type AccessStatus = "loading" | "allowed" | "denied" | "failed";

export function useSharedWorkCatalog(workspace: WorkspaceKey, hostedPreview = false, actorId = "") {
  const endpoint = hostedPreview
    ? `/api/d5o-hosted/prototype-catalog?workspace=${encodeURIComponent(workspace)}`
    : "/api/work/catalog";
  const scope = `${workspace}:${actorId}`;
  const [catalog, setCatalog] = useState<SharedWorkCatalog | null>(null);
  const [access, setAccess] = useState<{ scope: string; status: AccessStatus; error: string }>({ scope, status: "loading", error: "" });
  const current = useRef<SharedWorkCatalog | null>(null);
  const currentScope = useRef(scope);
  const requestSequence = useRef(0);
  const pendingCreate = useRef<{ fingerprint: string; commandId: string } | null>(null);
  const refresh = useCallback(async () => {
    const request = ++requestSequence.current;
    setAccess({ scope, status: "loading", error: "" });
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) {
        const denied = response.status === 401 || response.status === 403;
        const message = denied ? "This account cannot edit shared Work in this workspace." : "Shared Work access could not be checked.";
        if (request === requestSequence.current && currentScope.current === scope) {
          current.current = null;
          setCatalog(null);
          setAccess({ scope, status: denied ? "denied" : "failed", error: message });
        }
        throw new Error(message);
      }
      const payload = await response.json() as { catalog: SharedWorkCatalog; canEdit: boolean };
      if (payload.catalog.workspace !== workspace) throw new Error("Shared work workspace mismatch.");
      if (request !== requestSequence.current || currentScope.current !== scope) throw new Error("Workspace access changed. Refresh this Work view.");
      current.current = payload.catalog;
      setCatalog(payload.catalog);
      setAccess({ scope, status: payload.canEdit ? "allowed" : "denied",
        error: payload.canEdit ? "" : "This account cannot edit shared Work in this workspace." });
      return payload.catalog;
    } catch (failure) {
      if (request === requestSequence.current && currentScope.current === scope) {
        setAccess((state) => state.status === "denied" ? state : {
          scope, status: "failed", error: failure instanceof Error ? failure.message : "Shared Work access could not be checked."
        });
      }
      throw failure;
    }
  }, [workspace, endpoint, scope]);
  useEffect(() => {
    currentScope.current = scope;
    requestSequence.current += 1;
    current.current = null;
    pendingCreate.current = null;
    setCatalog(null);
    setAccess({ scope, status: "loading", error: "" });
    const frame = requestAnimationFrame(() => { void refresh().catch(() => undefined); });
    return () => { cancelAnimationFrame(frame); requestSequence.current += 1; };
  }, [scope, refresh]);
  const mutate = useCallback(async (change: Change): Promise<{ catalog: SharedWorkCatalog; created: CatalogWorkRecord | CatalogWorkPackage; workRevision?: number; workState?: { revision: number; records: WorkRecord[] } }> => {
    const state = current.current;
    if (currentScope.current !== scope || !state || access.scope !== scope || access.status !== "allowed")
      throw new Error("Wait for workspace editing access before changing shared Work.");
    const fingerprint = change.action === "create-record" || change.action === "create-package" ? JSON.stringify(change) : "";
    if (pendingCreate.current && pendingCreate.current.fingerprint !== fingerprint)
      throw new Error("The previous Work creation outcome is uncertain. Retry the unchanged form to reconcile its command before editing it.");
    const commandId = change.action === "create-record" || change.action === "create-package"
      ? change.commandId ?? (pendingCreate.current?.fingerprint === fingerprint
        ? pendingCreate.current.commandId : crypto.randomUUID()) : undefined;
    if (commandId && (change.action === "create-record" || change.action === "create-package")) pendingCreate.current = { fingerprint, commandId };
    let response: Response;
    let result: { catalog?: SharedWorkCatalog; created?: CatalogWorkRecord | CatalogWorkPackage; workRevision?: number; workState?: { revision: number; records: WorkRecord[] }; error?: string; message?: string };
    try {
      response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...change, commandId, expectedRevision: state.revision }) });
      result = await response.json() as typeof result;
    } catch {
      throw new Error("The Work creation outcome is uncertain. Retry the unchanged form to reconcile the same command; your entries remain here.");
    }
    if (!response.ok || !result.catalog || !result.created) {
      if (response.status === 409) await refresh();
      if (response.status < 500) pendingCreate.current = null;
      const message = result.message ?? result.error ?? "Shared work change failed.";
      throw new Error(response.status >= 500 ? `${message} The outcome may be uncertain; retry the unchanged form to reconcile the same command.` : message);
    }
    current.current = result.catalog;
    if (change.action === "create-record" || change.action === "create-package") pendingCreate.current = null;
    setCatalog(result.catalog);
    setAccess({ scope, status: "allowed", error: "" });
    return { catalog: result.catalog, created: result.created, workRevision: result.workRevision, workState: result.workState };
  }, [refresh, endpoint, scope, access]);
  const accessStatus: AccessStatus = access.scope === scope ? access.status : "loading";
  return { catalog: access.scope === scope ? catalog : null, canEdit: accessStatus === "allowed",
    accessStatus, error: access.scope === scope ? access.error : "", refresh, mutate };
}
