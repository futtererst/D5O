"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type { WorkspaceKey } from "./work-types";
import { assignableWorkspaceRoles } from "./role-presentation";
import styles from "./MemberAccessPanel.module.css";

type Member = { membershipId: string; userId: string; email: string; confirmed: boolean;
  createdAt: string; lastSignInAt: string | null; role: string; status: string;
  personId: string | null; person: string | null; displayName: string | null;
  personActive: boolean | null; qualifications: string[] | null;
  weeklyCapacityHours: number | null; futureAssignments: number };
type Directory = { items: Member[]; total: number; offset: number };
type Invitation = { commandId: string; email: string; requestedRole: string | null;
  status: string; confirmed: boolean; membershipRole: string | null;
  membershipStatus: string | null; createdAt: string; setupCompletedAt: string | null };
type Pending = { commandId: string; payload: Record<string, unknown> };

export function MemberAccessPanel({ workspace, selectedUserId }: { workspace: WorkspaceKey; selectedUserId?: string }) {
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("project_manager");
  const [reason, setReason] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("project_manager");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [identityReason, setIdentityReason] = useState("");
  const [approvedRecipient, setApprovedRecipient] = useState(false);
  const [identityPending, setIdentityPending] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [retryReady, setRetryReady] = useState(false);
  const endpoint = `/api/d5o-hosted/membership-access?workspace=${encodeURIComponent(workspace)}`;
  const refresh = useCallback(async () => {
    const query = new URLSearchParams({ workspace, search: submittedSearch, offset: String(offset), limit: "25" });
    if (selectedUserId) query.set("userId", selectedUserId);
    const response = await fetch(`/api/d5o-hosted/admin-directory?${query}`, { cache: "no-store" });
    const body = await response.json() as Directory & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Directory unavailable");
    setDirectory(body);
  }, [workspace, submittedSearch, offset, selectedUserId]);
  const refreshInvitations = useCallback(async () => {
    const response = await fetch(`/api/d5o-hosted/admin-identity?workspace=${encodeURIComponent(workspace)}`,
      { cache: "no-store" });
    const body = await response.json() as { items?: Invitation[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Invitations unavailable");
    setInvitations(body.items ?? []);
  }, [workspace]);
  useEffect(() => { const timer = window.setTimeout(() => { void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Directory unavailable")); }, 0);
    return () => window.clearTimeout(timer); }, [refresh]);
  useEffect(() => { const timer = window.setTimeout(() => { void refreshInvitations().catch(() => {}); }, 0);
    return () => window.clearTimeout(timer); }, [refreshInvitations]);

  async function receipt(commandId: string) {
    const response = await fetch(`/api/d5o-hosted/admin-receipt?workspace=${encodeURIComponent(workspace)}&commandId=${encodeURIComponent(commandId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Receipt could not be checked. Keep this command pending and try reconciliation again.");
    return response.json() as Promise<{ found: boolean; source?: string; result?: { status?: string } }>;
  }
  async function reconcile() {
    if (!pending) return;
    setBusy(true);
    try {
      const current = await receipt(pending.commandId);
      if (current.found) { await refresh(); setPending(null); setRetryReady(false); setMessage("The original command committed. No second change was sent."); }
      else { setRetryReady(true); setMessage("No receipt exists yet. You may retry the original command with its retained identity and exact input."); }
    } catch (error) { setRetryReady(false); setMessage(error instanceof Error ? error.message : "Receipt unavailable"); }
    finally { setBusy(false); }
  }
  async function retryOriginal() {
    if (!pending || !retryReady) return;
    setBusy(true); setRetryReady(false);
    try {
      const current = await receipt(pending.commandId);
      if (current.found) {
        await refresh(); setPending(null); setMessage("The original command committed. No second change was sent."); return;
      }
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...pending.payload, commandId: pending.commandId }) });
      const body = await response.json() as { error?: string; message?: string };
      if (!response.ok) {
        if (response.status === 503) throw new Error("The retry outcome is uncertain.");
        setPending(null); await refresh();
        setMessage(body.message ?? `${body.error ?? "Change rejected"}. Your input remains available; compare current access before a new command.`);
        return;
      }
      await refresh(); setPending(null);
      setMessage("The original command was saved once. Workspace access and roster identity remain separate.");
      if (pending.payload.action !== "suspend") setEmail("");
    } catch {
      try {
        const current = await receipt(pending.commandId);
        if (current.found) { await refresh(); setPending(null); setMessage("The original command committed despite the lost response. No duplicate was sent."); }
        else setMessage("The retry outcome remains uncertain. Your input and command identity are retained; check the receipt again.");
      } catch { setMessage("The retry and receipt checks are unavailable. Your input and command identity are retained; check again before another retry."); }
    } finally { setBusy(false); }
  }
  async function change(payload: Record<string, unknown>) {
    if (pending) { setMessage("Resolve the pending command before starting a different access change."); return; }
    const command: Pending = { commandId: crypto.randomUUID(), payload };
    setPending(command); setRetryReady(false); setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, commandId: command.commandId }) });
      const body = await response.json() as { error?: string; message?: string };
      if (!response.ok) {
        if (response.status === 503) throw new Error("The response is uncertain; check the command receipt before retrying.");
        setPending(null); await refresh();
        setMessage(body.message ?? `${body.error ?? "Change rejected"}. Your input remains available; compare current access before submitting again.`);
        return;
      }
      await refresh(); setPending(null); setMessage("Workspace access saved. Sign-in account and roster person remain separate.");
      if (payload.action !== "suspend") setEmail("");
    } catch {
      try {
        const current = await receipt(command.commandId);
        if (current.found) { await refresh(); setPending(null); setMessage("The change committed despite the lost response. No duplicate was sent."); }
        else setMessage("Save outcome uncertain. Your input is retained; recheck the receipt before retrying.");
      } catch { setMessage("Save and receipt checks are unavailable. Your input and command identity are retained; do not submit a new command yet."); }
    } finally { setBusy(false); }
  }
  function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const existing = directory?.items.find((item) => item.email.toLowerCase() === email.trim().toLowerCase());
    void change({ action: "assign", email: email.trim(), role, expectedRole: existing?.role ?? null,
      expectedStatus: existing?.status ?? null, reason: reason.trim() });
  }
  async function identity(action: "invite" | "recovery", address: string) {
    const commandId = identityPending || crypto.randomUUID();
    setIdentityPending(commandId); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/d5o-hosted/admin-identity", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          workspace, action, email: address, role: action === "invite" ? inviteRole : null,
          reason: identityReason.trim(), approvedRecipient,
          commandId,
        }) });
      const body = await response.json() as { status?: string; message?: string; error?: string };
      if (!response.ok && response.status !== 503) { setIdentityPending(""); setMessage(body.message ?? body.error ?? "Request rejected"); return; }
      setMessage(body.message ?? "Provider outcome unresolved. Do not send another request.");
      if (body.status && body.status !== "uncertain") setIdentityPending("");
      if (body.status === "existing_confirmed") { setEmail(address); setRole(inviteRole); }
      void refreshInvitations().catch(() => setMessage("Request result retained, but the invitation list could not be refreshed. Reload or inspect Audit before another request."));
    } catch { setMessage("Provider response was lost. Check this command in Audit or with the administrator before any new request."); }
    finally { setBusy(false); }
  }
  const selected = selectedUserId ? directory?.items.find((item) => item.userId === selectedUserId) : null;
  return <section className={styles.panel} aria-label="Workspace users and access">
    <div className={styles.heading}><div><p>USERS & ACCESS · WORKSPACE ADMINISTRATOR</p><h2>{selected ? selected.email : "Workspace user directory"}</h2>
      <span>A sign-in account, workspace membership and roster person are separate. A roster record never creates a login or sends an invitation.</span></div></div>
    {selectedUserId && <p><Link href={`/work/admin/users?workspace=${workspace}`}>← All users</Link></p>}
    <p role="status" aria-live="polite">{message}</p>
    {pending && <div><p>Pending command {pending.commandId}. Its original input remains retained in this tab.</p>
      <button type="button" disabled={busy} onClick={() => void reconcile()}>Check original command receipt</button>
      {retryReady && <button type="button" disabled={busy} onClick={() => void retryOriginal()}>Retry original command</button>}</div>}
    {identityPending && <div><p>Identity request {identityPending} has an uncertain outcome. No second email request will be sent.</p>
      <button type="button" disabled={busy} onClick={() => void receipt(identityPending).then((current) => {
        if (!current.found || current.result?.status === "pending" || current.result?.status === "uncertain")
          setMessage("The provider outcome remains unresolved. Check the approved mailbox or Auth provider before initiating another request.");
        else { setMessage(`Retained provider status: ${current.result?.status}. Delivery is not proven by this status.`); setIdentityPending(""); }
      }).catch(() => setMessage("Receipt unavailable. Do not repeat the email request."))}>Check identity request</button></div>}
    {!selectedUserId && <><form onSubmit={(event) => { event.preventDefault(); setOffset(0); setSubmittedSearch(search); }} className={styles.form}>
      <label>Search workspace accounts<input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={120} placeholder="Email or roster name" /></label>
      <button type="submit">Search</button></form>
      <form onSubmit={assign} className={styles.form}>
        <label>Existing confirmed sign-in email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Workspace role<select value={role} onChange={(event) => setRole(event.target.value)}>{assignableWorkspaceRoles.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Reason for access change<input value={reason} onChange={(event) => setReason(event.target.value)} minLength={8} maxLength={500} required /></label>
        <button type="submit" disabled={busy || Boolean(pending)}>{busy ? "Saving…" : "Assign or change role"}</button>
      </form></>}
    {!selectedUserId && <details><summary>Invite a synthetic sign-in account</summary>
      <p>Select the proposed workspace role. The Auth provider sends the setup email; an administrator makes a separate membership decision after recipient verification. Existing confirmed accounts use that membership decision without another Auth account or invitation email.</p>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void identity("invite", identityEmail.trim()); }}>
        <label>Approved synthetic mailbox<input type="email" required value={identityEmail} onChange={(event) => setIdentityEmail(event.target.value)} /></label>
        <label>Proposed workspace role<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
          {assignableWorkspaceRoles.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label>Reason<input required minLength={8} value={identityReason} onChange={(event) => setIdentityReason(event.target.value)} /></label>
        <label><input type="checkbox" checked={approvedRecipient} onChange={(event) => setApprovedRecipient(event.target.checked)} required /> I confirm this is an approved synthetic test recipient.</label>
        <button disabled={busy || Boolean(identityPending)}>Request invitation</button>
      </form><small>Provider acceptance is not proof of email delivery. Invitation tokens are never shown here or retained in the audit.</small>
    </details>}
    {!selectedUserId && <section aria-label="Recent invitation requests">
      <h3>Recent invitations</h3>
      <button type="button" disabled={busy} onClick={() => void refreshInvitations().catch(() => setMessage("Invitation status could not be refreshed."))}>Refresh status</button>
      {invitations.length === 0 && <p>No invitation requests recorded.</p>}
      {invitations.map((item) => <div key={item.commandId}>
        <strong>{item.email}</strong> · proposed {item.requestedRole?.replaceAll("_", " ") ?? "unknown"} · {item.status.replaceAll("_", " ")}
        {item.membershipStatus ? ` · current access: ${item.membershipRole?.replaceAll("_", " ")} (${item.membershipStatus})` : " · no workspace membership"}
        {(item.status === "setup_completed" || item.status === "existing_confirmed") && item.requestedRole
          && !item.membershipStatus && <button type="button" onClick={() => {
            setEmail(item.email); setRole(item.requestedRole!);
            setMessage("Recipient identity is confirmed. Review the role and reason, then submit the separate membership decision.");
          }}>Prepare membership decision</button>}
      </div>)}
    </section>}
    {selected ? <article><p><b>Sign-in:</b> {selected.confirmed ? "Confirmed" : "Unconfirmed"} · created {new Date(selected.createdAt).toLocaleString()}
      {selected.lastSignInAt ? ` · last sign-in ${new Date(selected.lastSignInAt).toLocaleString()}` : " · no recorded sign-in"}</p>
      <p><b>Membership:</b> {selected.role.replaceAll("_", " ")} · {selected.status}</p>
      <p><b>Roster:</b> {selected.person ? `${selected.displayName} (${selected.person}) · ${selected.personActive ? "active" : "inactive"} · ${selected.weeklyCapacityHours}h/week` : "No linked roster person"}</p>
      {selected.qualifications?.length ? <p>Recorded qualifications: {selected.qualifications.join(", ")}</p> : null}
      <p><b>Future assignment dependencies:</b> {selected.futureAssignments} current schedule assignment(s). Review these in Crew before changing access; history is retained.</p>
      {selected.role !== "admin" && selected.role !== "field_worker" && <div>
        <label>Reason for this change<input value={reason} onChange={(event) => setReason(event.target.value)} minLength={8} maxLength={500} /></label>
        <button type="button" disabled={busy || Boolean(pending) || reason.trim().length < 8} onClick={() => void change({ action: selected.status === "active" ? "suspend" : "assign", email: selected.email, role: selected.role, expectedRole: selected.role, expectedStatus: selected.status, reason: reason.trim() })}>
          {selected.status === "active" ? "Suspend workspace access" : "Restore workspace access"}</button>
        <p>Suspension changes workspace access, not the Auth account or roster status. Existing decisions remain attributed to this user.</p></div>}
      {selected.role === "field_worker" && <p>Worker membership is managed through the Workforce account binding. Correct the roster binding there.</p>}
      {selected.role === "admin" && <p>Administrator membership is protected from ordinary role changes and suspension.</p>}
      <details><summary>Initiate account recovery</summary>
        <p>This sends a provider recovery request to the account email. It does not change workspace role, roster status or password directly.</p>
        <label>Reason<input required minLength={8} value={identityReason} onChange={(event) => setIdentityReason(event.target.value)} /></label>
        <label><input type="checkbox" checked={approvedRecipient} onChange={(event) => setApprovedRecipient(event.target.checked)} /> Approved synthetic mailbox</label>
        <button type="button" disabled={busy || Boolean(identityPending) || !approvedRecipient || identityReason.trim().length < 8}
          onClick={() => void identity("recovery", selected.email)}>Request recovery email</button>
        <small>Provider acceptance and delivery are separate. An uncertain response is never automatically resent.</small>
      </details>
      {selected.role !== "admin" && selected.role !== "field_worker" && <details><summary>Protected administrator succession</summary>
        <p>This adds a confirmed, independent administrator. It does not remove the current administrator or change a roster binding.</p>
        <label>Recorded succession reason<input value={reason} onChange={(event) => setReason(event.target.value)} minLength={12} maxLength={500} /></label>
        <button type="button" disabled={busy || Boolean(pending) || reason.trim().length < 12}
          onClick={() => { if (window.confirm(`Grant administrator access to ${selected.email}?`)) void change({ action: "succession", email: selected.email, reason: reason.trim() }); }}>
          Add administrator</button></details>}
      <p><Link href={`/work/admin/audit?workspace=${workspace}&subject=${selected.userId}`}>Inspect retained changes →</Link></p>
    </article> : selectedUserId ? <p role="status">No member with this identity is visible in this workspace.</p> : <>
      <div className={styles.members}>{directory?.items.map((member) => <div key={member.userId}>
        <strong>{member.email}</strong><span>{member.role.replaceAll("_", " ")} · {member.status} · {member.confirmed ? "confirmed" : "unconfirmed"}</span>
        <small>{member.displayName ? `Roster: ${member.displayName}` : "No roster binding"}</small>
        <Link href={`/work/admin/users/${member.userId}?workspace=${workspace}`}>View details →</Link>
      </div>)}{directory?.items.length === 0 && <p>No matching workspace members.</p>}</div>
      <div><button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button>
        <span> {directory?.total ?? 0} members </span><button type="button" disabled={!directory || offset + 25 >= directory.total} onClick={() => setOffset(offset + 25)}>Next</button></div>
    </>}
    <small>Member assignment requires an existing confirmed account. Business Development can work in Discover; Closeout currently has a read-only hosted view. Neither gains administrative rights.</small>
  </section>;
}
