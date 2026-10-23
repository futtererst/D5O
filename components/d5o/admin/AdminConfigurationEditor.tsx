"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminCommand } from "./useAdminCommand";

type Route = { key: string; role: string; revision: number; eligibleCount: number };
type WorkType = { key: string; label: string; status: "active" | "disabled"; roles: string[] };
type Version = { id: string; version: number; revision: number; status: "draft" | "validated" | "published" | "superseded";
  sourceVersionId?: string; sourceSha256: string; manifest: Record<string, unknown>; workTypes: WorkType[];
  routes: Route[]; workCount: number; createdAt: string; effectiveFrom?: string | null; effectiveTo?: string | null };
type Inventory = { activeVersionId: string; versions: Version[] };
const routeNames: Record<string, string> = { discoverDefine: "Discover → Define", designDeploy: "Design → Deploy", deployOperate: "Deploy → Operate" };
const roleNames: Record<string, string> = { admin: "Admin", project_manager: "Project Manager", operations_leader: "Operations Leader" };
const phases = ["discover", "define", "develop", "design", "deploy", "operate"];
const fields = [
  ["phase-label", "Phase label"], ["phase-purpose", "Phase purpose / instruction"],
  ["design-review-lead", "Design review lead, days"], ["design-procurement-buffer", "Design procurement buffer, days"],
  ["design-require-permit", "Design permit required"], ["design-require-access", "Design access confirmation required"],
  ["deploy-start-lead", "Field-start lead, minutes"], ["deploy-max-hours", "Maximum reported hours per shift"],
  ["deploy-require-reviewed-evidence", "Reviewed evidence before quality approval"],
  ["operate-response-hours", "Operate response hours"], ["operate-timezone", "Operate time zone"],
] as const;
type Field = typeof fields[number][0];
function presentation(version: Version) { return (version.manifest.d5oPresentation ?? {}) as Record<string, unknown>; }
function contractTypes(version: Version) { const value = (presentation(version).phaseContract ?? {}) as { workTypes?: Array<Record<string, unknown>> }; return value.workTypes ?? []; }
function valueFor(version: Version, field: Field, typeKey: string, phase: string) {
  const p = presentation(version);
  if (field === "phase-label") return String(((p.phaseLabels ?? {}) as Record<string, unknown>)[phase] ?? phase);
  const type = contractTypes(version).find((item) => item.workTypeKey === typeKey) ?? {};
  if (field === "phase-purpose") return String(((type.phases as Array<{ key: string; purpose: string }> | undefined) ?? []).find((item) => item.key === phase)?.purpose ?? "");
  const [group, key] = ({ "design-review-lead": ["designControls", "reviewLeadDays"],
    "design-procurement-buffer": ["designControls", "procurementBufferDays"],
    "design-require-permit": ["designControls", "requirePermit"], "design-require-access": ["designControls", "requireAccess"],
    "deploy-start-lead": ["deployControls", "fieldStartLeadMinutes"],
    "deploy-max-hours": ["deployControls", "maxActualHoursPerShift"],
    "deploy-require-reviewed-evidence": ["deployControls", "requireReviewedEvidence"],
    "operate-response-hours": ["operateControls", "defaultResponseHours"],
    "operate-timezone": ["operateControls", "timezone"] } as Record<string, [string, string]>)[field] ?? [];
  return String(((type[group] ?? {}) as Record<string, unknown>)[key] ?? "");
}
function differences(active: Version, draft: Version) {
  const changes: string[] = [];
  for (const type of draft.workTypes) {
    const prior = active.workTypes.find((item) => item.key === type.key);
    if (!prior) changes.push(`New ${type.label} (${type.key}) from a supported template`);
    else if (prior.status !== type.status) changes.push(`${type.label}: ${prior.status} → ${type.status}`);
    if (prior && JSON.stringify(prior.roles) !== JSON.stringify(type.roles)) changes.push(`${type.label}: creation rights changed`);
  }
  for (const route of draft.routes) {
    const prior = active.routes.find((item) => item.key === route.key);
    if (prior?.role !== route.role) changes.push(`${routeNames[route.key] ?? route.key}: ${prior?.role ?? "unset"} → ${route.role}`);
  }
  for (const [field, label] of fields) for (const type of draft.workTypes) {
    const oldType = active.workTypes.find((item) => item.key === type.key);
    if (!oldType) continue;
    for (const phase of field.startsWith("phase-") ? phases : [""]) {
      const before = valueFor(active, field, type.key, phase), after = valueFor(draft, field, type.key, phase);
      if (before !== after) changes.push(`${type.label}${phase ? ` / ${phase}` : ""}: ${label} ${before} → ${after}`);
    }
  }
  return [...new Set(changes)];
}

