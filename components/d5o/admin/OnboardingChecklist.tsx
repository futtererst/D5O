"use client";
import Link from "next/link";
import { useState } from "react";
import styles from "@/app/platform-admin/platform-admin.module.css";

export type Readiness = { workspaceKey: string; displayName: string; lifecycle: string; revision: number;
  configurationVersion: number | null; ready: boolean;
  required: { organizationProfile: boolean; initialAdministrator: boolean;
    publishedConfiguration: boolean; serviceApprovalPolicy: boolean };
  recommended: { businessUnits: number; locations: number; teams: number };
  optional: { additionalMembers: number } };
export function OnboardingChecklist({ initial }: { initial: Readiness }) {
  const [readiness, setReadiness] = useState(initial);
  const [reason, setReason] = useState("Confirmed organization and approval readiness for activation");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const workspace = readiness.workspaceKey;
  const admin = (section: string) => `/work/admin/${section}?workspace=${encodeURIComponent(workspace)}`;
  async function refresh() {
    const response = await fetch(`/api/d5o-hosted/onboarding?workspace=${encodeURIComponent(workspace)}`,
      { cache: "no-store" });
    const body = await response.json() as Readiness & { error?: string };
    if (!response.ok) throw Error(body.error ?? "Readiness unavailable");
    setReadiness(body); setMessage("Readiness refreshed from the server.");
  }
  async function confirm() {
    if (!window.confirm(`Submit ${workspace} as ready for vendor activation?`)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/d5o-hosted/onboarding", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace, expectedRevision: readiness.revision,
          commandId: crypto.randomUUID(), reason }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw Error(body.error ?? "Readiness confirmation failed");
      await refresh(); setMessage("Setup is ready. A platform administrator can activate this customer.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Readiness confirmation failed"); }
    finally { setBusy(false); }
  }
  return <><p className={styles.notice}>Lifecycle: <strong>{readiness.lifecycle.replaceAll("_", " ")}</strong> · Active configuration: {readiness.configurationVersion ? `v${readiness.configurationVersion}` : "Unavailable"}</p>
    <section className={styles.section}><h2>Required before activation</h2><ul>
      <li>{readiness.required.initialAdministrator ? "✓" : "○"} Confirm administrative access</li>
      <li>{readiness.required.organizationProfile ? "✓" : "○"} <Link href={admin("organization-settings")}>Confirm organization profile</Link></li>
      <li>{readiness.required.publishedConfiguration ? "✓" : "○"} <Link href={admin("configuration")}>Review published configuration</Link></li>
      <li>{readiness.required.serviceApprovalPolicy ? "✓" : "○"} <Link href={admin("configuration")}>Publish a service-work approval policy</Link></li>
    </ul><button type="button" onClick={() => void refresh()}>Refresh readiness</button></section>
    <section className={styles.section}><h2>Recommended setup</h2><ul>
      <li><Link href={admin("business-units")}>Review business units</Link> · {readiness.recommended.businessUnits} active</li>
      <li><Link href={admin("locations")}>Review or create locations</Link> · {readiness.recommended.locations} active</li>
      <li><Link href={admin("teams")}>Review teams</Link> · {readiness.recommended.teams} active</li>
    </ul></section>
    <section className={styles.section}><h2>Optional setup</h2>
      <p><Link href={admin("invitations")}>Invite additional users</Link> · {readiness.optional.additionalMembers} other active members</p></section>
    {readiness.lifecycle === "setup_required" && <section className={styles.section}><h2>Confirm readiness</h2>
      <p>Opening this page does not activate the tenant. The server verifies required setup again when you confirm.</p>
      <label className={styles.full}>Decision reason<textarea minLength={8} maxLength={500} value={reason}
        onChange={(event) => setReason(event.target.value)} /></label>
      <div className={styles.actions}><button type="button" disabled={busy || !readiness.ready || reason.trim().length < 8}
        onClick={() => void confirm()}>Submit as ready</button></div>
    </section>}
    {message && <p role="status" className={styles.notice}>{message}</p>}
  </>;
}
