"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { WorkspaceKey } from "./work-types";

type Member = { actorId: string; role: string; email: string };
type Rule = { id: string; category: string; kind: string; actor_user_id: string; role_name: string;
  currency: string; max_minor: number; work_type_key: string | null; priority: number;
  valid_from: string; valid_until: string; status: string; source_reference: string };
type Position = { revision: number; members: Member[]; categories: string[]; rules: Rule[] };
const categories = { work_authority: "Work economic authority", design_authority: "Design spending window",
  design_commitment: "Design effort commitment", purchase_order: "Purchase order approval",
  subcontract_allocation: "Subcontract spending allocation", subcontract_agreement: "Subcontract agreement approval",
  subcontract_variation: "Subcontract variation approval", field_labor_authority: "Field-labor authority review" } as const;
const today = () => new Date().toISOString().slice(0, 10);

export function SpendingDelegationAdmin({ workspace }: { workspace: WorkspaceKey }) {
  const [position, setPosition] = useState<Position | null>(null);
  const [category, setCategory] = useState<keyof typeof categories>("work_authority");
  const [role, setRole] = useState("admin");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const endpoint = `/api/d5o-hosted/spending-delegation?workspace=${encodeURIComponent(workspace)}`;
  const refresh = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const body = await response.json() as Position & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Spending delegation unavailable.");
    setPosition(body);
  }, [endpoint]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Configuration unavailable."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  async function command(action: "add" | "revoke", input: Record<string, unknown>) {
    if (!position) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, input, commandId: crypto.randomUUID(), expectedRevision: position.revision }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Configuration rejected.");
      await refresh();
      setMessage(action === "add" ? "Rule saved. Current eligible reviews now use system selection." : "Rule revoked. Reviews without another eligible rule are held.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Configuration unavailable."); }
    finally { setBusy(false); }
  }
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = String(data.get("max") ?? "");
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) { setMessage("Enter a valid maximum amount."); return; }
    const [whole, cents = ""] = value.split(".");
    const maxMinor = BigInt(whole) * BigInt(100) + BigInt(cents.padEnd(2, "0"));
    void command("add", { category, role, kind: data.get("kind"), actorId: data.get("actor"),
      maxMinor: String(maxMinor), currency: data.get("currency"), workTypeKey: data.get("workType"),
      priority: Number(data.get("priority")), validFrom: data.get("from"), validUntil: data.get("until"),
      sourceReference: data.get("source") });
  }
  const eligible = position?.members.filter((member) => member.role === role) ?? [];
  return <details className="d5o-studio-section"><summary>Spending decision delegates</summary>
    <section className="d5o-publication" aria-label="Spending decision delegation">
      <header><div><p>WORKSPACE ADMINISTRATOR · GOVERNED DECISION ROUTING</p><h2>Assign eligible spending reviewers</h2>
        <span>Configure a named delegate by amount and Work Type, with a sponsor fallback. The system selects one eligible independent reviewer. These rules never give a person a new command role.</span></div>
        <strong>Revision {position?.revision ?? "—"}</strong></header>
      {message && <p role="status">{message}</p>}
      <p>Categories without a configured rule retain their existing role checks. Once configured, a decision with no eligible delegate or sponsor is held. Earlier prepared decisions keep their original review contract.</p>
      <div className="d5o-publication-fields">{Object.entries(categories).map(([key, label]) => <div key={key}>
        <strong>{label}</strong><p>{position?.categories.includes(key) ? "Configured" : "Existing role routing"}</p>
        <small>{position?.rules.filter((rule) => rule.category === key && rule.status === "Active").length ?? 0} active rules</small></div>)}</div>
      {position?.rules.filter((rule) => rule.status === "Active").map((rule) => <article key={rule.id}>
        <strong>{categories[rule.category as keyof typeof categories]} · {rule.kind}</strong>
        <p>{position.members.find((member) => member.actorId === rule.actor_user_id)?.email ?? "Former member"} · {rule.role_name} · {rule.currency} {(rule.max_minor / 100).toLocaleString()} maximum · {rule.work_type_key ?? "all Work Types"} · {rule.valid_from} to {rule.valid_until}</p>
        <small>Priority {rule.priority} · source {rule.source_reference}</small>
        <button type="button" disabled={busy} onClick={() => {
          const reason = window.prompt("Record why this delegation is being revoked. Active decisions without another eligible reviewer will be held.");
          if (reason?.trim() && reason.trim().length >= 10) void command("revoke", { ruleId: rule.id, reason: reason.trim() });
        }}>Revoke rule</button></article>)}
      <form className="d5o-publication-editor" onSubmit={add}><h3>Add an eligible reviewer rule</h3>
        <div className="d5o-publication-fields"><label>Decision category<select value={category} onChange={(event) => {
          const next = event.target.value as keyof typeof categories; setCategory(next); if (next === "work_authority" || next === "purchase_order" || next === "field_labor_authority" || next.startsWith("subcontract_")) setRole("admin");
        }}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Existing command role<select value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="admin">Administrator</option>{category !== "work_authority" && category !== "purchase_order" && category !== "field_labor_authority" && !category.startsWith("subcontract_") && <option value="operations_leader">Operations leader</option>}</select></label>
        <label>Rule kind<select name="kind"><option value="delegate">Delegate</option><option value="sponsor">Sponsor fallback</option></select></label>
        <label>Existing active member<select name="actor" required>{eligible.length ? eligible.map((member) => <option value={member.actorId} key={member.actorId}>{member.email}</option>) : <option value="">No eligible member</option>}</select></label>
        <label>Maximum decision amount<input name="max" type="number" min="0.01" step="0.01" required /></label>
        <label>Currency<input name="currency" defaultValue="USD" maxLength={3} pattern="[A-Z]{3}" required /></label>
        <label>Work Type key, optional<input name="workType" placeholder="All Work Types" /></label>
        <label>Selection priority<input name="priority" type="number" min="0" max="1000" defaultValue="100" required /></label>
        <label>Effective from<input name="from" type="date" defaultValue={today()} required /></label>
        <label>Valid until<input name="until" type="date" required /></label>
        <label>Approved policy source<input name="source" minLength={8} required /></label></div>
        <button disabled={busy || !eligible.length || !position}>Save reviewer rule</button>
        <small>Only an administrator can change this configuration. The spending command still checks role, independent review, source, revision and available authority.</small>
      </form>
    </section></details>;
}
