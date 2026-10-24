"use client";
import { useCallback, useEffect, useState } from "react";

type Authority = { id: string; status: string; parent_cap_minor?: number; cap_minor?: number };
type Position = { revision: number; source?: { digest?: string };
  authorities?: Authority[]; parentAuthorityId?: string | null; parentCapMinor?: number | null;
  laborAuthorityId?: string | null };
type View = { role: string; purchase: Position; labor: Position };
function field(data: FormData, key: string) { return String(data.get(key) ?? "").trim(); }
export function CustomerDevelopAuthority({ workspace, workId, role, onChanged }: {
  workspace: string; workId: string; role: string; onChanged: () => Promise<void>;
}) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/d5o-hosted/customer-develop-authority?workspace=${encodeURIComponent(workspace)}&workId=${encodeURIComponent(workId)}`,
      { cache: "no-store" });
    const result = await response.json() as View & { error?: string };
    if (!response.ok) throw Error(result.error ?? "Commercial authority unavailable");
    setView(result);
  }, [workspace, workId]);
  useEffect(() => { const frame = requestAnimationFrame(() => {
    void refresh().catch((cause) => setError(String(cause)));
  }); return () => cancelAnimationFrame(frame); }, [refresh]);
  async function act(kind: "purchase" | "labor", action: "prepare" | "approve",
    input: Record<string, unknown>) {
    if (!view || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const position = view[kind];
      const response = await fetch(`/api/d5o-hosted/customer-develop-authority?workspace=${encodeURIComponent(workspace)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          workId, kind, action, input, commandId: crypto.randomUUID(),
          revision: position.revision, sourceDigest: position.source?.digest }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw Error(result.error ?? "Authority decision unavailable");
      await Promise.all([refresh(), onChanged()]);
      setMessage(`${kind === "purchase" ? "Economic" : "Labor"} authority ${action === "prepare" ? "submitted" : "approved"}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Authority decision unavailable"); }
    finally { setBusy(false); }
  }
  if (!view) return <div className="d5o-customer-design-actions"><h4>Execution authority</h4>
    <p>{error || "Loading current economic and labor authority…"}</p></div>;
  const pendingPurchase = view.purchase.authorities?.findLast((item) => item.status === "Prepared");
  const pendingLabor = view.labor.authorities?.findLast((item) => item.status === "Prepared");
  return <div className="d5o-customer-design-actions"><h4>Execution authority</h4>
    <p>Economic and labor limits require an independent administrator decision before crew publication.</p>
    <p>Economic authority: {view.purchase.parentCapMinor != null ? "approved" : pendingPurchase ? "awaiting review" : "needed"}.
      Labor authority: {view.labor.laborAuthorityId ? "approved" : pendingLabor ? "awaiting review" : "needed"}.</p>
    {role === "project_manager" && view.purchase.parentCapMinor == null && !pendingPurchase &&
      <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget);
        void act("purchase", "prepare", { parentCapMinor: field(data, "parentCapMinor"),
          purchaseCapMinor: field(data, "purchaseCapMinor"),
          subcontractEnabled: data.has("subcontractEnabled"),
          validFrom: field(data, "validFrom"), validUntil: field(data, "validUntil"),
          purchasingEntity: field(data, "purchasingEntity"),
          graybarAccountReference: field(data, "graybarAccountReference"),
          scope: field(data, "scope"), fundingSource: field(data, "fundingSource"),
          sourceReference: field(data, "sourceReference"), conditions: field(data, "conditions") }); }}>
        <h5>Prepare economic authority</h5>
        <label>Total cap in cents<input name="parentCapMinor" type="number" min="1" required /></label>
        <label>Purchase cap in cents<input name="purchaseCapMinor" type="number" min="0" required /></label>
        <label>Permit subcontract commitments<input name="subcontractEnabled" type="checkbox" /></label>
        <label>Valid from<input name="validFrom" type="date" required /></label>
        <label>Valid until<input name="validUntil" type="date" required /></label>
        <label>Purchasing entity<input name="purchasingEntity" required /></label>
        <label>Account reference<input name="graybarAccountReference" required /></label>
        <label>Funding source<input name="fundingSource" required /></label>
        <label>Source reference<input name="sourceReference" required /></label>
        <label>Scope<textarea name="scope" minLength={10} required /></label>
        <label>Conditions<textarea name="conditions" minLength={10} required /></label>
        <button disabled={busy}>Submit economic authority</button>
      </form>}
    {role === "admin" && pendingPurchase && view.purchase.parentCapMinor == null &&
      <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget);
        void act("purchase", "approve", { authorityId: pendingPurchase.id,
          reason: field(data, "reason") }); }}>
        <h5>Independent economic review</h5><p>Proposed cap: {pendingPurchase.parent_cap_minor ?? "unavailable"} cents.</p>
        <label>Approval reason<textarea name="reason" minLength={10} required /></label>
        <button disabled={busy}>Approve economic authority</button>
      </form>}
    {role === "project_manager" && view.purchase.parentCapMinor != null && !view.labor.laborAuthorityId
      && !pendingLabor && <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget);
        void act("labor", "prepare", { capMinor: field(data, "capMinor"),
          rateMinor: field(data, "rateMinor"), rateVersion: field(data, "rateVersion"),
          rateSource: field(data, "rateSource"), rateBasis: field(data, "rateBasis"),
          scope: field(data, "scope"), conditions: field(data, "conditions"),
          validFrom: field(data, "validFrom"), validUntil: field(data, "validUntil") }); }}>
        <h5>Prepare field labor authority</h5>
        <label>Labor cap in cents<input name="capMinor" type="number" min="1" required /></label>
        <label>Rate in cents per hour<input name="rateMinor" type="number" min="1" required /></label>
        <label>Rate version<input name="rateVersion" minLength={4} required /></label>
        <label>Rate source<input name="rateSource" minLength={8} required /></label>
        <label>Rate basis<input name="rateBasis" minLength={10} required /></label>
        <label>Valid from<input name="validFrom" type="date" required /></label>
        <label>Valid until<input name="validUntil" type="date" required /></label>
        <label>Labor scope<textarea name="scope" minLength={10} required /></label>
        <label>Conditions<textarea name="conditions" minLength={10} required /></label>
        <button disabled={busy}>Submit labor authority</button>
      </form>}
    {role === "admin" && pendingLabor && !view.labor.laborAuthorityId &&
      <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget);
        void act("labor", "approve", { authorityId: pendingLabor.id,
          reason: field(data, "reason") }); }}>
        <h5>Independent field labor review</h5><p>Proposed cap: {pendingLabor.cap_minor ?? "unavailable"} cents.</p>
        <label>Approval reason<textarea name="reason" minLength={10} required /></label>
        <button disabled={busy}>Approve labor authority</button>
      </form>}
    {error && <p role="alert" className="d5o-customer-work-error">{error}</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
