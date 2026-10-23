"use client";

import Link from "next/link";
import { useState } from "react";
import type { PlatformTemplate, ProvisionedTenant } from "@/lib/d5o/admin/platform-provisioning";
import styles from "@/app/platform-admin/platform-admin.module.css";

type Form = { legalName: string; displayName: string; workspaceKey: string;
  adminEmail: string; country: string; timeZone: string; currency: string;
  templateVersionId: string; reason: string };
const initial: Form = { legalName: "", displayName: "", workspaceKey: "", adminEmail: "",
  country: "US", timeZone: "America/New_York", currency: "USD", templateVersionId: "",
  reason: "Create customer using approved configuration template" };

export function PlatformProvisioningPanel({ tenants: startingTenants, templates: startingTemplates }:
  { tenants: ProvisionedTenant[]; templates: PlatformTemplate[] }) {
  const [tenants, setTenants] = useState(startingTenants);
  const [templates, setTemplates] = useState(startingTemplates);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [form, setForm] = useState<Form>(initial);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const approved = templates.filter((item) => item.status === "published" &&
    item.templateStatus === "active" && item.valid);
  const visible = tenants.filter((tenant) =>
    `${tenant.name} ${tenant.workspaceKey} ${tenant.initialAdministrator ?? ""}`.toLowerCase().includes(query.toLowerCase()) &&
    (status === "all" || tenant.status === status));
  const set = (field: keyof Form, value: string) => setForm((current) => ({ ...current, [field]: value }));
  async function refresh() {
    const response = await fetch("/api/d5o-platform/provisioning", { cache: "no-store" });
    const body = await response.json() as { tenants?: ProvisionedTenant[]; templates?: PlatformTemplate[]; error?: string };
    if (!response.ok || !body.tenants || !body.templates) throw Error(body.error ?? "Directory unavailable");
    setTenants(body.tenants); setTemplates(body.templates);
  }
  async function provision() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/d5o-platform/provisioning", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "provision", commandId: crypto.randomUUID(), ...form }) });
      const body = await response.json() as { error?: string; result?: { workspaceKey?: string } };
      if (!response.ok) throw Error(body.error ?? "Provisioning failed");
      await refresh(); setReview(false); setForm(initial);
      setMessage(`Customer ${body.result?.workspaceKey ?? ""} was provisioned. The initial invitation must be accepted before setup.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Provisioning failed"); }
    finally { setBusy(false); }
  }
  const selected = approved.find((item) => item.id === form.templateVersionId);
  return <>
    <section className={styles.section} aria-labelledby="create-customer"><h2 id="create-customer">Create customer</h2>
      <p>Provisioning creates an independent workspace and a tenant-owned configuration copy. It does not activate the customer.</p>
      {!review ? <form className={styles.form} onSubmit={(event) => {
        event.preventDefault(); setReview(true);
      }}>
        <label>Legal name<input required minLength={2} maxLength={120} value={form.legalName} onChange={(event) => set("legalName", event.target.value)} /></label>
        <label>Display name<input required minLength={2} maxLength={120} value={form.displayName} onChange={(event) => set("displayName", event.target.value)} /></label>
        <label>Tenant key<input required pattern="[a-z][a-z0-9_-]{2,63}" value={form.workspaceKey} onChange={(event) => set("workspaceKey", event.target.value)} /></label>
        <label>Initial administrator email<input required type="email" value={form.adminEmail} onChange={(event) => set("adminEmail", event.target.value)} /></label>
        <label>Country code<input required pattern="[A-Z]{2}" maxLength={2} value={form.country} onChange={(event) => set("country", event.target.value.toUpperCase())} /></label>
        <label>Time zone<input required value={form.timeZone} onChange={(event) => set("timeZone", event.target.value)} /></label>
        <label>Currency<input required pattern="[A-Z]{3}" maxLength={3} value={form.currency} onChange={(event) => set("currency", event.target.value.toUpperCase())} /></label>
        <label>Configuration template<select required value={form.templateVersionId} onChange={(event) => set("templateVersionId", event.target.value)}>
          <option value="">Select a published template</option>{approved.map((item) =>
            <option value={item.id} key={item.id}>{item.name} · v{item.version}</option>)}</select></label>
        <label className={styles.full}>Reason<textarea required minLength={8} maxLength={500} value={form.reason} onChange={(event) => set("reason", event.target.value)} /></label>
        <button type="submit">Review customer setup</button>
      </form> : <div className={styles.review}><h3>Review before provisioning</h3>
        <dl className={styles.details}><div><dt>Customer</dt><dd>{form.legalName}</dd></div>
          <div><dt>Tenant key</dt><dd>{form.workspaceKey}</dd></div>
          <div><dt>Initial administrator</dt><dd>{form.adminEmail}</dd></div>
          <div><dt>Template</dt><dd>{selected?.name} · v{selected?.version}</dd></div></dl>
        <p>New customers remain in setup until the recipient accepts and readiness is approved.</p>
        <div className={styles.actions}><button type="button" onClick={() => setReview(false)} disabled={busy}>Edit</button>
          <button type="button" onClick={() => void provision()} disabled={busy}>{busy ? "Provisioning…" : "Provision customer"}</button></div>
      </div>}
      {message && <p role="status" className={styles.notice}>{message}</p>}
    </section>
    <section className={styles.section} aria-labelledby="tenant-directory"><h2 id="tenant-directory">Tenant directory</h2>
      <div className={styles.filters}><label>Search tenants<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">All statuses</option>{["awaiting_admin", "setup_required", "ready", "active", "failed", "suspended"].map((item) =>
            <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label></div>
      <p role="status">{visible.length} of {tenants.length} tenants</p>
      {visible.length ? <div className={styles.tableWrap}><table><thead><tr>
        <th scope="col">Customer</th><th scope="col">Status</th><th scope="col">Template</th>
        <th scope="col">Initial administrator</th><th scope="col">Created</th><th scope="col">Details</th>
      </tr></thead><tbody>{visible.map((tenant) => <tr key={tenant.workspaceId}>
        <th scope="row">{tenant.name}<small>{tenant.workspaceKey}</small></th>
        <td>{tenant.status.replaceAll("_", " ")}</td><td>{tenant.templateName ?? "Legacy pilot"}</td>
        <td>{tenant.initialAdministrator ?? "Existing pilot"}<small>{tenant.invitationStatus ?? ""}</small></td>
        <td>{new Date(tenant.createdAt).toLocaleDateString()}</td>
        <td><Link href={`/platform-admin/tenants/${encodeURIComponent(tenant.workspaceKey)}`}>View tenant</Link></td>
      </tr>)}</tbody></table></div> : <p>No tenants match these filters.</p>}
    </section>
    <section className={styles.section} aria-labelledby="template-directory"><h2 id="template-directory">Configuration templates</h2>
      <p>Published versions are immutable. Applying a template creates an independent tenant version.</p>
      <div className={styles.tableWrap}><table><thead><tr><th scope="col">Template</th><th scope="col">Version</th>
        <th scope="col">Status</th><th scope="col">Validation</th><th scope="col">Usage</th></tr></thead>
        <tbody>{templates.map((item) => <tr key={item.id}><th scope="row">{item.name}<small>{item.description}</small></th>
          <td>v{item.version}</td><td>{item.templateStatus === "retired" ? "Retired" : item.status}</td>
          <td>{item.valid ? "Valid" : "Needs review"}</td><td>{item.usage}</td></tr>)}</tbody></table></div>
    </section>
  </>;
}
