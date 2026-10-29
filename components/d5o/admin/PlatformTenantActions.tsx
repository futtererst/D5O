"use client";
import { useState } from "react";
import type { ProvisionedTenant } from "@/lib/d5o/admin/platform-provisioning";
import styles from "@/app/platform-admin/platform-admin.module.css";

export function PlatformTenantActions({ tenant }: { tenant: ProvisionedTenant }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function act(action: "activate" | "recover" | "suspend" | "reactivate" | "entitlement" | "flag", enabled?: boolean) {
    const subject = `${tenant.name} (${tenant.workspaceKey})`;
    const consequence = action === "suspend" ? "Customer operational changes will stop immediately, including existing sessions."
      : action === "reactivate" ? "Previously authorized members can resume operations; revoked access remains revoked."
        : action === "entitlement" || action === "flag" ? `Connected Work will ${enabled ? "be allowed only if both gates are enabled" : "be unavailable"}.`
          : "The tenant record will be updated.";
    if (!window.confirm(`${action} ${subject}? ${consequence} Reason: ${reason.trim()}`)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/d5o-platform/provisioning", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, workspaceKey: tenant.workspaceKey,
          adminEmail: tenant.initialAdministrator, expectedRevision:
            action === "entitlement" ? tenant.connectedWorkEntitlementRevision
              : action === "flag" ? tenant.connectedWorkFlagRevision : tenant.revision,
          enabled,
          commandId: crypto.randomUUID(), reason }) });
      const body = await response.json() as { error?: string; result?: { lifecycle?: string } };
      if (!response.ok) throw Error(body.error ?? "Action failed");
      setMessage(`Tenant state: ${body.result?.lifecycle ?? "updated"}. Refresh to review the current record.`);
      window.location.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Action failed"); }
    finally { setBusy(false); }
  }
  if (!tenant.initialAdministrator) return <p>Existing pilot: lifecycle and capability controls are unavailable.</p>;
  const canActivate = tenant.status === "ready";
  const canRecover = tenant.status === "failed" || tenant.invitationStatus === "revoked" ||
    (tenant.status === "awaiting_admin" && tenant.invitationStatus === "pending") ||
    Boolean(tenant.invitationExpiresAt && new Date(tenant.invitationExpiresAt) < new Date());
  return <section className={styles.section}><h2>Vendor actions</h2>
    <label className={styles.full}>Decision reason<textarea required minLength={8} maxLength={500}
      value={reason} onChange={(event) => setReason(event.target.value)} /></label>
    <div className={styles.actions}>
      {canActivate && <button type="button" disabled={busy || reason.trim().length < 8}
        onClick={() => void act("activate")}>Activate customer</button>}
      {canRecover &&
        <button type="button" disabled={busy || reason.trim().length < 8}
          onClick={() => void act("recover")}>Issue replacement invitation</button>}
      {tenant.status === "active" && <button type="button" disabled={busy || reason.trim().length < 8}
        onClick={() => void act("suspend")}>Suspend customer operations</button>}
      {tenant.status === "suspended" && <button type="button" disabled={busy || reason.trim().length < 8}
        onClick={() => void act("reactivate")}>Reactivate customer</button>}
    </div>{message && <p role="status" className={styles.notice}>{message}</p>}
    <h3>Connected Work availability</h3>
    <p>Entitlement: {tenant.connectedWorkEntitlement ? "granted" : "not granted"} · Rollout flag: {tenant.connectedWorkFlag ? "enabled" : "disabled"} · Effective: {tenant.connectedWorkAvailable ? "available" : "unavailable"}.</p>
    <div className={styles.actions}>
      <button type="button" disabled={busy || reason.trim().length < 8} onClick={() => void act("entitlement", !tenant.connectedWorkEntitlement)}>{tenant.connectedWorkEntitlement ? "Remove entitlement" : "Grant entitlement"}</button>
      <button type="button" disabled={busy || reason.trim().length < 8} onClick={() => void act("flag", !tenant.connectedWorkFlag)}>{tenant.connectedWorkFlag ? "Disable rollout flag" : "Enable rollout flag"}</button>
    </div>
  </section>;
}