export function AdminConfigurationEditor({ workspace }: { workspace: string }) {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reason, setReason] = useState("");
  const [field, setField] = useState<Field>("deploy-start-lead");
  const [typeKey, setTypeKey] = useState("technical-delivery");
  const [phase, setPhase] = useState("discover");
  const [typeName, setTypeName] = useState("");
  const [newKey, setNewKey] = useState("");
  const [templateKey, setTemplateKey] = useState("technical-delivery");
  const [routeChoice, setRouteChoice] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/d5o-hosted/admin-configuration?workspace=${encodeURIComponent(workspace)}`, { cache: "no-store" });
    const body = await response.json() as Inventory & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Configuration unavailable");
    setInventory(body); setLoadError("");
  }, [workspace]);
  const { pending, busy, canRetry, message, execute, reconcile, retry } = useAdminCommand(workspace, refresh);
  useEffect(() => { const timer = window.setTimeout(() => { void refresh().catch((error) => setLoadError(error instanceof Error ? error.message : "Configuration unavailable")); }, 0); return () => window.clearTimeout(timer); }, [refresh]);
  const active = inventory?.versions.find((version) => version.id === inventory.activeVersionId);
  const draft = inventory?.versions.find((version) => version.status === "draft");
  const candidate = inventory?.versions.find((version) => version.status === "validated");
  const chosenType = draft?.workTypes.find((item) => item.key === typeKey) ?? draft?.workTypes[0];
  const currentValue = draft ? valueFor(draft, field, chosenType?.key ?? typeKey, phase) : "";
  function run(action: string, version: Version, data: Record<string, unknown> = {}) {
    if (!active || reason.trim().length < 8 || pending) return;
    execute(`/api/d5o-hosted/admin-configuration?workspace=${encodeURIComponent(workspace)}`,
      { action, version: version.id, expectedActive: active.id, expectedRevision: version.revision,
        data, reason: reason.trim() },
      action === "create-draft" ? "Draft copied; the active version is unchanged."
        : action === "validate-publish" ? "Validated version published. Activate it explicitly for future Work."
          : action === "activate" ? "New default activated for future Work; earlier Work keeps its pin."
            : "Draft change saved. Validate before publication.");
  }
  return <section aria-label="Hosted configuration management" className="d5o-publication">
    <header><div><h2>Published policy</h2>
      <span>New Work uses the active version. Existing Work keeps its recorded configuration.</span></div>
      <strong>{active ? `Active v${active.version}` : "Loading active version"}</strong></header>
    {loadError && <p role="alert">{loadError}</p>}
    <p role="status" aria-live="polite">{message}</p>
    {pending && <p>Command {pending.commandId} awaits reconciliation. <button type="button" disabled={busy} onClick={() => void reconcile()}>Check receipt</button> <button type="button" disabled={busy || !canRetry} onClick={retry}>Retry same command</button></p>}
    {active && <>
      <p>Effective {active.effectiveFrom ? new Date(active.effectiveFrom).toLocaleString() : "not dated"} · {active.workCount} Work Record(s) pinned here. {draft ? `Draft v${draft.version} is being edited.` : candidate ? `Published candidate v${candidate.version} awaits activation.` : "No open draft."}</p>
      <div className="d5o-admin-config-grid">
        <article><h3>Work Types</h3>{active.workTypes.map((item) => <p key={item.key}><strong>{item.label}</strong> · {item.status}<br /><small>Creators: {item.roles.map((role) => roleNames[role] ?? role.replaceAll("_", " ")).join(", ") || "none"}</small><details><summary>Technical details</summary><small>Key: {item.key}</small></details></p>)}</article>
        <article><h3>Receiving roles</h3>{active.routes.map((route) => <p key={route.key}>{routeNames[route.key]}: <strong>{roleNames[route.role] ?? route.role}</strong> · {route.eligibleCount} active member(s)</p>)}</article>
      </div>
      <details className="d5o-admin-history"><summary>Version history ({inventory?.versions.length ?? 0})</summary>{inventory?.versions.map((version) => <p key={version.id}>v{version.version} · {version.status} · {version.workCount} pinned Work <details><summary>Technical details</summary><small>Version ID: {version.id} · Source: {version.sourceSha256}</small></details></p>)}</details>
      <div className="d5o-admin-config-decision"><label>Reason for the next configuration decision<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Why is this policy change needed?" /></label>
      {!draft && !candidate && <button type="button" disabled={busy || reason.trim().length < 8} onClick={() => run("create-draft", active)}>Create draft from active v{active.version}</button>}</div>
    </>}
    {draft && active && <>
      <h3>Draft v{draft.version} · revision {draft.revision}</h3><p>Saved edits are not effective. This draft started from v{active.version}. Publication validates the combined policy and freezes the candidate.</p>
      <section><h4>Supported phase policy</h4><div style={{ display: "flex", flexWrap: "wrap", gap: ".6rem" }}>
        <label>Field<select value={field} onChange={(event) => setField(event.target.value as Field)}>{fields.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        {field !== "phase-label" && <label>Work Type<select value={chosenType?.key ?? ""} onChange={(event) => setTypeKey(event.target.value)}>{draft.workTypes.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}</select></label>}
        {field.startsWith("phase-") && <label>Phase<select value={phase} onChange={(event) => setPhase(event.target.value)}>{phases.map((key) => <option key={key} value={key}>{key}</option>)}</select></label>}
      </div>
      <form key={`${draft.id}:${field}:${chosenType?.key}:${phase}`} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run("save-policy", draft, { key: field, workTypeKey: chosenType?.key, phase, value: String(form.get("value") ?? "") }); }}>
        <label>{fields.find(([key]) => key === field)?.[1]}<input name="value" required defaultValue={currentValue} /></label>
        <button disabled={busy || Boolean(pending) || reason.trim().length < 8}>Save supported policy field</button>
      </form><small>Phase order, binding keys, independent approval, tenant isolation and authority are code enforced. This editor cannot remove those controls or add executable rules.</small></section>
      <section><h4>Receiving roles</h4>{draft.routes.map((route) => <div key={route.key} style={{ display: "flex", flexWrap: "wrap", gap: ".5rem", alignItems: "center" }}><label>{routeNames[route.key]}<select value={routeChoice[route.key] ?? route.role} onChange={(event) => setRouteChoice((current) => ({ ...current, [route.key]: event.target.value }))}>{Object.entries(roleNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><span>{route.eligibleCount} current member(s) for saved role</span><button type="button" disabled={busy || Boolean(pending) || (routeChoice[route.key] ?? route.role) === route.role} onClick={() => run("save-route", draft, { key: route.key, role: routeChoice[route.key] })}>Save role</button></div>)}<small>Publication requires at least one active member in each receiving role; handoff decisions remain independent.</small></section>
      <section><h4>Work Types</h4>{draft.workTypes.map((type) => <article key={type.key}><strong>{type.label}</strong> · {type.key} · {type.status} · creators {type.roles.join(", ") || "none"}{type.status === "active" && <><button type="button" disabled={busy || Boolean(pending)} onClick={() => run("set-create-role", draft, { key: type.key, role: "project_manager", enabled: !type.roles.includes("project_manager") })}>{type.roles.includes("project_manager") ? "Remove" : "Allow"} PM creation</button><button type="button" disabled={busy || Boolean(pending)} onClick={() => { if (window.confirm(`Retire ${type.label} from future Work selection? Existing Work remains pinned.`)) run("retire-work-type", draft, { key: type.key }); }}>Retire from future Work</button></>}</article>)}
        <form onSubmit={(event) => { event.preventDefault(); run("create-work-type", draft, { key: newKey, label: typeName, templateKey }); }}><h5>Create from a supported engine template</h5><label>Stable key<input value={newKey} pattern="[a-z][a-z0-9-]{1,63}" required onChange={(event) => setNewKey(event.target.value)} /></label><label>Display name<input value={typeName} minLength={2} maxLength={120} required onChange={(event) => setTypeName(event.target.value)} /></label><label>Engine template<select value={templateKey} onChange={(event) => setTemplateKey(event.target.value)}><option value="technical-delivery">Technical delivery</option><option value="lifecycle-service">Lifecycle service</option></select></label><button disabled={busy || Boolean(pending) || reason.trim().length < 8}>Add Work Type to draft</button></form>
      </section>
      <section><h4>Compare draft with active v{active.version}</h4>{differences(active, draft).length ? <ul>{differences(active, draft).map((change) => <li key={change}>{change}</li>)}</ul> : <p>No supported setting has changed yet.</p>}<p>These changes apply to future Work only. {active.workCount} existing Work Record(s) remain pinned to v{active.version}.</p></section>
      <button type="button" disabled={busy || Boolean(pending) || reason.trim().length < 8 || differences(active, draft).length === 0} onClick={() => run("validate-publish", draft)}>Validate and publish v{draft.version}</button>
    </>}
    {candidate && active && <section><h3>Validated candidate v{candidate.version}</h3><p>Frozen and published for review; v{active.version} remains effective. {differences(active, candidate).length} supported change(s) are recorded.</p><ul>{differences(active, candidate).map((change) => <li key={change}>{change}</li>)}</ul><button type="button" disabled={busy || Boolean(pending) || reason.trim().length < 8} onClick={() => run("activate", candidate)}>Activate v{candidate.version} for future Work</button></section>}
  </section>;
}
