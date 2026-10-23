"use client";

import { useState } from "react";
import styles from "@/app/work/invitation/invitation.module.css";

export function InvitationAcceptance({ workspace, request }: { workspace: string; request: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function accept() {
    setBusy(true);
    try {
      const response = await fetch("/api/d5o-hosted/org-invitation-accept", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace, inviteId: request }) });
      const body = await response.json() as { result?: { role?: string }; error?: string };
      if (!response.ok) throw Error(body.error ?? "Invitation could not be accepted");
      const role = (body.result?.role ?? "assigned").replaceAll("_", " ");
      setMessage(`Access to ${workspace} is active with role ${role}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Invitation could not be accepted"); }
    finally { setBusy(false); }
  }
  return <><button className={styles.action} type="button" disabled={busy} onClick={() => void accept()}>
    {busy ? "Verifying invitation…" : "Accept invitation"}
  </button>{message && <p className={styles.result} role="status">{message}</p>}</>;
}
