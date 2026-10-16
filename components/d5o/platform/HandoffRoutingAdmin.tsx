"use client";

import { useEffect, useState } from "react";
import type { WorkspaceKey } from "./work-types";

type Route = { key: string; role: string; revision: number; updatedAt?: string };
const names: Record<string, string> = { discoverDefine: "Discover to Define", designDeploy: "Design to Deploy", deployOperate: "Deploy to Operate" };
const labels: Record<string, string> = { admin: "System administrator", operations_leader: "Operations leader", project_manager: "Project manager" };
export function HandoffRoutingAdmin({ workspace, version }: { workspace: WorkspaceKey; version: string }) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const response = await fetch(`/api/d5o-hosted/handoff-routes?workspace=${encodeURIComponent(workspace)}&version=${encodeURIComponent(version)}`, { cache: "no-store" });
    const body = await response.json() as { routes?: Route[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Configured handoffs unavailable.");
    setRoutes(body.routes ?? []);
  }
  useEffect(() => {
    let active = true;
    void fetch(`/api/d5o-hosted/handoff-routes?workspace=${encodeURIComponent(workspace)}&version=${encodeURIComponent(version)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { routes?: Route[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Configured handoffs unavailable.");
        return body.routes ?? [];
      })
      .then((items) => { if (active) setRoutes(items); })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Configured handoffs unavailable."); });
    return () => { active = false; };
  }, [workspace, version]);
  async function save(route: Route, role: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/d5o-hosted/handoff-routes?workspace=${encodeURIComponent(workspace)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, key: route.key, role, expectedRevision: route.revision, commandId: crypto.randomUUID() })
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Route could not be saved.");
      await refresh(); setMessage("Receiving role saved. New handoffs use this route; existing decisions retain their recorded destination.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Route could not be saved."); }
    finally { setBusy(false); }
  }
  return <section className="d5o-publication" aria-label="Configured handoff routing">
    <header><div><p>WORKFLOW ROUTING · SYSTEM ADMINISTRATOR</p><h2>Who receives each handoff</h2><span>Submitters supply the work basis. The configured role receives it; an eligible independent member records acceptance.</span></div></header>
    <div className="d5o-publication-fields">{Object.keys(names).map((key) => {
      const route = routes.find((item) => item.key === key);
      return <label key={key}>{names[key]}<select aria-label={`${names[key]} receiving role`} key={`${key}-${route?.revision ?? 0}`} defaultValue={route?.role ?? ""}
        disabled={busy || (key === "deployOperate" && !!route)} onChange={(event) => { void save(route ?? { key, role: "", revision: 0 }, event.target.value); }}>
        {!route ? <option value="">Not configured</option> : null}
        {Object.entries(labels).filter(([role]) => key !== "deployOperate" || role === "operations_leader").map(([role, label]) => <option key={role} value={role}>{label}</option>)}
      </select><small>{route ? `Configuration revision ${route.revision}` : "An administrator must configure this route before a handoff can be submitted."}</small></label>;
    })}</div>
    <p role="status" aria-live="polite">{message}</p>
    <small>Deploy to Operate currently requires the Operations leader by the existing independent receipt policy. A missing eligible receiver holds submission; it never asks the submitter to nominate one.</small>
  </section>;
}
