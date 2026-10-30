"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { assignableWorkspaceRoles } from "@/components/d5o/platform/role-presentation";
import styles from "./OrgAdminPanel.module.css";

type Kind = "overview" | "units" | "locations" | "teams" | "people" | "invitations" | "roles" | "activity";
type Item = Record<string, unknown>;
type Page = { items?: Item[]; total?: number; offset?: number; organization?: Item;
  units?: number; locations?: number; teams?: number; members?: number };
const label = (value: unknown) => value == null ? "" : String(value);
const id = (row: Item) => label(row.id);
const status = (row: Item) => label(row.status);
const roleLabels = Object.fromEntries(assignableWorkspaceRoles);
const invitationLabels: Record<string, string> = { pending: "Pending delivery", provider_accepted: "Provider accepted · delivery unverified",
  provider_rejected: "Delivery failed", uncertain: "Delivery uncertain", existing_confirmed: "Existing user · awaiting acceptance",
  setup_completed: "Account setup complete", accepted: "Accepted", revoked: "Revoked", expired: "Expired" };
const roleOptions = assignableWorkspaceRoles.map(([key, name]) => <option key={key} value={key}>{name}</option>);

export function OrgAdminPanel({ workspace, kind, settingsOnly = false }: {
  workspace: string; kind: Kind; settingsOnly?: boolean }) {
  const [page, setPage] = useState<Page | null>(null);
  const [people, setPeople] = useState<Item[]>([]);
  const [units, setUnits] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Item[]>([]);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Item | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [successionMode, setSuccessionMode] = useState<"grant" | "restore">("grant");
  const [pendingSuccession, setPendingSuccession] = useState<{
    action: "grant" | "restore"; target: Item; reason: string } | null>(null);
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    target: Item; role: string; reason: string } | null>(null);
  const endpoint = "/api/d5o-hosted/org-admin";
  const read = useCallback(async (section: string, query = "", pageOffset = 0) => {
    const params = new URLSearchParams({ workspace, kind: section, search: query,
      offset: String(pageOffset), limit: "25" });
    const response = await fetch(`${endpoint}?${params}`, { cache: "no-store" });
    const body = await response.json() as Page & { error?: string };
    if (!response.ok) throw Error(body.error ?? "Administration data unavailable");
    return body;
  }, [workspace]);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [main, members, orgUnits, orgLocations] = await Promise.all([
        read(kind, submittedSearch, offset), read("people"), read("units"), read("locations")]);
      setPage(main); setPeople(members.items ?? []); setUnits(orgUnits.items ?? []);
      setLocations(orgLocations.items ?? []); setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Administration data unavailable"); }
    finally { setLoading(false); }
  }, [kind, offset, read, submittedSearch]);
  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer); }, [refresh]);

  async function command(action: string, subject: Item | null, data: Item, reason: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace, action, id: subject && id(subject) ? id(subject) : null,
          data, expectedRevision: subject ? Number(subject.revision ?? 0) : 0,
          reason, commandId: crypto.randomUUID() }) });
      const body = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw Error(body.message ?? body.error ?? "Change rejected");
      setEditing(null); await refresh(); setMessage("Change saved and recorded in Administration activity.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Change rejected"); }
    finally { setBusy(false); }
  }

  async function invite(action: "invitation.request" | "invitation.revoke", data: Item) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace, action, ...data, commandId: crypto.randomUUID() }) });
      const body = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw Error(body.message ?? body.error ?? "Invitation rejected");
      await refresh(); setMessage(body.message ?? "Invitation decision recorded.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Invitation rejected"); }
    finally { setBusy(false); }
  }

  async function succession(action: "grant" | "restore", target: Item, reason: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace, action: `member.admin-${action}`, email: label(target.email),
          expectedRevision: Number(target.revision), reason, commandId: crypto.randomUUID() }) });
      const body = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw Error(body.message ?? body.error ?? "Administrator decision rejected");
      await refresh(); setMessage("Administrator decision saved in the tenant audit history.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Administrator decision rejected"); }
    finally { setBusy(false); }
  }

  function saveRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = label(form.get("reason")).trim();
    const common = { code: label(form.get("code")).trim().toUpperCase(),
      name: label(form.get("name")).trim(), description: label(form.get("description")).trim() };
    const data = kind === "units" ? { ...common, parentId: label(form.get("parentId")),
      managerUserId: label(form.get("managerUserId")) }
      : kind === "locations" ? { ...common, country: label(form.get("country")).trim().toUpperCase(),
        timeZone: label(form.get("timeZone")).trim(), unitId: label(form.get("unitId")),
        address: { line1: label(form.get("line1")).trim(), city: label(form.get("city")).trim(),
          region: label(form.get("region")).trim(), postalCode: label(form.get("postalCode")).trim() } }
        : { ...common, unitId: label(form.get("unitId")), locationId: label(form.get("locationId")),
          managerUserId: label(form.get("managerUserId")) };
    const noun = kind === "units" ? "unit" : kind === "locations" ? "location" : "team";
    void command(`${noun}.${editing && id(editing) ? "update" : "create"}`, editing, data, reason);
  }
  const options = (rows: Item[], exclude?: string) => <><option value="">None</option>
    {rows.filter((row) => status(row) === "active" && id(row) !== exclude).map((row) =>
      <option key={id(row)} value={id(row)}>{label(row.name ?? row.email)}</option>)}</>;
  const managerOptions = () => <><option value="">None</option>{people.filter((row) => status(row) === "active")
    .map((row) => <option key={label(row.actor_user_id)} value={label(row.actor_user_id)}>{label(row.email)}</option>)}</>;
  const records = page?.items ?? [];
  const name = kind === "units" ? "Business units" : kind === "locations" ? "Locations" : "Teams";
  return <div className={styles.root}>
    {message && <p className={styles.message} role="status">{message}</p>}
    {loading && <p role="status">Loading {kind}…</p>}
    {kind === "overview" && page?.organization && <>
      <p className={styles.intro}>Maintain the organization identity used by D5O work, workforce and administration.</p>
      {!settingsOnly && <><dl className={styles.metrics}><div><dt>Business units</dt><dd>{page.units}</dd></div>
        <div><dt>Locations</dt><dd>{page.locations}</dd></div><div><dt>Teams</dt><dd>{page.teams}</dd></div>
        <div><dt>Active members</dt><dd>{page.members}</dd></div></dl>
        <div className={styles.form}><h2>Organization profile</h2>
          <p><strong>{label(page.organization.displayName)}</strong> · {label(page.organization.name || "Legal name not set")}</p>
          <p>Primary contact: {label(page.organization.contactEmail) || "Not set"}<br />
            Time zone: {label(page.organization.timeZone)} · Currency: {label(page.organization.currency)}</p>
          <a href={`/work/admin/organization-settings?workspace=${encodeURIComponent(workspace)}`}>Edit organization settings</a>
        </div></>}
      {settingsOnly && <form className={styles.form} onSubmit={(event) => { event.preventDefault(); const f = new FormData(event.currentTarget);
        void command("organization.save", { id: page.organization?.id, revision: page.organization?.revision }, {
          name: label(f.get("name")), displayName: label(f.get("displayName")),
          contactEmail: label(f.get("contactEmail")), timeZone: label(f.get("timeZone")),
          currency: label(f.get("currency")).toUpperCase(), branding: page.organization?.branding ?? {} },
        label(f.get("reason"))); }}>
        <h2>Organization settings</h2>
        <label>Legal name<input name="name" defaultValue={label(page.organization.name ?? page.organization.displayName)} required /></label>
        <label>Display name<input name="displayName" defaultValue={label(page.organization.displayName)} required /></label>
        <label>Primary contact email<input name="contactEmail" type="email" defaultValue={label(page.organization.contactEmail)} /></label>
        <label>Time zone<input name="timeZone" defaultValue={label(page.organization.timeZone)} required /></label>
        <label>Default currency<input name="currency" maxLength={3} defaultValue={label(page.organization.currency)} required /></label>
        <label>Change reason<input name="reason" minLength={8} required /></label>
        <div className={styles.actions}><button disabled={busy}>Save organization</button></div>
      </form>}
    </>}
    {(["units", "locations", "teams"] as const).includes(kind as "units" | "locations" | "teams") && <>
      <div className={styles.toolbar}><p className={styles.intro}>Stable codes and history remain when records are renamed or retired.</p>
        <button type="button" onClick={() => setEditing({})}>Create {name.slice(0, -1).toLowerCase()}</button></div>
      <form className={styles.search} onSubmit={(event) => { event.preventDefault(); setOffset(0); setSubmittedSearch(search); }}>
        <label>Search {name.toLowerCase()}<input value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <button>Search</button></form>
      {records.length ? <div className={styles.tableWrap}><table><thead><tr><th scope="col">Code</th><th scope="col">Name</th>
        <th scope="col">Status</th><th scope="col">Updated</th><th scope="col">Actions</th></tr></thead><tbody>
        {records.map((row) => <tr key={id(row)}><td>{label(row.code)}</td><td>{label(row.name)}</td>
          <td><span className={status(row) === "active" ? styles.active : styles.inactive}>{status(row)}</span></td>
          <td>{label(row.updated_at).slice(0, 10)}</td><td className={styles.actions}>
            <button type="button" onClick={() => setEditing(row)}>Edit</button>
            {status(row) === "active" && <button type="button" disabled={busy} onClick={() => {
              if (window.confirm(`Retire ${label(row.name)}? Historical references will remain.`))
                void command(`${kind === "units" ? "unit" : kind === "locations" ? "location" : "team"}.retire`,
                  row, {}, `Retire ${label(row.name)} by administrator`);
            }}>Retire</button>}</td></tr>)}</tbody></table></div> : !loading && <p className={styles.empty}>No {name.toLowerCase()} match this search.</p>}
      {kind === "teams" && records.map((row) => <div key={`members-${id(row)}`} className={styles.members}>
        <h3>{label(row.name)} members</h3><p>{((row.members as Item[] | undefined) ?? []).map((member) => label(member.name)).join(", ") || "No active members"}</p>
        <form onSubmit={(event) => { event.preventDefault(); const f = new FormData(event.currentTarget);
          void command("team-member.add", null, { teamId: id(row), memberUserId: label(f.get("memberUserId")) }, label(f.get("reason"))); }}>
          <label>Add member<select name="memberUserId" required><option value="">Choose a member</option>
            {people.filter((person) => status(person) === "active").map((person) => <option key={label(person.actor_user_id)} value={label(person.actor_user_id)}>{label(person.email)}</option>)}</select></label>
          <label>Reason<input name="reason" minLength={8} required /></label><button disabled={busy}>Add to team</button>
        </form>
        {((row.members as Item[] | undefined) ?? []).map((member) => <button key={id(member)} type="button" disabled={busy}
          onClick={() => { if (window.confirm(`End ${label(member.name)}’s team assignment?`))
            void command("team-member.end", member, {}, `End team assignment for ${label(member.name)}`); }}>
          End {label(member.name)} assignment</button>)}
      </div>)}
      {editing && <form className={styles.form} onSubmit={saveRecord} key={id(editing) || "new"}>
        <h2>{id(editing) ? "Edit" : "Create"} {name.slice(0, -1).toLowerCase()}</h2>
        <label>Code<input name="code" defaultValue={label(editing.code)} maxLength={32} required /></label>
        <label>Name<input name="name" defaultValue={label(editing.name)} required /></label>
        {kind !== "locations" && <label>Description<textarea name="description" defaultValue={label(editing.description)} /></label>}
        {kind === "units" && <><label>Parent business unit<select name="parentId" defaultValue={label(editing.parent_id)}>
          {options(units, id(editing))}</select></label>
          <label>Manager<select name="managerUserId" defaultValue={label(editing.manager_user_id)}>{managerOptions()}</select></label></>}
        {kind === "locations" && <><label>Address line<input name="line1" defaultValue={label((editing.address as Item | undefined)?.line1)} /></label>
          <label>City<input name="city" defaultValue={label((editing.address as Item | undefined)?.city)} /></label>
          <label>Region<input name="region" defaultValue={label((editing.address as Item | undefined)?.region)} /></label>
          <label>Postal code<input name="postalCode" defaultValue={label((editing.address as Item | undefined)?.postalCode)} /></label>
          <label>Country code<input name="country" maxLength={2} defaultValue={label(editing.country || "US")} required /></label>
          <label>Time zone<input name="timeZone" defaultValue={label(editing.time_zone || "America/New_York")} required /></label>
          <label>Business unit<select name="unitId" defaultValue={label(editing.unit_id)}>{options(units)}</select></label></>}
        {kind === "teams" && <><label>Business unit<select name="unitId" defaultValue={label(editing.unit_id)}>{options(units)}</select></label>
          <label>Primary location<select name="locationId" defaultValue={label(editing.primary_location_id)}>{options(locations)}</select></label>
          <label>Manager<select name="managerUserId" defaultValue={label(editing.manager_user_id)}>{managerOptions()}</select></label></>}
        <label>Change reason<input name="reason" minLength={8} required /></label>
        <div className={styles.actions}><button disabled={busy}>Save {name.slice(0, -1).toLowerCase()}</button>
          <button type="button" onClick={() => setEditing(null)}>Cancel</button></div>
      </form>}
    </>}
    {kind === "people" && <><p className={styles.intro}>Membership controls application access. A workforce profile may exist without a login.</p>
      <form className={styles.search} onSubmit={(event) => { event.preventDefault(); setOffset(0); setSubmittedSearch(search); }}>
        <label>Search people<input value={search} onChange={(event) => setSearch(event.target.value)} /></label><button>Search</button></form>
      {records.length ? <div className={styles.tableWrap}><table><thead><tr><th>Email</th><th>Role</th><th>Workforce</th><th>Status</th><th>Access</th></tr></thead>
        <tbody>{records.map((row) => <tr key={id(row)}><td>{label(row.email)}</td><td>{roleLabels[label(row.role)] ?? label(row.role)}</td>
          <td>{label(row.person_name) || "No linked workforce profile"}
            {Boolean(row.person_id) && <form className={styles.personAssignment} onSubmit={(event) => { event.preventDefault();
              const f = new FormData(event.currentTarget); void command("person.assign",
                { id: row.person_id, revision: row.person_revision },
                { unitId: label(f.get("unitId")), locationId: label(f.get("locationId")) },
                `Update workforce organization for ${label(row.email)}`); }}>
              <label>Business unit<select name="unitId" defaultValue={label(row.primary_unit_id)}>{options(units)}</select></label>
              <label>Location<select name="locationId" defaultValue={label(row.primary_location_id)}>{options(locations)}</select></label>
              <button type="submit" disabled={busy}>Assign</button></form>}</td>
          <td>{status(row)}</td><td><div className={styles.actions}>
            {status(row) === "active" && !["admin", "field_worker"].includes(label(row.role)) && <>
              <select aria-label={`New role for ${label(row.email)}`}
                value={pendingRoleChange && id(pendingRoleChange.target) === id(row)
                  ? pendingRoleChange.role : label(row.role)}
                onChange={(event) => setPendingRoleChange({ target: row, role: event.target.value, reason: "" })}>
                {roleOptions}</select>
              <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Suspend ${label(row.email)}?`))
                void command("member.suspend", row, {}, `Suspend access for ${label(row.email)}`); }}>Suspend</button></>}
            {status(row) === "suspended" && <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Reactivate ${label(row.email)}?`))
              void command("member.reactivate", row, {}, `Reactivate access for ${label(row.email)}`); }}>Reactivate</button>}
            {!["admin", "field_worker"].includes(label(row.role)) && status(row) !== "removed" &&
              <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Remove ${label(row.email)} from this tenant?`))
                void command("member.remove", row, {}, `Remove tenant access for ${label(row.email)}`); }}>Remove access</button>}
          </div></td></tr>)}</tbody></table></div> : !loading && <p className={styles.empty}>No members match this search.</p>}
      {pendingRoleChange && <div role="alert" className={styles.form}>
        <p>Change <strong>{label(pendingRoleChange.target.email)}</strong> to <strong>{roleLabels[pendingRoleChange.role]}</strong> in this tenant?</p>
        <label>Recorded reason<input minLength={8} maxLength={500} value={pendingRoleChange.reason}
          onChange={(event) => setPendingRoleChange({ ...pendingRoleChange, reason: event.target.value })} /></label>
        <div className={styles.actions}>
          <button type="button" disabled={busy || pendingRoleChange.reason.trim().length < 8}
            onClick={() => { const decision = pendingRoleChange; setPendingRoleChange(null);
              void command("member.role", decision.target, { role: decision.role }, decision.reason.trim()); }}>
            Confirm role change</button>
          <button type="button" disabled={busy} onClick={() => setPendingRoleChange(null)}>Cancel</button>
        </div>
      </div>}
      <details><summary>Protected administrator succession</summary>
        <p>A separate administrator may grant a confirmed tenant member administrator access, then restore that member’s prior role. Decisions are audited; the last active administrator cannot be removed.</p>
        <form className={styles.form} onSubmit={(event) => { event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const target = records.find((row) => id(row) === label(fields.get("targetId")));
          const reason = label(fields.get("reason")).trim();
          if (target && reason.length >= 12) setPendingSuccession({ action: successionMode, target, reason });
        }}>
          <label>Decision<select value={successionMode} onChange={(event) => {
            setSuccessionMode(event.target.value as "grant" | "restore"); setPendingSuccession(null); }}>
            <option value="grant">Grant independent administrator access</option>
            <option value="restore">Restore a successor’s previous role</option>
          </select></label>
          <label>Tenant member<select name="targetId" key={successionMode} required defaultValue="">
            <option value="">Select a member</option>
            {records.filter((row) => status(row) === "active" && (successionMode === "grant"
              ? !["admin", "field_worker"].includes(label(row.role)) : label(row.role) === "admin"))
              .map((row) => <option key={id(row)} value={id(row)}>{label(row.email)}</option>)}
          </select></label>
          <label>Recorded reason<input name="reason" minLength={12} maxLength={500} required /></label>
          <button disabled={busy}>Review protected decision</button>
        </form>
        {pendingSuccession && <div role="alert" className={styles.form}>
          <p>{pendingSuccession.action === "grant" ? "Grant independent administrator access to" : "Restore the prior role for"} <strong>{label(pendingSuccession.target.email)}</strong> in this tenant?</p>
          <p>Reason: {pendingSuccession.reason}</p>
          <div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => {
              const decision = pendingSuccession; setPendingSuccession(null);
              void succession(decision.action, decision.target, decision.reason);
            }}>Confirm protected decision</button>
            <button type="button" disabled={busy} onClick={() => setPendingSuccession(null)}>Cancel</button>
          </div>
        </div>}
      </details></>}
    {(["invitations", "activity"] as string[]).includes(kind) && <form className={styles.search}
      onSubmit={(event) => { event.preventDefault(); setOffset(0); setSubmittedSearch(search); }}>
      <label>Search {kind}<input value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <button>Search</button></form>}
    {kind === "invitations" && <><p className={styles.intro}>An invitation grants access only after the matching authenticated recipient accepts it. Live email remains limited to approved pilot recipients.</p>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); const f = new FormData(event.currentTarget);
        const days = Number(f.get("days")); void invite("invitation.request", {
          email: label(f.get("email")), role: label(f.get("role")),
          expiresAt: new Date(Date.now() + days * 86400000).toISOString(), reason: label(f.get("reason")) }); }}>
        <h2>Invite a member</h2><label>Email<input name="email" type="email" required /></label>
        <label>Approved role<select name="role">{roleOptions}</select></label>
        <label>Expires in days<input name="days" type="number" min={1} max={30} defaultValue={14} required /></label>
        <label>Reason<input name="reason" minLength={8} required /></label><button disabled={busy}>Create invitation</button>
      </form>
      {records.length ? <div className={styles.tableWrap}><table><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Expires</th><th>Actions</th></tr></thead>
        <tbody>{records.map((row) => <tr key={label(row.command_id)}><td>{label(row.target_email)}</td>
          <td>{roleLabels[label(row.requested_role)] ?? label(row.requested_role)}</td>
          <td>{invitationLabels[label(row.effective_status)] ?? label(row.effective_status)}</td>
          <td>{label(row.expires_at).slice(0, 10)}</td><td className={styles.actions}>
            {["existing_confirmed", "provider_accepted", "setup_completed"].includes(label(row.effective_status)) &&
              <a href={`/work/invitation?workspace=${encodeURIComponent(workspace)}&request=${encodeURIComponent(label(row.command_id))}`}>Acceptance page</a>}
            {!["accepted", "revoked", "expired"].includes(label(row.effective_status)) &&
              <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Revoke invitation for ${label(row.target_email)}?`))
                void invite("invitation.revoke", { inviteId: row.command_id,
                  reason: `Revoke invitation for ${label(row.target_email)}` }); }}>Revoke</button>}
            {["expired", "revoked", "provider_rejected"].includes(label(row.effective_status)) &&
              <button type="button" disabled={busy} onClick={() => void invite("invitation.request", {
                email: row.target_email, role: row.requested_role,
                expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
                reason: `Resend invitation for ${label(row.target_email)}` })}>Resend</button>}
          </td></tr>)}</tbody></table></div> : !loading && <p className={styles.empty}>No invitations yet.</p>}
    </>}
    {kind === "roles" && <><p className={styles.intro}>These are existing hosted membership roles. Team assignment alone grants no business permission.</p>
      <div className={styles.tableWrap}><table><thead><tr><th>Role</th><th>Administration</th><th>Primary scope</th><th>Assignment</th></tr></thead>
        <tbody><tr><td>Tenant administrator</td><td>Organization, people, configuration</td><td>Own tenant</td><td>Protected succession</td></tr>
          {assignableWorkspaceRoles.map(([key, display]) => <tr key={key}><td>{display}</td><td>None</td>
            <td>{key === "operations_leader" ? "Operations and approvals" : key === "project_manager" ? "Project delivery" :
              key === "billing_commercial_lead" ? "Finance and commercial" : key === "field_supervisor" ? "Field execution" :
              key === "read_only_auditor" || key === "executive" ? "Read-only visibility" : "Assigned operating phase"}</td>
            <td>Tenant administrator</td></tr>)}
          <tr><td>Field worker</td><td>None</td><td>Bound workforce and assigned field work</td>
            <td>Protected workforce binding</td></tr></tbody></table></div></>}
    {kind === "activity" && <><p className={styles.intro}>Organization, invitation and access decisions are retained with actor and reason.</p>
      {records.length ? <div className={styles.tableWrap}><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Reason</th></tr></thead>
        <tbody>{records.map((row, index) => <tr key={`${label(row.occurred_at)}-${index}`}><td>{label(row.occurred_at).replace("T", " ").slice(0, 19)}</td>
          <td>{label(row.actor_email)}</td><td>{label(row.action)}</td><td>{label(row.reason)}</td></tr>)}</tbody></table></div>
        : !loading && <p className={styles.empty}>No Phase 2A administration changes yet.</p>}</>}
    {kind !== "overview" && kind !== "roles" && (page?.total ?? 0) > 25 && <div className={styles.pagination}>
      <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button>
      <span>{offset + 1}–{Math.min(offset + 25, page?.total ?? 0)} of {page?.total}</span>
      <button type="button" disabled={offset + 25 >= (page?.total ?? 0)} onClick={() => setOffset(offset + 25)}>Next</button>
    </div>}
  </div>;
}
