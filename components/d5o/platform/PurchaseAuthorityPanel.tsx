"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import styles from "./GraybarWorkspace.module.css";

type Authority = { id: string; status: string; parent_cap_minor: number; purchasing_cap_minor: number;
  scope: string; conditions: string; funding_source: string; source_reference: string; subcontract_enabled?: boolean; purchasing_entity: string; graybar_account_reference: string; bom_id: string;
  valid_from: string; valid_until: string; prepared_by: string; review_note?: string };
type Reservation = { id: string; order_id: string; amount_minor: number; status: string };
type ReviewRoute = { pending: boolean; canReview: boolean; route: string };
type Position = { revision: number; currentBomId: string | null; legacyPurchaseHold: boolean; source: { kind: string; digest: string; defineRevision: number; estimateRevision: number } | null;
  designCommittedMinor: number; purchaseReservedMinor: number; parentCapMinor: number | null;
  purchaseCapMinor: number | null; parentRemainingMinor: number | null; purchaseRemainingMinor: number | null;
  authorities: Authority[]; reservations: Reservation[] };
const money = (amount: number | null) => amount === null ? "Not authorized" :
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount / 100);
const dollarsToMinor = (value: string) => Math.round(Number(value) * 100);
export function PurchaseAuthorityPanel({ workspace, workId, role, refreshKey, orders, task, onChanged }: {
  workspace: string; workId: string; role: string; refreshKey: number;
  orders: Array<{ id: string; status: string; amountMinor: number }>;
  task?: { step: string; sourceRevision: number; decision: string };
  onChanged: () => Promise<void>;
}) {
  const [position, setPosition] = useState<Position | null>(null);
  const [reviewRoute, setReviewRoute] = useState<{ subjectId: string; value: ReviewRoute } | null>(null);
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false); const [purchaseCapInput, setPurchaseCapInput] = useState("0");
  const url = `/api/d5o-hosted/purchase-authority?workspace=${encodeURIComponent(workspace)}&workId=${encodeURIComponent(workId)}`;
  const refresh = useCallback(async () => {
    const response = await fetch(url, { cache: "no-store" }); const body = await response.json();
    if (response.ok) setPosition(body as Position); else setNotice(body.error ?? "Authority unavailable");
  }, [url]);
  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, [refresh, refreshKey]);
  const cancelUnsent = async (orderId: string) => {
    if (!position || stale) return;
    const reason = window.prompt("Why is this approved, unsent PO being cancelled? An issued or posted order cannot be cancelled here.");
    if (!reason || reason.trim().length < 10) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel-unsent-po", input: { orderId, reason },
          commandId: crypto.randomUUID(), expectedRevision: position.revision,
          expectedGraybarRevision: refreshKey, expectedSourceDigest: position.source?.digest ?? "" }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Cancellation failed");
      setNotice("Approved unsent PO cancelled. The reservation release and history were retained.");
      await onChanged(); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Cancellation unavailable"); }
    finally { setBusy(false); }
  };
  const pending = position?.authorities.find((item) => item.status === "Prepared");
  const selectedPending = task?.step === "authority-review" ?
    position?.authorities.find((item) => item.id === task.decision && item.status === "Prepared") : pending;
  const selectedPendingId = selectedPending?.id;
  const currentRoute = reviewRoute && reviewRoute.subjectId === selectedPendingId ? reviewRoute.value : null;
  useEffect(() => {
    if (!selectedPendingId) return;
    let active = true;
    const routeUrl = `/api/d5o-hosted/spending-review-route?workspace=${encodeURIComponent(workspace)}&workId=${encodeURIComponent(workId)}&category=work_authority&subjectId=${encodeURIComponent(selectedPendingId)}`;
    void fetch(routeUrl, { cache: "no-store" }).then(async (response) => {
      const body = await response.json() as ReviewRoute;
      if (active && response.ok) setReviewRoute({ subjectId: selectedPendingId, value: body });
    }).catch(() => {});
    return () => { active = false; };
  }, [selectedPendingId, workspace, workId, refreshKey, position?.revision]);
  const stale = !!task && !!position && (task.sourceRevision !== position.revision ||
    task.step === "authority-review" && !selectedPending ||
    task.step === "authority-prepare" && !!position.parentCapMinor);
  const command = async (action: string, input: Record<string, unknown>) => {
    if (!position || !position.source || stale) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, input, commandId: crypto.randomUUID(),
          expectedRevision: position.revision, expectedSourceDigest: position.source.digest }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Authority decision failed");
      setNotice(`${action} saved. The authority and queue will refresh.`);
      await refresh(); await onChanged();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Authority unavailable"); }
    finally { setBusy(false); }
  };
  return <section className={styles.card}>
    <h2>Work economic authority</h2>
    <p>An independent administrator approves the Work cap. Purchasing requires a positive allocation and approved BOM. Off-site subcontract allocation may be enabled separately with purchasing set to zero. Drafts reserve nothing.</p>
    {stale && <p role="alert">This exact authority task changed or was decided. <Link href={`/work?workspace=${workspace}&view=my-work`}>Return to refreshed My Work</Link>.</p>}
    {notice && <p role="status">{notice}</p>}
    <div className={styles.grid}>
      <p><b>Current source</b><br />{position?.source ? `${position.source.kind} · Define ${position.source.defineRevision} · estimate ${position.source.estimateRevision}` : "Approved commercial or funded Design basis missing"}<br />Approved BOM: {position?.currentBomId ?? "missing"}</p>
      <p><b>Work limit / remaining</b><br />{money(position?.parentCapMinor ?? null)} / {money(position?.parentRemainingMinor ?? null)}</p>
      <p><b>Purchasing allocation / remaining</b><br />{money(position?.purchaseCapMinor ?? null)} / {money(position?.purchaseRemainingMinor ?? null)}</p>
      <p><b>Counted once in Work limit</b><br />Design {money(position?.designCommittedMinor ?? 0)} · approved POs {money(position?.purchaseReservedMinor ?? 0)} · approved subcontracts within the same Work cap</p>
    </div>
    {position?.legacyPurchaseHold && <p role="alert">This Work has an earlier approved PO without reviewed Work authority. Its supplier and Finance history remains intact. New purchasing is held until a governed legacy transition is established; do not assign a new cap retroactively.</p>}
    {!position?.source && <p role="alert">Next: project manager resolves the approved Define, ROM and award or funded Design source before purchasing authority can be prepared.</p>}
    {position?.source && role === "project_manager" && !position.parentCapMinor && !position.legacyPurchaseHold && !pending && !stale &&
      <form className={styles.grid} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget);
        void command("prepare", { parentCapMinor: dollarsToMinor(String(form.get("parentCap"))),
          purchaseCapMinor: dollarsToMinor(String(form.get("purchaseCap"))), subcontractEnabled: form.has("subcontractEnabled"),
          scope: form.get("scope"), conditions: form.get("conditions"), fundingSource: form.get("fundingSource"),
          purchasingEntity: Number(purchaseCapInput) > 0 ? form.get("purchasingEntity") : "Not applicable", graybarAccountReference: Number(purchaseCapInput) > 0 ? form.get("graybarAccountReference") : "N/A",
          sourceReference: form.get("sourceReference"), validFrom: form.get("validFrom"), validUntil: form.get("validUntil"),
          supersedesId: position?.authorities.find((item) => item.status === "Returned" || item.status === "Revoked")?.id }); }}>
        <label>Work economic limit USD<input name="parentCap" type="number" step="0.01" min="0.01" required /></label>
        <label>Purchasing allocation USD<input name="purchaseCap" type="number" step="0.01" min="0" value={purchaseCapInput} onChange={(event) => setPurchaseCapInput(event.target.value)} required /></label>
        <label><input name="subcontractEnabled" type="checkbox" /> Include a separately reviewed subcontract allocation within this Work cap</label>{Number(purchaseCapInput) > 0 && <><label>Rybex purchasing entity<input name="purchasingEntity" required /></label>
        <label>Authorized Graybar account reference<input name="graybarAccountReference" required /></label></>}
        <label>Authorized purchasing scope<textarea name="scope" required /></label>
        <label>Funding or credit basis<input name="fundingSource" required /></label>
        <label>Retained authority source reference<input name="sourceReference" required /></label>
        <label>Conditions and exclusions<textarea name="conditions" required /></label>
        <label>Effective from<input name="validFrom" type="date" required /></label>
        <label>Expires<input name="validUntil" type="date" required /></label>
        <button className={styles.primary} disabled={busy}>Prepare independent Work authority review</button>
      </form>}
    {selectedPending && <article className={styles.record}>
      <b>Prepared by project manager · independent decision required</b>
      <span>Work {money(selectedPending.parent_cap_minor)} · purchasing {money(selectedPending.purchasing_cap_minor)} · subcontract category {selectedPending.subcontract_enabled ? "eligible for separate allocation" : "not enabled"} · {selectedPending.scope}</span>
      <small>Funding: {selectedPending.funding_source} · source: {selectedPending.source_reference} · {selectedPending.valid_from} to {selectedPending.valid_until}</small>
      <p>Purchasing entity: {selectedPending.purchasing_entity} · Graybar account: {selectedPending.graybar_account_reference} · exact BOM: {selectedPending.bom_id}</p>
      <p>Conditions: {selectedPending.conditions}</p>
      <p role="status">{currentRoute?.route ?? "Checking exact reviewer assignment…"}</p>
      {role === "admin" && currentRoute?.canReview && !stale && <form className={styles.inline} onSubmit={(event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        void command(String((event.nativeEvent as SubmitEvent).submitter?.getAttribute("value")), {
          authorityId: selectedPending.id, reason: String(form.get("reason")) }); }}>
        <label>Independent review reason<input name="reason" required minLength={10} /></label>
        <button value="approve" disabled={busy}>Approve Work and purchasing limits</button>
        <button value="return" disabled={busy}>Return for correction</button>
      </form>}
    </article>}
    <h3>Retained authority and reservations</h3>
    {position?.authorities.map((item) => <article className={styles.record} key={item.id}>
      <b>{item.status} · Work {money(item.parent_cap_minor)} · purchasing {money(item.purchasing_cap_minor)}</b>
      <small>{item.source_reference} · {item.valid_from} to {item.valid_until} · {item.review_note ?? "Review pending"}</small>
      {item.status === "Approved" && role === "admin" && <button disabled={busy || stale} onClick={() => {
        const reason = window.prompt("Why is this authority being revoked for future commitments?");
        if (reason) void command("revoke", { authorityId: item.id, reason });
      }}>Revoke future authority</button>}
    </article>)}
    {position?.reservations.map((item) => <p key={item.id}>PO {item.order_id} · {money(item.amount_minor)} · {item.status}
      {role === "admin" && !stale && item.status === "Reserved" &&
        orders.some((order) => order.id === item.order_id && order.status === "Approved") &&
        <button disabled={busy} onClick={() => void cancelUnsent(item.order_id)}>Cancel unsent PO</button>}</p>)}
    <p>Supplier receipt and invoice posting reconcile Finance costs. They do not restore consumed economic authority. A credit or expected refund is not a budget release.</p>
  </section>;
}
