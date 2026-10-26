"use client";
import Link from "next/link";
import { useState } from "react";
import styles from "@/app/work/invitation/invitation.module.css";

export function InitialAdminAcceptance({ workspace, invitationId }:
  { workspace: string; invitationId: string }) {
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState("");
  async function accept() {
    setBusy(true);
    try {
      const response = await fetch("/api/d5o-platform/initial-admin-accept", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceKey: workspace, invitationId }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw Error(body.error ?? "Invitation could not be accepted");
      setAccepted(true); setMessage(`Administrator access to ${workspace} is active.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Invitation could not be accepted"); }
    finally { setBusy(false); }
  }
  return <><button className={styles.action} disabled={busy || accepted} type="button" onClick={() => void accept()}>
    {accepted ? "Invitation accepted" : busy ? "Verifying invitation…" : "Accept administrator invitation"}
  </button>{message && <p className={styles.result} role="status">{message}</p>}
    {accepted && <p><Link href={`/work/onboarding?workspace=${encodeURIComponent(workspace)}`}>Continue to customer setup →</Link></p>}
  </>;
}
