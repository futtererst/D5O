"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import styles from "./GraybarWorkspace.module.css";

type Item = Record<string, string | number | undefined>;
type Position = {
 revision: number; source: { digest: string; kind: string; defineRevision: number; estimateRevision: number } | null;
 parentAuthorityId: string | null; parentCapMinor: number | null; parentRemainingMinor: number | null;
 subcontractCapMinor: number | null; subcontractRemainingMinor: number | null;
 designConsumedMinor: number; purchaseConsumedMinor: number; subcontractConsumedMinor: number;
 financeRevision: number | null; companies: Item[];
 state: { allocations: Item[]; agreements: Item[]; variations: Item[]; deliverables: Item[]; invoices: Item[] };
 reservations: Array<{ id: string; agreement_id: string; variation_id?: string; amount_minor: number }>;
 costLinks: Array<{ reservationId?: string; invoiceId?: string; kind: string; amountMinor: number }>;
};
type Document = { id: string; kind: string; filename: string; sha256: string };
type ReviewRoute = { revision: number; canReview: boolean; route?: string };
const money = (minor?: number | null) => minor === null || minor === undefined ? "Not authorized" :
 new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);
const minor = (value: string) => Math.round(Number(value) * 100);
const values = (form: HTMLFormElement) => Object.fromEntries([...new FormData(form).entries()].map(([key, value]) => [key, String(value)]));
const only = (task: { step: string } | undefined, name: string) => !task || task.step === name;
const uncorrectedReturn = (items: Item[], agreementId?: string) => [...items].reverse().find((item) =>
 item.status === "Returned" && (!agreementId || item.agreementId === agreementId) &&
 !items.some((next) => next.supersedesId === item.id));
