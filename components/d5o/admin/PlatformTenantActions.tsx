"use client";
import { useState } from "react";
import type { ProvisionedTenant } from "@/lib/d5o/admin/platform-provisioning";
import styles from "@/app/platform-admin/platform-admin.module.css";

export function PlatformTenantActions({ tenant }: { tenant: ProvisionedTenant }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function act(action: "activate" | "recover") {
    if (!window.confirm(`${action === "activate" ? "Activate" : "Recover invitation for"} ${tenant.name}?`)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/d5o-platform/provisioning", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, workspaceKey: tenant.workspaceKey,
          adminEmail: tenant.initialAdministrator, expectedRevision: tenant.revision,
          commandId: crypto.randomUUID(), reason }) });
      const body = await response.json() as { error?: string; result?: { lifecycle?: string } };
      if (!response.ok) throw Error(body.error ?? "Action failed");
      setMessage(`Tenant state: ${body.result?.lifecycle ?? "updated"}. Refresh to review the current record.`);
      window.location.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Action failed"); }
    finally { setBusy(false); }
  }
  if (!tenant.initialAdministrator) return <p>Existing pilot: provisioning controls are unavailable.</p>;
  const canActivate = tenant.status === "ready";
  const canRecover = tenant.status === "failed" || tenant.invitationStatus === "revoked" ||
    Boolean(tenant.invitationExpiresAt && new Date(tenant.invitationExpiresAt) < new Date());
  if (!canActivate && !canRecover) return <p>There are no vendor actions available in this lifecycle state.</p>;
  return <section className={styles.section}><h2>Vendor actions</h2>
    <label className={styles.full}>Decision reason<textarea required minLength={8} maxLength={500}
      value={reason} onChange={(event) => setReason(event.target.value)} /></label>
    <div className={styles.actions}>
      {canActivate && <button type="button" disabled={busy || reason.trim().length < 8}
        onClick={() => void act("activate")}>Activate customer</button>}
      {canRecover &&
        <button type="button" disabled={busy || reason.trim().length < 8}
          onClick={() => void act("recover")}>Issue replacement invitation</button>}
    </div>{message && <p role="status" className={styles.notice}>{message}</p>}
  </section>;
}
