"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkspaceKey } from "./work-types";
import { useAdminCommand } from "@/components/d5o/admin/useAdminCommand";

type Route = { key: string; role: string; revision: number; eligibleCount: number };
type Version = { id: string; version: number; status: "draft" | "validated" | "published"; routes: Route[] };
type Inventory = { versions: Version[]; workTypes: Array<{ key: string; name: string }> };
const names: Record<string, string> = { discoverDefine: "Discover to Define", designDeploy: "Design to Deploy", deployOperate: "Deploy to Operate" };
const labels: Record<string, string> = { admin: "System administrator", operations_leader: "Operations leader", project_manager: "Project manager" };
const routeKeys = Object.keys(names);

export function HandoffRoutingAdmin({ workspace }: { workspace: WorkspaceKey }) {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/d5o-hosted/handoff-routes?workspace=${encodeURIComponent(workspace)}`, { cache: "no-store" });
    const body = await response.json() as Inventory & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Handoff configuration unavailable.");
    setInventory(body);
    const editable = body.versions.find((item) => item.status === "draft") ?? body.versions.find((item) => item.status === "published");
    setSelected((current) => ({ ...Object.fromEntries((editable?.routes ?? []).map((route) => [route.key, route.role])), ...current }));
  }, [workspace]);
  const { pending, busy, canRetry, message, setMessage, execute, reconcile, retry } = useAdminCommand(workspace, refresh);
  useEffect(() => {
    let active = true;
    void fetch(`/api/d5o-hosted/handoff-routes?workspace=${encodeURIComponent(workspace)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as Inventory & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Handoff configuration unavailable.");
        return body;
      }).then((body) => {
        if (!active) return;
        setInventory(body);
        const editable = body.versions.find((item) => item.status === "draft") ?? body.versions.find((item) => item.status === "published");
        setSelected(Object.fromEntries((editable?.routes ?? []).map((route) => [route.key, route.role])));
      }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Handoff configuration unavailable."); });
    return () => { active = false; };
  }, [workspace, setMessage]);

  async function command(action: "create-draft" | "save-route" | "publish" | "activate", version: Version, route?: Route) {
    execute(`/api/d5o-hosted/handoff-routes?workspace=${encodeURIComponent(workspace)}`,
      { action, version: version.id, key: route?.key, role: route ? selected[route.key] : undefined,
        expectedRevision: route?.revision ?? 0 },
      action === "create-draft" ? "Draft copied. Existing work retains its current version."
        : action === "save-route" ? "Draft receiving role saved. It is not active yet."
        : action === "publish" ? "Routes validated. Activate when they should govern new Work Records."
        : "New default activated. Existing Work Records and handoffs keep their prior basis.");
  }

  const active = inventory?.versions.find((item) => item.status === "published");
  const draft = inventory?.versions.find((item) => item.status === "draft");
  const candidate = inventory?.versions.find((item) => item.status === "validated");
  return <section className="d5o-publication" aria-label="Configured handoff routing">
    <header><div><p>HOSTED WORK CONFIGURATION · SYSTEM ADMINISTRATOR</p><h2>Receiving roles and effective setup</h2>
      <span>New work pins the active version. Submitters provide the handoff basis; an eligible independent member accepts or returns it.</span></div>
      <strong>{active ? `Active v${active.version}` : "No active version"}</strong></header>
    {!inventory ? <p role="status">Loading effective setup…</p> : <>
      <div className="d5o-publication-fields">{routeKeys.map((key) => {
        const route = active?.routes.find((item) => item.key === key);
        return <div key={key}><strong>{names[key]}</strong><p>{route ? labels[route.role] ?? route.role : "Not configured"}
          {route ? ` · ${route.eligibleCount} active member${route.eligibleCount === 1 ? "" : "s"}` : ""}</p>
          <small>{!route || route.eligibleCount === 0 ? "No eligible receiving member; new handoffs will be held." : "Independent receipt is checked for each handoff."}</small></div>;
      })}</div>
      <small>Active Work Types: {inventory.workTypes.map((item) => item.name).join(" · ") || "None"}. Typed commands retain all decision rights; this screen grants none.</small>
      {!draft && !candidate && active ? <div className="d5o-publication-actions"><button type="button" disabled={busy || Boolean(pending)} onClick={() => void command("create-draft", active)}>Create draft from active v{active.version}</button></div> : null}
      {draft ? <div className="d5o-publication-editor"><h3>Draft v{draft.version} · not active</h3>
        <div className="d5o-publication-fields">{routeKeys.map((key) => {
          const route = draft.routes.find((item) => item.key === key);
          return <label key={key}>{names[key]} receiving role<select aria-label={`${names[key]} draft receiving role`}
            value={selected[key] ?? route?.role ?? ""} disabled={busy}
            onChange={(event) => setSelected((current) => ({ ...current, [key]: event.target.value }))}>
            {Object.entries(labels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}
          </select><small>{route ? `${route.eligibleCount} active member${route.eligibleCount === 1 ? "" : "s"} for the saved role` : "Missing route"}</small>
          <button type="button" disabled={busy || Boolean(pending) || !route || selected[key] === route.role}
            onClick={() => { if (route) void command("save-route", draft, route); }}>Save draft route</button></label>;
        })}</div>
        <button type="button" disabled={busy || Boolean(pending) || draft.routes.length !== routeKeys.length || draft.routes.some((route) => route.eligibleCount === 0)}
          onClick={() => void command("publish", draft)}>Validate and publish candidate</button>
        <small>Publication checks for active receiving members. Individual handoffs also require an independent receiver.</small>
      </div> : null}
      {candidate ? <div className="d5o-publication-editor"><h3>Validated candidate v{candidate.version}</h3>
        <p>Routes are frozen. The current default is unchanged until activation.</p>
        <button type="button" disabled={busy || Boolean(pending)} onClick={() => void command("activate", candidate)}>Activate for new Work Records</button>
      </div> : null}
    </>}
    <p role="status" aria-live="polite">{message}</p>
    {pending && <p>Command {pending.commandId} awaits reconciliation. <button type="button" disabled={busy} onClick={() => void reconcile()}>Check receipt</button> <button type="button" disabled={busy || !canRetry} onClick={retry}>Retry this command</button></p>}
    <small>The selected Deploy receiver records delivery receipt and links the exact accepted source. Operations separately accepts support ownership and activation. Manage memberships under Admin → Users & access.</small>
  </section>;
}