export function SubcontractWorkspace({ workspace, workId, role, build, task }: {
 workspace: string; workId: string; role: string; build: string;
 task?: { step: string; revision: number; decision: string };
}) {
 const [position, setPosition] = useState<Position | null>(null);
 const [reviewRoutes, setReviewRoutes] = useState<Record<string, ReviewRoute>>({});
 const [documents, setDocuments] = useState<Document[]>([]);
 const [work, setWork] = useState<{ title: string; customer: string; site: string } | null>(null);
 const [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
 const url = "/api/d5o-hosted/subcontract?workspace=" + encodeURIComponent(workspace) + "&workId=" + encodeURIComponent(workId);
 const docUrl = "/api/d5o-hosted/graybar-document?workspace=" + encodeURIComponent(workspace) + "&workId=" + encodeURIComponent(workId);
 const refresh = useCallback(async () => {
   const [basis, files, records] = await Promise.all([
     fetch(url, { cache: "no-store" }),
     fetch("/api/d5o-hosted/graybar?workspace=" + workspace + "&workId=" + encodeURIComponent(workId), { cache: "no-store" }),
     fetch("/api/d5o-hosted/prototype-state?workspace=" + workspace + "&key=work", { cache: "no-store" })
   ]);
   const result = await basis.json();
   if (basis.ok) {
     const current = result as Position;
     setReviewRoutes({}); setPosition(current);
     if (role === "admin") {
       const targets = ([
         ["subcontract_allocation", current.state.allocations],
         ["subcontract_agreement", current.state.agreements],
         ["subcontract_variation", current.state.variations]
       ] as const).flatMap(([category, items]) => items.filter((item) => item.status === "Prepared" && item.id)
         .map((item) => ({ category, id: String(item.id) })));
       const routes = await Promise.all(targets.map(async ({ category, id }) => {
         try {
           const response = await fetch(`/api/d5o-hosted/spending-review-route?workspace=${encodeURIComponent(workspace)}&workId=${encodeURIComponent(workId)}&category=${category}&subjectId=${encodeURIComponent(id)}`, { cache: "no-store" });
           const route = response.ok ? await response.json() as ReviewRoute : { canReview: false, route: "Reviewer routing unavailable. Refresh before deciding." };
           return [id, { ...route, revision: current.revision }] as const;
         } catch { return [id, { canReview: false, route: "Reviewer routing unavailable. Refresh before deciding.", revision: current.revision }] as const; }
       }));
       setReviewRoutes(Object.fromEntries(routes));
     }
   } else setNotice(result.error ?? "Subcontract basis unavailable");
   if (files.ok) setDocuments((await files.json() as { documents: Document[] }).documents.filter((item) => item.kind === "other"));
   if (records.ok) {
     const list = (await records.json() as { state?: { records?: Array<{ id: string; title: string; customer: string; site: string }> } }).state?.records ?? [];
     setWork(list.find((item) => item.id === workId) ?? null);
   }
 }, [url, workspace, workId, role]);
 useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, [refresh]);
 const state = position?.state, agreements = state?.agreements ?? [], allocations = state?.allocations ?? [];
 const exactInvoiceDelivery = state?.deliverables.find((item) => item.status === "Accepted" && item.id === task?.decision);
 const agreement = agreements.find((item) => item.status === "Approved" && (task?.step !== "subcontract-delivery" || item.id === task.decision) && (task?.step !== "subcontract-invoice" || item.id === exactInvoiceDelivery?.agreementId));
 const pendingAllocation = allocations.find((item) => item.status === "Prepared");
 const pendingAgreement = agreements.find((item) => item.status === "Prepared");
 const pendingVariation = state?.variations.find((item) => item.status === "Prepared");
 const pendingDelivery = state?.deliverables.find((item) => item.status === "Submitted");
 const pendingInvoice = state?.invoices.find((item) => item.status === "Review");
 const exact = (item?: Item) => !task || !task.decision || item?.id === task.decision;
 const routeFor = (item?: Item) => item?.id && reviewRoutes[String(item.id)]?.revision === position?.revision
   ? reviewRoutes[String(item.id)] : null;
 const stale = !!task && !!position && (position.revision !== task.revision ||
   task.step === "subcontract-review-allocation" && !exact(pendingAllocation) ||
   task.step === "subcontract-review-agreement" && !exact(pendingAgreement) ||
   task.step === "subcontract-review-variation" && !exact(pendingVariation) ||
   task.step === "subcontract-review-deliverable" && !exact(pendingDelivery) ||
   task.step === "subcontract-review-invoice" && !exact(pendingInvoice) ||
   task.step === "subcontract-delivery" && !agreement ||
   task.step === "subcontract-invoice" && !exactInvoiceDelivery ||
   task.step === "subcontract-cost-commitment" && !position.reservations.some((item) => item.id === task.decision && item.amount_minor > 0 && !position.costLinks.some((link) => link.kind === "Committed" && link.reservationId === item.id)) ||
   task.step === "subcontract-cost-invoice" && !state?.invoices.some((item) => item.id === task.decision && item.status === "Matched" && !position.costLinks.some((link) => link.kind === "Incurred" && link.invoiceId === item.id)));
 const command = async (action: string, input: Record<string, unknown>, subjectId?: string) => {
   if (!position || stale || !position.source) return;
   setBusy(true); setNotice("");
   try {
     const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ action, input, subjectId, commandId: crypto.randomUUID(),
         expectedRevision: position.revision, expectedSourceDigest: position.source.digest,
         expectedFinanceRevision: position.financeRevision }) });
     const result = await response.json();
     if (!response.ok) throw new Error(result.error ?? "Decision unavailable");
     await refresh();
     setNotice(action.replaceAll("-", " ") + " saved. Review the new position and next owner.");
   } catch (error) { setNotice(error instanceof Error ? error.message : "Decision unavailable"); }
   finally { setBusy(false); }
 };
 const submit = (action: string, convert: (input: Record<string,string>) => Record<string,unknown> = (input) => input) =>
   (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); void command(action, convert(values(event.currentTarget))); };
 const review = (action: string, subjectKey: string, item: Item) => (event: React.FormEvent<HTMLFormElement>) => {
   event.preventDefault();
   const input = values(event.currentTarget);
   void command(action, { [subjectKey]: item.id, ...input });
 };
 const upload = async (event: React.FormEvent<HTMLFormElement>) => {
   event.preventDefault(); setBusy(true); setNotice("");
   try {
     const form = new FormData(event.currentTarget); form.set("kind", "other");
     const response = await fetch(docUrl, { method: "POST", body: form });
     const result = await response.json();
     if (!response.ok) throw new Error(result.error ?? "Private document unavailable");
     await refresh(); setNotice("Private supplier document retained with SHA-256 " + result.sha256 + ". Select it in the relevant decision.");
   } catch (error) { setNotice(error instanceof Error ? error.message : "Upload failed"); }
   finally { setBusy(false); }
 };
 const picker = (name: string) => <label>Retained private document<select name={name} required defaultValue="">
   <option value="">Choose the exact version</option>{documents.map((doc) => <option key={doc.id} value={doc.id}>{doc.filename} · {doc.sha256.slice(0, 12)}</option>)}
 </select></label>;
 const accepted = (state?.deliverables ?? []).filter((item) => item.status === "Accepted").reduce((sum, item) => sum + Number(item.amountMinor ?? 0), 0);
 const invoiced = (state?.invoices ?? []).filter((item) => item.status === "Matched").reduce((sum, item) => sum + Number(item.amountMinor ?? 0), 0);
 const incurred = (position?.costLinks ?? []).filter((item) => item.kind === "Incurred").reduce((sum, item) => sum + item.amountMinor, 0);
 const revised = Number(agreement?.revisedMinor ?? 0);
 const header = task?.step.replaceAll("subcontract-", "").replaceAll("-", " ") ?? "Subcontract commercial";
 return <div className={styles.shell}><header className={styles.top}><Link href={"/work?workspace=" + workspace}>D5O / Rybex</Link><span>Subcontract commercial · {role.replaceAll("_", " ")}</span><small>Build {build.slice(0,12)}</small></header>
 <main className={styles.main}><div className={styles.heading}><div><p className={styles.eyebrow}>Current task · exact Work revision {position?.revision ?? "loading"}</p>
   <h1>{header.charAt(0).toUpperCase() + header.slice(1)}</h1><p>{work?.title ?? workId} · {work?.customer ?? "Customer not recorded"} · {work?.site ?? "Site not recorded"}</p></div>
   <div className={styles.inline}><Link href={"/work?workspace=" + workspace + "&view=my-work"}>Back to My Work</Link>
     <Link href={"/work?workspace=" + workspace + "&record=" + encodeURIComponent(workId)}>Full Work Record</Link></div></div>
 <p className={styles.notice}>Fixed-price subcontract only. Company and commercial agreement are separate from worker qualification, scheduling and field authorization. Documents are private; no supplier message or payment is sent.</p>
 {notice && <p role="status" className={styles.status}>{notice}</p>}
 {stale && <p role="alert" className={styles.notice}>This exact source or decision changed. Nothing else was selected. <Link href={"/work?workspace=" + workspace + "&view=my-work"}>Return to refreshed My Work</Link>.</p>}
 <section className={styles.card}><h2>Economic position</h2><div className={styles.grid}>
   <p><b>Work cap / remaining</b><br />{money(position?.parentCapMinor)} / {money(position?.parentRemainingMinor)}</p>
   <p><b>Design / purchasing / subcontract consumed</b><br />{money(position?.designConsumedMinor)} / {money(position?.purchaseConsumedMinor)} / {money(position?.subcontractConsumedMinor)}</p>
   <p><b>Subcontract allocation / remaining</b><br />{money(position?.subcontractCapMinor)} / {money(position?.subcontractRemainingMinor)}</p>
   <p><b>Original / revised agreement</b><br />{money(agreement ? Number(agreement.amountMinor) : null)} / {money(revised)}</p>
   <p><b>Accepted / invoiced / incurred</b><br />{money(accepted)} / {money(invoiced)} / {money(incurred)}</p>
   <p><b>Outstanding committed work</b><br />{agreement ? money(revised - incurred) : "No approved agreement"}</p>
 </div><p>Current source: {position?.source ? position.source.kind + " · Define " + position.source.defineRevision + " · estimate " + position.source.estimateRevision : "approved commercial/funding basis missing"}. Approval of a subcontract does not authorize a worker, an on-site start or a payment.</p></section>
 {!task && <nav aria-label="Subcontract stages" className={styles.steps}>{["authority","agreement","variation","delivery","invoice"].map((item) => <a key={item} href={"#"+item}>{item}</a>)}</nav>}
 {(!task || ["subcontract-agreement","subcontract-variation","subcontract-delivery","subcontract-invoice"].includes(task.step)) && <section className={styles.card}><h2>Supplier document custody</h2><p>Upload the fictional agreement, variation, technical deliverable or invoice. Review its original bytes before selecting it below.</p>
   <form className={styles.inline} onSubmit={upload}><label>Private PDF, CSV or XLSX<input name="file" type="file" accept=".pdf,.csv,.xlsx" required /></label><button disabled={busy}>Retain document</button></form>
   {documents.map((doc) => <p key={doc.id}><a target="_blank" rel="noreferrer" href={docUrl + "&documentId=" + encodeURIComponent(doc.id)}>{doc.filename}</a> · SHA-256 {doc.sha256}</p>)}</section>}
 {only(task,"subcontract-allocation") && <section id="authority" className={styles.card}><h2>Allocate subcontract authority</h2>
   <p>PM prepares a contained sublimit under the independently approved Work cap. An administrator decides it separately from purchasing rights.</p>
   {role === "project_manager" && !stale && position?.parentAuthorityId && !position.subcontractCapMinor && !pendingAllocation &&
   <form className={styles.grid} onSubmit={submit("prepare-allocation", (input) => ({ ...input, capMinor: minor(input.cap) }))}>
     <label>Subcontract cap USD<input name="cap" type="number" min="0.01" step="0.01" required /></label>
     <label>Source reference<input name="sourceReference" required minLength={8} /></label>
     <label>Authorized scope<textarea name="scope" required minLength={12} /></label>
     <label>Conditions and exclusions<textarea name="conditions" required minLength={10} /></label>
     <button disabled={busy}>Prepare independent allocation review</button></form>}</section>}
 {only(task,"subcontract-review-allocation") && pendingAllocation && exact(pendingAllocation) && <section className={styles.card}><h2>Review subcontract allocation</h2>
   <p>{money(Number(pendingAllocation.capMinor))} · {pendingAllocation.scope} · {pendingAllocation.conditions} · source {pendingAllocation.sourceReference}</p>
   {role === "admin" && !stale && routeFor(pendingAllocation)?.canReview && <form className={styles.inline} onSubmit={review("review-allocation","allocationId",pendingAllocation)}>
     <label>Decision<select name="decision"><option value="Approved">Approve</option><option value="Returned">Return</option></select></label>
     <label>Independent reason<input name="reason" minLength={10} required /></label><button disabled={busy}>Record decision</button></form>}
   {role === "admin" && !stale && !routeFor(pendingAllocation)?.canReview && <p>{routeFor(pendingAllocation)?.route ?? "Checking the configured reviewer."}</p>}</section>}
 {only(task,"subcontract-agreement") && <section id="agreement" className={styles.card}><h2>Prepare fixed-price agreement</h2>
   <p>Define the exact deliverable and acceptance basis before asking an independent administrator to reserve authority.</p>
   {role === "project_manager" && !stale && <><form className={styles.grid} onSubmit={submit("register-company")}>
      <label>Subcontract company<input name="name" required minLength={4} /></label><label>Responsible contact<input name="contactName" required minLength={3} /></label>
      <label>Contact reference<input name="contactReference" required minLength={5} /></label><button disabled={busy}>Record company identity</button></form>
     <form className={styles.grid} onSubmit={submit("prepare-agreement", (input) => ({ ...input, amountMinor: minor(input.amount), supersedesId: uncorrectedReturn(agreements)?.id }))}>
      <label>Company<select name="companyId" required defaultValue=""><option value="">Choose company</option>{position?.companies.map((company) => <option key={String(company.id)} value={company.id}>{company.name}</option>)}</select></label>
      <label>Agreement reference<input name="agreementReference" required minLength={8} /></label>
      <label>Initial fixed amount USD<input name="amount" type="number" min="0.01" step="0.01" required /></label>
      <label>Package ID if applicable<input name="packageId" /></label>
      <label>Included scope<textarea name="scope" required minLength={12} /></label><label>Exclusions<textarea name="exclusions" required minLength={4} /></label>
      <label>Deliverables<textarea name="deliverables" required minLength={8} /></label><label>Acceptance criteria<textarea name="acceptanceCriteria" required minLength={10} /></label>
      <label>Dates and dependencies<textarea name="scheduleBasis" required minLength={8} /></label>
      <label>Milestone and payment basis<textarea name="milestoneBasis" required minLength={8} /></label>
      {picker("documentId")}<button disabled={busy || !position?.subcontractCapMinor}>Prepare agreement review</button></form></>}</section>}
 {only(task,"subcontract-review-agreement") && pendingAgreement && exact(pendingAgreement) && <section className={styles.card}><h2>Review exact agreement</h2>
   <p>{pendingAgreement.agreementReference} · {money(Number(pendingAgreement.amountMinor))} · {pendingAgreement.scope}</p>
   <p>Deliverables: {pendingAgreement.deliverables}. Acceptance: {pendingAgreement.acceptanceCriteria}. Exclusions: {pendingAgreement.exclusions}. Dates: {pendingAgreement.scheduleBasis}. Milestone: {pendingAgreement.milestoneBasis}.</p>
   <a target="_blank" rel="noreferrer" href={docUrl+"&documentId="+pendingAgreement.documentId}>Inspect retained agreement</a>
   {role === "admin" && !stale && routeFor(pendingAgreement)?.canReview && <form className={styles.inline} onSubmit={review("review-agreement","agreementId",pendingAgreement)}>
      <label>Decision<select name="decision"><option value="Approved">Approve and reserve</option><option value="Returned">Return</option></select></label>
      <label>Independent reason<input name="reason" minLength={10} required /></label><button disabled={busy}>Record decision</button></form>}
   {role === "admin" && !stale && !routeFor(pendingAgreement)?.canReview && <p>{routeFor(pendingAgreement)?.route ?? "Checking the configured reviewer."}</p>}</section>}
 {only(task,"subcontract-variation") && agreement && <section id="variation" className={styles.card}><h2>Controlled variation</h2>
   <p>Current approved value {money(revised)}. A proposed change reserves nothing until independent approval.</p>
   {role === "project_manager" && !stale && <form className={styles.grid} onSubmit={submit("prepare-variation", (input) => ({ ...input, agreementId: agreement.id, deltaMinor: minor(input.delta), supersedesId: uncorrectedReturn(state?.variations ?? [], String(agreement.id))?.id }))}>
      <label>Amount change USD, signed<input name="delta" type="number" step="0.01" required /></label>
      <label>Added/removed deliverables<textarea name="scopeDifference" required minLength={10} /></label>
      <label>Schedule impact<input name="scheduleImpact" required minLength={5} /></label>
      <label>Reason and source<textarea name="rationale" required minLength={10} /></label>
      {picker("documentId")}<button disabled={busy}>Prepare variation review</button></form>}</section>}
 {only(task,"subcontract-review-variation") && pendingVariation && exact(pendingVariation) && <section className={styles.card}><h2>Review variation</h2>
   <p>Change {money(Number(pendingVariation.deltaMinor))} · {pendingVariation.scopeDifference} · {pendingVariation.scheduleImpact} · {pendingVariation.rationale}</p>
   <a target="_blank" rel="noreferrer" href={docUrl+"&documentId="+pendingVariation.documentId}>Inspect retained change</a>
   {role === "admin" && !stale && routeFor(pendingVariation)?.canReview && <form className={styles.inline} onSubmit={review("review-variation","variationId",pendingVariation)}>
      <input name="agreementId" type="hidden" value={pendingVariation.agreementId} /><label>Decision<select name="decision"><option value="Approved">Approve</option><option value="Returned">Return</option></select></label>
      <label>Reason<input name="reason" minLength={10} required /></label><button disabled={busy}>Record decision</button></form>}
   {role === "admin" && !stale && !routeFor(pendingVariation)?.canReview && <p>{routeFor(pendingVariation)?.route ?? "Checking the configured reviewer."}</p>}</section>}
 {only(task,"subcontract-delivery") && agreement && <section id="delivery" className={styles.card}><h2>Submit service deliverable</h2>
   <p>Record an off-site service fact with retained evidence. Supplier progress is not acceptance.</p>
   {role === "project_manager" && !stale && <form className={styles.grid} onSubmit={submit("submit-deliverable", (input) => ({ ...input, agreementId: agreement.id, amountMinor: minor(input.amount), supersedesId: uncorrectedReturn(state?.deliverables ?? [], String(agreement.id))?.id }))}>
     <label>Submitted value USD<input name="amount" type="number" step="0.01" min="0.01" required /></label>
     <label>Delivered work and source<textarea name="description" minLength={10} required /></label>{picker("documentId")}
     <button disabled={busy}>Submit for independent receipt</button></form>}</section>}
 {only(task,"subcontract-review-deliverable") && pendingDelivery && exact(pendingDelivery) && <section className={styles.card}><h2>Receive exact deliverable</h2>
   <p>{pendingDelivery.description} · {money(Number(pendingDelivery.amountMinor))} · agreement revision {pendingDelivery.agreementRevision}</p>
   <a target="_blank" rel="noreferrer" href={docUrl+"&documentId="+pendingDelivery.documentId}>Inspect retained technical deliverable</a>
   {["operations_leader","admin"].includes(role) && !stale && <form className={styles.inline} onSubmit={review("review-deliverable","deliverableId",pendingDelivery)}>
     <input name="agreementId" type="hidden" value={pendingDelivery.agreementId} /><label>Decision<select name="decision"><option value="Accepted">Accept</option><option value="Returned">Return</option></select></label>
     <label>Reason<input name="reason" minLength={10} required /></label><button disabled={busy}>Record independent receipt</button></form>}</section>}
 {only(task,"subcontract-invoice") && agreement && <section id="invoice" className={styles.card}><h2>Record supplier claim</h2>
   <p>Only independently accepted service can support an invoice. An invoice is not payment.</p>
   {role === "billing_commercial_lead" && !stale && <form className={styles.grid} onSubmit={submit("record-invoice", (input) => ({ ...input, agreementId: agreement.id, amountMinor: minor(input.amount) }))}>
      <label>Accepted deliverable<select name="deliverableId" required defaultValue=""><option value="">Choose</option>{state?.deliverables.filter((item) => item.status === "Accepted" && (!task || task.step !== "subcontract-invoice" || item.id === task.decision)).map((item) => <option key={String(item.id)} value={item.id}>{item.description} · {money(Number(item.amountMinor))}</option>)}</select></label>
      <label>Supplier invoice number<input name="invoiceNumber" minLength={5} required /></label>
      <label>Claim amount USD<input name="amount" type="number" min="0.01" step="0.01" required /></label>{picker("documentId")}
      <button disabled={busy}>Record for independent match</button></form>}</section>}
 {only(task,"subcontract-review-invoice") && pendingInvoice && exact(pendingInvoice) && <section className={styles.card}><h2>Match supplier invoice</h2>
   <p>{pendingInvoice.invoiceNumber} · {money(Number(pendingInvoice.amountMinor))} · accepted deliverable {pendingInvoice.deliverableId}</p>
   <a target="_blank" rel="noreferrer" href={docUrl+"&documentId="+pendingInvoice.documentId}>Inspect retained supplier invoice</a>
   {role === "admin" && !stale && <form className={styles.inline} onSubmit={review("review-invoice","invoiceId",pendingInvoice)}>
     <input name="agreementId" type="hidden" value={pendingInvoice.agreementId} /><label>Decision<select name="decision"><option value="Matched">Match</option><option value="Hold">Hold</option></select></label>
     <label>Review reason<input name="reason" minLength={10} required /></label><button disabled={busy}>Record match</button></form>}</section>}
 {only(task,"subcontract-cost-invoice") && <section className={styles.card}><h2>Post reconciled subcontract cost</h2>
   <p>Finance reconciles the matched invoice against the original positive commitment. This does not release Work authority.</p></section>}
 {role === "billing_commercial_lead" && !stale && (!task || ["subcontract-cost-commitment","subcontract-cost-invoice"].includes(task.step)) && <section className={styles.card}><h2>Finance reconciliation</h2>
   {position?.reservations.filter((item) => item.amount_minor>0 && (!task || task.step !== "subcontract-cost-commitment" || item.id === task.decision) && !position.costLinks.some((link) => link.kind === "Committed" && link.reservationId === item.id)).map((item) =>
     <p key={item.id}>Approved reservation {money(item.amount_minor)} · agreement {item.agreement_id}
       <button disabled={busy || position.financeRevision === null} onClick={() => void command("post-commitment", {}, item.id)}>Post commitment</button></p>)}
   {state?.invoices.filter((item) => item.status === "Matched" && (!task || task.step !== "subcontract-cost-invoice" || item.id === task.decision) && !position?.costLinks.some((link) => link.kind === "Incurred" && link.invoiceId === item.id)).map((item) =>
     <p key={String(item.id)}>Matched invoice {item.invoiceNumber} · {money(Number(item.amountMinor))}
       <button disabled={busy || position?.financeRevision === null} onClick={() => void command("post-invoice", {}, String(item.id))}>Post incurred cost</button></p>)}</section>}
 {!task && <section className={styles.card}><h2>Retained history and next work</h2>
   {allocations.map((item) => <p key={String(item.id)}>Allocation {item.status} · {money(Number(item.capMinor))} · {item.reviewReason}</p>)}
   {agreements.map((item) => <p key={String(item.id)}>Agreement {item.agreementReference} · {item.status} · {money(Number(item.revisedMinor))}</p>)}
   {state?.variations.map((item) => <p key={String(item.id)}>Variation {item.status} · {money(Number(item.deltaMinor))} · {item.scopeDifference}</p>)}
   {state?.deliverables.map((item) => <p key={String(item.id)}>Delivery {item.status} · {money(Number(item.amountMinor))} · {item.description}</p>)}
   {state?.invoices.map((item) => <p key={String(item.id)}>Supplier invoice {item.invoiceNumber} · {item.status} · {money(Number(item.amountMinor))}</p>)}
   <p>Remaining obligations stay visible here. Worker qualification, on-site safety/release, supplier payment and contract administration outside this fixed-price slice remain separate.</p></section>}
 </main></div>;
}
