"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { WorkspaceKey } from "./work-types";
import styles from "./MemberAccessPanel.module.css";

type Member = { userId: string; email: string; role: string; status: string };
const roles = [
  ["project_manager", "Project manager"], ["operations_leader", "Operations leader"],
  ["billing_commercial_lead", "Finance / commercial lead"], ["field_supervisor", "Field supervisor"],
  ["business_development_lead", "Business development"], ["closeout_lead", "Closeout lead"],
  ["executive", "Executive"], ["read_only_auditor", "Read-only auditor"]
] as const;

export function MemberAccessPanel({ workspace }: { workspace: WorkspaceKey }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("project_manager");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const response = await fetch(`/api/d5o-hosted/membership-access?workspace=${encodeURIComponent(workspace)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Role assignments are unavailable until the hosted membership migration is installed.");
    const data = await response.json() as { members?: Member[] };
    setMembers(Array.isArray(data.members) ? data.members : []);
  }
  useEffect(() => {
    let active = true;
    void fetch(`/api/d5o-hosted/membership-access?workspace=${encodeURIComponent(workspace)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Role assignments are unavailable until the hosted membership migration is installed.");
        return response.json() as Promise<{ members?: Member[] }>;
      })
      .then((data) => { if (active) setMembers(Array.isArray(data.members) ? data.members : []); })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Membership unavailable."); });
    return () => { active = false; };
  }, [workspace]);
  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const existing = members.find((item) => item.email.toLowerCase() === email.trim().toLowerCase());
    try {
      const response = await fetch(`/api/d5o-hosted/membership-access?workspace=${encodeURIComponent(workspace)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role, expectedRole: existing?.role ?? null, commandId: crypto.randomUUID() })
      });
      const data = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.message ?? data.error ?? "Role assignment failed.");
      await refresh(); setEmail(""); setMessage("Role assignment saved. The member's next sign-in will use this workspace role.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Role assignment failed."); }
    finally { setBusy(false); }
  }
  async function changeAccess(member: Member, action: "suspend" | "assign") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/d5o-hosted/membership-access?workspace=${encodeURIComponent(workspace)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email: member.email, role: member.role,
          expectedRole: member.role, commandId: crypto.randomUUID() })
      });
      const data = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.message ?? data.error ?? "Access change failed.");
      await refresh();
      setMessage(action === "suspend"
        ? "Workspace access suspended. Existing decisions remain in history; this account cannot open the workspace until restored."
        : "Workspace access restored for this confirmed account.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Access change failed."); }
    finally { setBusy(false); }
  }
  return <section className={styles.panel} aria-label="Workspace role assignments">
    <div className={styles.heading}><div><p>WORKSPACE ACCESS · SYSTEM ADMINISTRATOR</p><h2>Assign pilot roles</h2><span>Connect an existing confirmed sign-in account to one workspace role. Worker roster binding remains a separate assignment.</span></div></div>
    <form onSubmit={(event) => void assign(event)} className={styles.form}>
      <label>Confirmed account email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label>Workspace role<select value={role} onChange={(event) => setRole(event.target.value)}>{roles.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button type="submit" disabled={busy}>{busy ? "Saving…" : "Assign role"}</button>
    </form>
    <p role="status" aria-live="polite">{message}</p>
    <div className={styles.members}>{members.map((member) => <div key={member.userId}><strong>{member.email}</strong><span>{member.role.replaceAll("_", " ")} · {member.status}</span>{member.role !== "admin" && member.role !== "field_worker" ? <button type="button" disabled={busy} onClick={() => void changeAccess(member, member.status === "active" ? "suspend" : "assign")}>{member.status === "active" ? "Suspend access" : "Restore access"}</button> : null}</div>)}</div>
    <small>A sign-in account, workspace membership and worker roster person are separate. Creating a roster person does not create a login or send an invitation. These memberships govern the synthetic D5O pilot; assignment does not approve a business decision.</small>
  </section>;
}
