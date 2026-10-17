"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "./GraybarWorkspace.module.css";
import { PurchaseAuthorityPanel } from "./PurchaseAuthorityPanel";

type Row = Record<string, string>;
type Quote = { id: string; quoteNumber: string; quoteRevision: string; accountReference: string; quotedAt: string; expiresAt: string; currency: string; documentId: string; lines: Row[]; freightMinor?: string; totalMinor: number; status: string };
type Bom = { id: string; status: string; lines: Row[]; designRevision: number; preparedBy: string; romDifference: string };
type Shipment = { id: string; orderId: string; trackingReference: string; lines: Row[] };
type Receipt = { id: string; shipmentId: string; location: string; status: string; lines: Row[] };
type Invoice = { id: string; invoiceNumber: string; status: string; totalMinor: number; orderId: string };
type Order = { id: string; status: string; bomId: string; accountReference: string; shipTo: string; lines: Row[]; amountMinor: number; budgetMinor: number; acknowledgment?: Row };
type Document = { id: string; kind: string; filename: string; sha256: string };
type Procurement = { revision: number; state: { quotes: Quote[]; assessments: Row[]; bom: Bom | null; orders: Order[]; shipments: Shipment[]; receipts: Receipt[]; supplierInvoices: Invoice[]; returns: Row[]; credits: Row[]; installed: Row[] }; documents: Document[] };
type AuthoritySummary = { revision: number; source: { digest: string; kind: string } | null;
  parentCapMinor: number | null; purchaseCapMinor: number | null; parentRemainingMinor: number | null;
  purchaseRemainingMinor: number | null; designCommittedMinor: number; purchaseReservedMinor: number;
  authorities: Array<{ id: string; status: string; conditions: string; valid_until: string }> };
type FinancePosting = { financeRevision: number; links: Array<{ orderId: string; invoiceId?: string; materialId: string; kind: string; costId: string; amountMinor: number; source: string }> };
type Work = { id: string; title: string; customer?: string; site?: string; definition?: { scopeControl?: { requirements?: Array<{ id: string; need: string }> } }; discovery?: { estimate?: { detailed?: { status?: string } } }; design?: {
  packages?: Array<{ packageId: string; revision: number; status: string; materialLines?: Array<{ id: string; item: string; quantity: number; unit: string }> }>;
  releases?: Array<{ id: string; packageId: string; packageRevision: number; status: string; snapshot: { scope: string; materialLines?: Array<{ id: string; item: string; quantity: number; unit: string }> } }> }; operate?: { assets?: Array<{ id: string; name: string }> } };
const money = (value: number | string | undefined) => typeof value === "undefined" ? "Not stated" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) / 100);
const minor = (value: string) => Math.round(Number(value || 0) * 100);
const initialLine = (): Row => ({ lineNumber: "1", graybarSku: "", manufacturer: "", manufacturerPartNumber: "", description: "", quantity: "", unit: "each", packSize: "1", priceBasis: "each", unitPriceMinor: "", extendedMinor: "", noCostReason: "", availability: "", leadTime: "", returnability: "" });
const cells = (form: FormData) => Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));
const docUrl = (workspace: string, workId: string, id: string) => `/api/d5o-hosted/graybar-document?workspace=${encodeURIComponent(workspace)}&workId=${encodeURIComponent(workId)}&documentId=${encodeURIComponent(id)}`;
export function GraybarWorkspace({ workspace, workId, role, build, task, initialSection }: { workspace: string; workId: string; role: string; build: string; initialSection?: string;
  task?: { step: string; sourceRevision: number; decision: string } }) {
  const [data, setData] = useState<Procurement | null>(null), [work, setWork] = useState<Work | null>(null);
  const [financePosting, setFinancePosting] = useState<FinancePosting | null>(null);
  const [authority, setAuthority] = useState<AuthoritySummary | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [extraction, setExtraction] = useState("");
  const [sourceDocumentId, setSourceDocumentId] = useState("");
  const [quoteLines, setQuoteLines] = useState<Row[]>([initialLine()]);
  const taskSection = task?.step?.startsWith("authority-") ? "authority" : task?.step === "cost-po" ? "po" : task?.step === "cost-invoice" ? "invoice" : task?.step;
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [bomLines, setBomLines] = useState<Row[]>([]), [section, setSection] = useState(taskSection ?? (["quote", "assess", "rom", "bom", "authority", "po", "fulfill", "invoice", "operate"].includes(initialSection ?? "") ? initialSection! : "quote"));
  const url = `/api/d5o-hosted/graybar?workspace=${encodeURIComponent(workspace)}&workId=${encodeURIComponent(workId)}`;
  const refresh = useCallback(async () => {
    const [procurement, firstWorkResult, financeResult, authorityResult] = await Promise.all([fetch(url, { cache: "no-store" }),
      fetch(`/api/d5o-hosted/prototype-state?workspace=${encodeURIComponent(workspace)}&key=work`, { cache: "no-store" }),
      ["admin", "project_manager", "billing_commercial_lead"].includes(role)
        ? fetch(`/api/d5o-hosted/graybar-job-cost?workspace=${encodeURIComponent(workspace)}&workId=${encodeURIComponent(workId)}`, { cache: "no-store" })
        : Promise.resolve(null),
      ["admin", "project_manager", "billing_commercial_lead"].includes(role)
        ? fetch(`/api/d5o-hosted/purchase-authority?workspace=${encodeURIComponent(workspace)}&workId=${encodeURIComponent(workId)}`, { cache: "no-store" })
        : Promise.resolve(null)]);
    let workResult = firstWorkResult;
    for (let attempt = 0; attempt < 3 && !workResult.ok; attempt++) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
      workResult = await fetch(`/api/d5o-hosted/prototype-state?workspace=${encodeURIComponent(workspace)}&key=work`, { cache: "no-store" });
    }
    const parsed = await procurement.json();
    if (!procurement.ok) { setNotice(parsed.error ?? "Procurement unavailable"); return; }
    setData(parsed as Procurement);
    if (financeResult?.ok) setFinancePosting(await financeResult.json() as FinancePosting);
    if (authorityResult?.ok) setAuthority(await authorityResult.json() as AuthoritySummary);
    if (workResult.ok) {
      const body = await workResult.json();
      const records = body.state?.records as Work[] | undefined;
      setWork(records?.find((item) => item.id === workId) ?? null);
    }
  }, [url, workId, workspace, role]);
  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, [refresh]);
  const command = async (action: string, input: Record<string, unknown>) => {
    if (!data) return;
    if (task && (data.revision !== task.sourceRevision ||
      task.step === "bom" && (data.state.bom?.id !== task.decision || data.state.bom?.status !== "Prepared") ||
      task.step === "po" && !data.state.orders.some((order) => order.id === task.decision && order.status === "Prepared") ||
      task.step === "invoice" && !data.state.supplierInvoices.some((invoice) => invoice.id === task.decision && ["Review", "Exception"].includes(invoice.status)))) {
      setNotice("This exact task changed or was decided. Return to My Work for the current action."); return;
    }
    setBusy(true); setNotice("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, input, expectedRevision: data.revision, commandId: crypto.randomUUID() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Command failed");
      setData(result as Procurement); setNotice(`${action.replaceAll("-", " ")} saved at procurement revision ${result.revision}.`);
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Command unavailable"); }
    finally { setBusy(false); }
  };
  const upload = async (form: FormData) => {
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/d5o-hosted/graybar-document?workspace=${workspace}&workId=${workId}`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Upload failed");
      setExtraction(JSON.stringify(result.extraction, null, 2));
      setSourceDocumentId(result.documentId);
      setNotice(`Private document retained as ${result.documentId}; SHA-256 ${result.sha256}. Review every field before accepting it.`);
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Upload unavailable"); }
    finally { setBusy(false); }
  };
  const postJobCost = async (action: "post-commitment" | "post-matched-invoice", input: Record<string, string>) => {
    if (!data || !financePosting) return;
    if (task && (data.revision !== task.sourceRevision ||
      task.step === "cost-po" && (action !== "post-commitment" || input.orderId !== task.decision || financePosting.links.some((link) => link.orderId === task.decision && link.kind === "Committed")) ||
      task.step === "cost-invoice" && (action !== "post-matched-invoice" || input.invoiceId !== task.decision || financePosting.links.some((link) => link.invoiceId === task.decision && link.kind === "Incurred")))) {
      setNotice("This exact Finance source changed or was posted. Return to My Work for the current action."); return;
    }
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/d5o-hosted/graybar-job-cost?workspace=${encodeURIComponent(workspace)}&workId=${encodeURIComponent(workId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, input, commandId: crypto.randomUUID(), graybarRevision: data.revision,
          financeRevision: financePosting.financeRevision }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Supplier cost posting failed");
      await refresh();
      setNotice(`${action.replaceAll("-", " ")} saved at Finance revision ${result.financeRevision}. Review the linked source in Job Finance.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Supplier cost posting unavailable"); }
    finally { setBusy(false); }
  };
  const quotes = data?.state.quotes ?? [], assessments = data?.state.assessments ?? [], bom = data?.state.bom ?? null;
  const orders = data?.state.orders ?? [];
  const currentOrder = orders.find((order) => order.id === selectedOrderId) ??
    orders.find((order) => order.status === "Acknowledged") ??
    orders.find((order) => order.status === "Test submitted") ?? orders.at(-1);
  const staleTask = !!task && !task.step.startsWith("authority-") && !!data && (data.revision !== task.sourceRevision ||
    task.step === "bom" && (bom?.id !== task.decision || bom?.status !== "Prepared") ||
    task.step === "po" && !orders.some((order) => order.id === task.decision && order.status === "Prepared") ||
    task.step === "invoice" && !data.state.supplierInvoices.some((invoice) => invoice.id === task.decision && ["Review", "Exception"].includes(invoice.status)) ||
    task.step === "cost-po" && !!financePosting && (!orders.some((order) => order.id === task.decision && ["Approved", "Test submitted", "Acknowledged"].includes(order.status)) || financePosting.links.some((link) => link.orderId === task.decision && link.kind === "Committed")) ||
    task.step === "cost-invoice" && !!financePosting && (!data.state.supplierInvoices.some((invoice) => invoice.id === task.decision && invoice.status === "Matched") || financePosting.links.some((link) => link.invoiceId === task.decision && link.kind === "Incurred")));
  const materialReadiness = (bom?.lines ?? []).filter((line) => line.supplyResponsibility === "Rybex").map((line) => {
    const shipmentIds = new Set((data?.state.shipments ?? []).filter((shipment) => orders.some((order) => order.id === shipment.orderId && order.bomId === bom?.id)).map((shipment) => shipment.id));
    const received = (data?.state.receipts ?? []).filter((receipt) => shipmentIds.has(receipt.shipmentId))
      .flatMap((receipt) => receipt.lines).filter((item) => item.materialId === line.materialId)
      .reduce((sum, item) => sum + Number(item.acceptedQuantity ?? 0), 0);
    const returned = (data?.state.returns ?? []).filter((item) => item.materialId === line.materialId)
      .reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
    return { materialId: line.materialId, item: line.item, packageId: line.packageId, quantity: line.quantity,
      unit: line.unit, available: received - returned, ready: received - returned >= Number(line.quantity) };
  });
  const acceptedReleases = work?.design?.releases?.filter((item) => item.status === "Accepted") ?? [];
  const materialOptions = (work?.design?.packages ?? []).filter((pkg) => ["In review", "Approved"].includes(pkg.status))
    .flatMap((pkg) => (pkg.materialLines ?? []).map((material) => ({ pkg, material,
      release: acceptedReleases.find((item) => item.packageId === pkg.packageId && item.packageRevision === pkg.revision) })));
  const quotationOptions = quotes.flatMap((quote) => quote.lines.map((line) => ({ quote, line })));
  const eligibleOffers = quotationOptions.filter(({ quote, line }) => assessments.some((item) => item.quoteId === quote.id && item.lineNumber === line.lineNumber && item.result === "Meets") &&
    !assessments.some((item) => item.quoteId === quote.id && item.lineNumber === line.lineNumber && item.result === "Fails"));
  const canPrepare = ["admin", "project_manager"].includes(role), canTechnical = ["admin", "operations_leader"].includes(role);
  const canFinance = ["admin", "billing_commercial_lead"].includes(role);
  const readyBomLines = useMemo(() => bomLines.filter((line) => line.materialId && line.quoteId), [bomLines]);
  return <div className={styles.shell}>
    <header className={styles.top}><Link href={`/work?workspace=${workspace}`}>D5O / Rybex</Link><span>Graybar procurement · {role.replaceAll("_", " ")}</span><small>Build {build.slice(0, 12)}</small></header>
    <main className={styles.main}>
      <div className={styles.heading}><div><p className={styles.eyebrow}>Connected work · document channel</p><h1>Source, buy and receive materials</h1>
        <p>{work?.title ?? workId} · {work?.customer ?? "Customer not stated"} · {work?.site ?? "Site not stated"}</p></div>
        <div className={styles.inline}><Link href={`/work?workspace=${workspace}&record=${encodeURIComponent(workId)}`}>Open Work Record</Link>{task ? <><Link href={`/work?workspace=${workspace}&view=my-work`}>Back to My Work</Link><Link href={`/work/procurement?workspace=${workspace}&workId=${encodeURIComponent(workId)}`}>Supporting procurement context</Link></> : null}</div></div>
      <div className={styles.notice}>Graybar account connection is unconfigured. These records use retained documents and controlled local submission; they do not send an order or query live account pricing. AI provider unavailable: extracted fields require human review.</div>
      {staleTask && <div role="alert" className={styles.notice}>This exact decision changed or was completed. No substitute Work, order or invoice was opened. <Link href={`/work?workspace=${workspace}&view=my-work`}>Return to refreshed My Work</Link>.</div>}
      {notice && <div role="status" className={styles.status}>{notice}</div>}
      <nav aria-label="Procurement steps" className={styles.steps}>{[["quote", "01 Quote"], ["assess", "02 Product fit"], ["rom", "03 ROM"], ["bom", "04 Design BOM"], ["authority", "05 Spending authority"], ["po", "06 Purchase order"], ["fulfill", "06 Delivery"], ["invoice", "07 Supplier invoice"], ["operate", "08 Operate"]].filter(([key]) => !task || key === taskSection).map(([key, label]) =>
        <button key={key} type="button" aria-current={section === key ? "step" : undefined} onClick={() => setSection(key)}>{label}</button>)}</nav>
      <div className={styles.content}>
      {section === "quote" && <section className={styles.card}><h2>Review a distributor quote</h2><p>Upload a Graybar PDF, CSV or XLSX schedule. The original bytes and checksum are retained. Extraction is a draft, never an accepted offer.</p>
        <form onSubmit={(event) => { event.preventDefault(); void upload(new FormData(event.currentTarget)); }} className={styles.inline}>
          <label>Document kind<select name="kind"><option value="quote">Quote</option><option value="specification">Product specification</option><option value="acknowledgment">Acknowledgment</option><option value="delivery">Delivery document</option><option value="supplier_invoice">Supplier invoice</option></select></label>
          <label>Private file<input type="file" name="file" accept=".pdf,.csv,.xlsx" required /></label><button disabled={busy}>Retain and inspect</button></form>
        {data?.documents.length ? <div className={styles.sourceReview}><label>Retained source document<select value={sourceDocumentId} onChange={(event) => setSourceDocumentId(event.target.value)}><option value="">Choose a source to inspect</option>{data.documents.map((doc) => <option key={doc.id} value={doc.id}>{doc.kind} · {doc.filename}</option>)}</select></label>
          {sourceDocumentId ? <><a href={docUrl(workspace, workId, sourceDocumentId)} target="_blank" rel="noreferrer">Open original private document ↗</a>{data.documents.find((doc) => doc.id === sourceDocumentId)?.filename.toLowerCase().endsWith(".pdf") ? <iframe title="Original supplier document" src={docUrl(workspace, workId, sourceDocumentId)} /> : null}</> : null}
          <div><b>Extracted fields — review against the original</b><p>Extraction is a draft. Correct the reviewed quote lines below before acceptance.</p>{extraction ? <pre className={styles.extraction}>{extraction}</pre> : <p>Earlier source bytes remain available above. Upload a new file to see its current extraction.</p>}</div></div> : null}
        <h3>Accept reviewed quote revision</h3><p>Supplier list prices are not assumed to be Rybex account prices. Enter the exact account offer, unit and pack basis.</p>
        {canPrepare ? <form onSubmit={(event) => { event.preventDefault(); const values = cells(new FormData(event.currentTarget));
          const prepared = quoteLines.map((line) => ({ ...line, unitPriceMinor: String(minor(line.unitPriceMinor)), extendedMinor: String(Math.round(Number(line.quantity) / Number(line.packSize) * minor(line.unitPriceMinor))) }));
          void command("accept-quote", { ...values, currency: "USD", freightMinor: String(minor(values.freightMinor)), totalMinor: String(prepared.reduce((sum, line) => sum + Number(line.extendedMinor), 0) + minor(values.freightMinor)), lines: prepared });
        }}><div className={styles.grid}><label>Retained quote document<select name="documentId" required><option value="">Choose file</option>{data?.documents.filter((doc) => doc.kind === "quote").map((doc) => <option key={doc.id} value={doc.id}>{doc.filename} · {doc.sha256.slice(0, 12)}</option>)}</select></label>
          <label>Graybar account reference<input name="accountReference" required /></label><label>Quote number<input name="quoteNumber" required /></label><label>Revision<input name="quoteRevision" required /></label>
          <label>Quote date<input type="date" name="quotedAt" required /></label><label>Expires<input type="date" name="expiresAt" required /></label><label>Freight USD<input type="number" name="freightMinor" min="0" step="0.01" defaultValue="0" /></label></div>
          <div className={styles.tableWrap}><table><thead><tr><th>Line / SKU</th><th>Manufacturer / part</th><th>Description</th><th>Quantity / unit</th><th>Pack / basis</th><th>Net unit USD</th><th>Supplier statements</th><th>Extended USD</th><th></th></tr></thead><tbody>{quoteLines.map((line, index) => <tr key={index}>
            <td><input aria-label={`Line ${index + 1} number`} value={line.lineNumber} onChange={(e) => setQuoteLines(quoteLines.map((row, i) => i === index ? { ...row, lineNumber: e.target.value } : row))} /><input aria-label={`Line ${index + 1} Graybar SKU`} placeholder="Graybar SKU" value={line.graybarSku} onChange={(e) => setQuoteLines(quoteLines.map((row, i) => i === index ? { ...row, graybarSku: e.target.value } : row))} /></td>
            <td><input aria-label={`Line ${index + 1} manufacturer`} placeholder="Manufacturer" value={line.manufacturer} onChange={(e) => setQuoteLines(quoteLines.map((row, i) => i === index ? { ...row, manufacturer: e.target.value } : row))} /><input aria-label={`Line ${index + 1} manufacturer part`} placeholder="Manufacturer part" value={line.manufacturerPartNumber} onChange={(e) => setQuoteLines(quoteLines.map((row, i) => i === index ? { ...row, manufacturerPartNumber: e.target.value } : row))} /></td>
            <td><input aria-label={`Line ${index + 1} description`} value={line.description} onChange={(e) => setQuoteLines(quoteLines.map((row, i) => i === index ? { ...row, description: e.target.value } : row))} /></td>
            <td><input aria-label={`Line ${index + 1} quantity`} type="number" min="0.001" step="0.001" value={line.quantity} onChange={(e) => setQuoteLines(quoteLines.map((row, i) => i === index ? { ...row, quantity: e.target.value } : row))} /><input aria-label={`Line ${index + 1} unit`} value={line.unit} onChange={(e) => setQuoteLines(quoteLines.map((row, i) => i === index ? { ...row, unit: e.target.value } : row))} /></td>
            <td><input aria-label={`Line ${index + 1} pack size`} type="number" min="0.001" step="0.001" value={line.packSize} onChange={(e) => setQuoteLines(quoteLines.map((row, i) => i === index ? { ...row, packSize: e.target.value } : row))} /><select aria-label={`Line ${index + 1} price basis`} value={line.priceBasis} onChange={(e) => setQuoteLines(quoteLines.map((row, i) => i === index ? { ...row, priceBasis: e.target.value } : row))}><option value="each">Each</option><option value="pack">Pack</option><option value="length">Length</option></select></td>
            <td><input aria-label={`Line ${index + 1} net unit price`} type="number" min="0" step="0.01" value={line.unitPriceMinor} onChange={(e) => setQuoteLines(quoteLines.map((row, i) => i === index ? { ...row, unitPriceMinor: e.target.value } : row))} />{line.unitPriceMinor !== "" && Number(line.unitPriceMinor) === 0 ? <input aria-label={`Line ${index + 1} no-cost reason`} placeholder="Why is source cost zero?" value={line.noCostReason} onChange={(e) => setQuoteLines(quoteLines.map((row, i) => i === index ? { ...row, noCostReason: e.target.value } : row))} /> : null}</td>
            <td><input aria-label={`Line ${index + 1} availability`} placeholder="Availability (not stated if blank)" value={line.availability} onChange={(e) => setQuoteLines(quoteLines.map((row, i) => i === index ? { ...row, availability: e.target.value } : row))} /><input aria-label={`Line ${index + 1} lead time`} placeholder="Supplier lead statement" value={line.leadTime} onChange={(e) => setQuoteLines(quoteLines.map((row, i) => i === index ? { ...row, leadTime: e.target.value } : row))} /><input aria-label={`Line ${index + 1} returnability`} placeholder="Returnability / restriction" value={line.returnability} onChange={(e) => setQuoteLines(quoteLines.map((row, i) => i === index ? { ...row, returnability: e.target.value } : row))} /></td><td>{money(Math.round(Number(line.quantity || 0) / Number(line.packSize || 1) * minor(line.unitPriceMinor)))}</td><td><button type="button" onClick={() => setQuoteLines(quoteLines.filter((_, i) => i !== index))}>Remove</button></td></tr>)}</tbody></table></div>
          <div className={styles.inline}><button type="button" onClick={() => setQuoteLines([...quoteLines, { ...initialLine(), lineNumber: String(quoteLines.length + 1) }])}>Add quote line</button><button className={styles.primary} disabled={busy || !data?.documents.some((doc) => doc.kind === "quote")}>Accept reviewed quote</button></div></form> : <p>Project management or Commercial accepts source pricing. Your role can inspect the retained quote.</p>}
        <h3>Accepted versions</h3>{quotes.length ? quotes.map((quote) => <article className={styles.record} key={quote.id}><b>{quote.quoteNumber} rev {quote.quoteRevision}</b><span>{quote.accountReference} · {quote.currency} {money(quote.totalMinor)} · expires {quote.expiresAt}</span><a href={docUrl(workspace, workId, quote.documentId)} target="_blank" rel="noreferrer">Inspect retained source</a><small>{quote.lines.length} line(s) · original revision preserved</small></article>) : <p>No accepted quote yet.</p>}
      </section>}
      {section === "assess" && <section className={styles.card}><h2>Assess product fit</h2><p>Technical suitability is separate from cost ranking. A cheaper product cannot pass an unmet requirement.</p>
        {canTechnical ? <form onSubmit={(event) => { event.preventDefault(); void command("assess-product", cells(new FormData(event.currentTarget))); }} className={styles.grid}>
          <label>Quoted product<select name="source" required onChange={(e) => { const [quoteId, lineNumber] = e.target.value.split("|"); const form = e.target.form; if (form) { (form.elements.namedItem("quoteId") as HTMLInputElement).value = quoteId; (form.elements.namedItem("lineNumber") as HTMLInputElement).value = lineNumber; } }}><option value="">Choose quote line</option>{quotationOptions.map(({ quote, line }) => <option key={`${quote.id}-${line.lineNumber}`} value={`${quote.id}|${line.lineNumber}`}>{quote.quoteNumber} · {line.graybarSku} · {line.description}</option>)}</select></label>
          <input type="hidden" name="quoteId" /><input type="hidden" name="lineNumber" />
          <label>Define requirement<select name="requirementId" required><option value="">Choose requirement</option>{work?.definition?.scopeControl?.requirements?.map((item) => <option key={item.id} value={item.id}>{item.need}</option>)}</select></label>
          <label>Finding<select name="result"><option>Meets</option><option>Alternative</option><option>Insufficient evidence</option><option>Fails</option></select></label>
          <label>Retained specification or quote<select name="specificationDocumentId" required><option value="">Choose source</option>{data?.documents.filter((doc) => ["specification", "quote"].includes(doc.kind)).map((doc) => <option key={doc.id} value={doc.id}>{doc.filename}</option>)}</select></label><label>Specification section<input name="specificationSource" required placeholder="Page, table, or section" /></label><label>Rationale and unresolved condition<textarea name="rationale" required /></label><label>Accessories and compatibility follow-up<input name="accessoryAssessment" placeholder="Not stated, required item or unresolved condition" /></label><button className={styles.primary} disabled={busy}>Record independent assessment</button></form> : <p>Operations or an administrator reviews technical eligibility independently of quote acceptance.</p>}
        <h3>Technically eligible Graybar options</h3><p>Compare only reviewed products that meet the recorded requirement. Freight is quote-level and unallocated; a stated charge holds purchasing until governed treatment exists. Supplier availability and restrictions are shown only when stated.</p>{eligibleOffers.map(({ quote, line }) => <article className={styles.record} key={`${quote.id}-${line.lineNumber}`}><b>{line.description} · {line.graybarSku}</b><span>{money(line.unitPriceMinor)} per {line.packSize} {line.unit} · extended {money(line.extendedMinor)} · quote {quote.quoteNumber} rev {quote.quoteRevision}</span><small>Availability: {line.availability || "Not stated"} · Lead: {line.leadTime || "Not stated"} · Returnability: {line.returnability || "Not stated"} · Expires {quote.expiresAt}</small><small>Freight on source quote: {money(quote.freightMinor)}; accessory assessment in reviewed findings below.</small></article>)}
        <h3>Recorded assessments</h3>{assessments.map((item, index) => <article key={index} className={styles.record}><b>{item.result} · line {item.lineNumber}</b><span>Requirement {item.requirementId} · {item.rationale}</span><small>{item.specificationSource} · Accessories: {item.accessoryAssessment || "Not stated"}</small></article>)}
      </section>}
      {section === "rom" && <section className={styles.card}><h2>Develop ROM from accepted source costs</h2><p>Distributor purchase cost and customer selling price are separate decisions. Use the approved pricing policy, requirement coverage, labor and contingency in Develop.</p>
        <p>Current ROM: <strong>{work?.discovery?.estimate?.detailed?.status ?? "Open in Develop"}</strong>. An accepted Graybar quote is a source, not a ROM approval or purchase authorization.</p>
        {quotationOptions.map(({ quote, line }) => <article className={styles.record} key={`${quote.id}-${line.lineNumber}`}><b>{line.description}</b><span>{line.quantity} {line.unit} · {money(line.unitPriceMinor)} per {line.packSize} {line.unit} · {money(line.extendedMinor)} source cost</span><small>Quote {quote.quoteNumber} rev {quote.quoteRevision}, line {line.lineNumber}, expires {quote.expiresAt}</small></article>)}
        <Link className={styles.primaryLink} href={`/work?workspace=${workspace}&view=develop&record=${encodeURIComponent(workId)}`}>Open Develop estimating</Link>
      </section>}
      {section === "bom" && <section className={styles.card}><h2>Confirm the Design BOM</h2><p>Each material must match the current reviewed Design package and a technically eligible source offer. A BOM may precede release; purchasing never authorizes field execution.</p>
        <p>{work ? `${acceptedReleases.length} accepted release(s); ${materialOptions.length} current reviewed Design material line(s).` : "Loading the current Work and Design source…"}</p>
        {work && canPrepare && bom?.status !== "Approved" ? <><div className={styles.tableWrap}><table><thead><tr><th>Current Design material</th><th>Source offer</th><th>Supply and date</th></tr></thead><tbody>{materialOptions.map(({ pkg, release, material }) => { const saved = bomLines.find((item) => item.materialId === material.id); return <tr key={material.id}><td><b>{material.item}</b><br />{material.quantity} {material.unit} · package {pkg.packageId}<br /><small>Design revision {pkg.revision} · {release ? `release ${release.id}` : "release pending"}</small></td><td><select aria-label={`Quote for ${material.item}`} value={`${saved?.quoteId ?? ""}|${saved?.lineNumber ?? ""}`} onChange={(event) => { const [quoteId, lineNumber] = event.target.value.split("|"); setBomLines((current) => [...current.filter((item) => item.materialId !== material.id), { packageId: pkg.packageId, packageRevision: String(pkg.revision), materialId: material.id, item: material.item, quantity: String(material.quantity), unit: material.unit, quoteId, lineNumber, supplyResponsibility: "Rybex", requiredDate: new Date().toISOString().slice(0, 10) }]); }}><option value="|">Choose assessed offer</option>{quotationOptions.filter(({ line }) => line.description === material.item && line.unit === material.unit && assessments.some((a) => a.quoteId === quotes.find((q) => q.lines.includes(line))?.id && a.lineNumber === line.lineNumber && a.result === "Meets")).map(({ quote, line }) => <option key={`${quote.id}-${line.lineNumber}`} value={`${quote.id}|${line.lineNumber}`}>{quote.quoteNumber} · {line.graybarSku} · {money(line.unitPriceMinor)}</option>)}</select></td><td><select aria-label={`Supply owner for ${material.item}`} value={saved?.supplyResponsibility ?? "Rybex"} onChange={(event) => setBomLines((current) => current.map((item) => item.materialId === material.id ? { ...item, supplyResponsibility: event.target.value } : item))}><option>Rybex</option><option>Customer</option></select><input aria-label={`Required date for ${material.item}`} type="date" value={saved?.requiredDate ?? ""} onChange={(event) => setBomLines((current) => current.map((item) => item.materialId === material.id ? { ...item, requiredDate: event.target.value } : item))} /></td></tr>; })}</tbody></table></div>
          <form onSubmit={(event) => { event.preventDefault(); const values = cells(new FormData(event.currentTarget)); void command("prepare-bom", { lines: readyBomLines, romDifference: values.romDifference, unpricedDifferences: values.unpricedDifferences }); }} className={styles.grid}><label>ROM-to-BOM quantity/specification difference<textarea name="romDifference" required placeholder="Explain exact quantity or specification change" /></label><label>Unpriced differences or follow-up<textarea name="unpricedDifferences" placeholder="State none if supported" /></label><button className={styles.primary} disabled={busy || readyBomLines.length !== materialOptions.length || !readyBomLines.length}>Prepare exact BOM revision</button></form></> : null}
        {bom && <article className={styles.record}><b>{bom.status} BOM · {bom.lines.length} lines</b><span>Design revision {bom.designRevision}. ROM difference: {bom.romDifference || "Not recorded"}</span><small>Historical ROM is not overwritten.</small></article>}
        {bom?.status === "Prepared" && canTechnical && <form onSubmit={(event) => { event.preventDefault(); void command("approve-bom", cells(new FormData(event.currentTarget))); }} className={styles.inline}><label>Independent technical decision note<input name="reviewNote" required /></label><button className={styles.primary} disabled={busy}>Approve BOM</button></form>}
      </section>}
      {section === "authority" && <PurchaseAuthorityPanel workspace={workspace} workId={workId} role={role} refreshKey={data?.revision ?? 0} orders={orders} task={task} onChanged={refresh} />}
      {section === "po" && <section className={styles.card}><h2>Purchasing plan and purchase order</h2><p>Only a current approved BOM may be purchased. PM prepares; a different workspace administrator approves. A current independently approved Work and purchasing limit is required before PO approval. No role receives automatic supplier-submission authority. A quote with stated freight is held until its charge treatment is configured and included in the budget.</p>
        {authority && <article className={styles.record}><b>Current Work purchasing authority</b>
          <span>Work limit {money(authority.parentCapMinor ?? undefined)} · remaining {money(authority.parentRemainingMinor ?? undefined)}.
            Purchasing allocation {money(authority.purchaseCapMinor ?? undefined)} · remaining {money(authority.purchaseRemainingMinor ?? undefined)}.</span>
          <small>Design commitments {money(authority.designCommittedMinor)} and approved POs {money(authority.purchaseReservedMinor)} consume the Work limit once.
            {authority.parentCapMinor === null ? " Independent authority is required before PO approval." : ""}</small>
          <Link href={`/work/procurement?workspace=${workspace}&workId=${encodeURIComponent(workId)}&step=authority`}>Review authority and conditions</Link>
        </article>}
        {financePosting ? <p>Job Finance posting: {financePosting.links.some((item) => item.kind === "Committed") ? money(financePosting.links.filter((item) => item.kind === "Committed").reduce((sum, item) => sum + item.amountMinor, 0)) : "Not posted"} sourced commitment; {financePosting.links.some((item) => item.kind === "Incurred") ? money(financePosting.links.filter((item) => item.kind === "Incurred").reduce((sum, item) => sum + item.amountMinor, 0)) : "Not posted"} reconciled incurred cost. These are Finance ledger facts, not supplier payments.</p> : null}
        {bom?.status === "Approved" && canPrepare && <form className={styles.grid} onSubmit={(event) => { event.preventDefault(); const values = cells(new FormData(event.currentTarget)); void command("prepare-po", { ...values, lines: bom.lines.filter((line) => line.supplyResponsibility === "Rybex")
            .map((line) => ({ materialId: line.materialId, quantity: values[`po-${line.materialId}`] ?? "0", unit: line.unit }))
            .filter((line) => Number(line.quantity) > 0), budgetMinor: String(minor(values.budgetUsd)) }); }}>
          {bom.lines.filter((line) => line.supplyResponsibility === "Rybex").map((line) =>
            <label key={line.materialId}>Purchase quantity · {line.item} (approved {line.quantity} {line.unit})
              <input type="number" name={`po-${line.materialId}`} min="0" max={line.quantity}
                step="0.001" defaultValue={line.quantity} required /></label>)}
          <label>Graybar account reference<input name="accountReference" required defaultValue={quotes.at(-1)?.accountReference} /></label><label>Delivery / ship-to address<input name="shipTo" required /></label><label>Required date<input type="date" name="requiredDate" required /></label><label>Draft planning ceiling USD (not spending authority)<input type="number" name="budgetUsd" min="0.01" step="0.01" required /></label><button className={styles.primary} disabled={busy}>Prepare purchase order</button></form>}
        {orders.map((order) => <article className={styles.record} key={order.id}><b>PO {order.id.slice(0, 8)} · {order.status}</b><span>{order.accountReference} · {money(order.amountMinor)} committed when approved · ship to {order.shipTo}</span><small>BOM {order.bomId} · draft planning ceiling {money(order.budgetMinor)} · supplier acknowledgment {order.acknowledgment ? "retained" : "not recorded"}</small>
          <div className={styles.inline}><a href={`/api/d5o-hosted/graybar-po?workspace=${workspace}&workId=${workId}&orderId=${order.id}`}>Download supplier-facing PO PDF</a>{order.status === "Prepared" && canPrepare && <button disabled={busy} onClick={() => { const reason = window.prompt("Why is this unapproved PO draft being abandoned? No authority was reserved."); if (reason && reason.trim().length >= 10) void command("cancel-po-draft", { orderId: order.id, reason: reason.trim() }); }}>Cancel draft</button>}{order.status === "Prepared" && role === "admin" && <button disabled={busy || !authority?.parentCapMinor || authority.purchaseRemainingMinor === null || order.amountMinor > authority.purchaseRemainingMinor || authority.parentRemainingMinor === null || order.amountMinor > authority.parentRemainingMinor} onClick={() => void command("approve-po", { orderId: order.id, authorityBasis: "Active workspace administrator" })}>Approve independently</button>}{order.status === "Approved" && role === "admin" && <button disabled={busy} onClick={() => void command("record-test-submission", { orderId: order.id, testOnly: true, sourceReference: `Fictional local handoff ${new Date().toISOString()}` })}>Record controlled test submission</button>}{role === "billing_commercial_lead" && ["Approved", "Test submitted", "Acknowledged"].includes(order.status) && financePosting && !financePosting.links.some((link) => link.orderId === order.id && link.kind === "Committed") ? <button disabled={busy} onClick={() => void postJobCost("post-commitment", { orderId: order.id })}>Post sourced PO commitment to Job Finance</button> : null}</div></article>)}
      </section>}
      {section === "fulfill" && <section className={styles.card}><h2>Acknowledgment, shipment and physical receipt</h2><p>Supplier acknowledgment is not a shipment. A shipment is not a physical receipt. Exceptions remain visible.</p>
        <label>Exact purchase order<select value={currentOrder?.id ?? ""} onChange={(event) => setSelectedOrderId(event.target.value)}><option value="">Choose order</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.id.slice(0, 8)} · {order.status} · {money(order.amountMinor)}</option>)}</select></label>
        <h3>Package material readiness from physical counts</h3>{materialReadiness.map((line) => <p key={line.materialId}><strong>{line.item}</strong> · package {line.packageId} · {line.available} of {line.quantity} {line.unit} received and not returned · {line.ready ? "Ready" : "Shortage"}</p>)}
        {currentOrder?.status === "Test submitted" && canTechnical && <form onSubmit={(event) => { event.preventDefault(); const values = cells(new FormData(event.currentTarget)); void command("record-acknowledgment", { ...values, orderId: currentOrder.id,
          lines: currentOrder.lines.map((line) => ({ ...line, promisedDate: values.promisedDate })) }); }} className={styles.grid}>
          <label>Retained acknowledgment<select name="documentId" required><option value="">Select file</option>{data?.documents.filter((doc) => doc.kind === "acknowledgment").map((doc) => <option key={doc.id} value={doc.id}>{doc.filename}</option>)}</select></label><label>Graybar reference<input name="supplierReference" required /></label><label>Promised date<input type="date" name="promisedDate" required /></label><button className={styles.primary} disabled={busy}>Record acknowledgment</button></form>}
        {currentOrder?.status === "Acknowledged" && canTechnical && <form onSubmit={(event) => { event.preventDefault(); const values = cells(new FormData(event.currentTarget)); void command("record-shipment", { ...values, orderId: currentOrder.id,
          lines: currentOrder.lines.map((line) => ({ materialId: line.materialId, quantity: values[`qty-${line.materialId}`] })).filter((line) => Number(line.quantity) > 0) }); }} className={styles.grid}>
          <label>Retained delivery document<select name="documentId" required><option value="">Select file</option>{data?.documents.filter((doc) => doc.kind === "delivery").map((doc) => <option key={doc.id} value={doc.id}>{doc.filename}</option>)}</select></label><label>Tracking reference<input name="trackingReference" required /></label>
          {currentOrder.lines.map((line) => <label key={line.materialId}>Shipped {line.materialId} · ordered {line.quantity} {line.unit}<input type="number" min="0" step="0.001" name={`qty-${line.materialId}`} defaultValue="0" required /></label>)}<button className={styles.primary} disabled={busy}>Record supplier shipment</button></form>}
        {data?.state.shipments.map((shipment) => <article className={styles.record} key={shipment.id}><b>Shipment {shipment.trackingReference}</b><span>{shipment.lines.map((line) => `${line.quantity} · ${line.materialId}`).join(", ")}</span><small>Physical receipt remains a separate count.</small>
          {["admin", "operations_leader", "field_supervisor"].includes(role) && <form onSubmit={(event) => { event.preventDefault(); const values = cells(new FormData(event.currentTarget)); void command("record-receipt", { shipmentId: shipment.id, location: values.location, physicallyCounted: true,
            lines: shipment.lines.map((line) => ({ materialId: line.materialId, acceptedQuantity: values[`accepted-${line.materialId}`], rejectedQuantity: values[`rejected-${line.materialId}`] })) }); }} className={styles.grid}>
            <label>Receiving location<input name="location" required /></label>{shipment.lines.map((line) => <div key={line.materialId} className={styles.inline}><label>{line.materialId} accepted<input type="number" min="0" step="0.001" name={`accepted-${line.materialId}`} defaultValue={line.quantity} required /></label><label>Rejected / damaged<input type="number" min="0" step="0.001" name={`rejected-${line.materialId}`} defaultValue="0" required /></label></div>)}<button className={styles.primary} disabled={busy}>Confirm physically counted receipt</button></form>}</article>)}
        <h3>Returns</h3>{data?.state.returns.map((item, index) => <article className={styles.record} key={index}><b>{item.quantity} returned · {item.materialId}</b><span>{item.reason}</span><small>Supplier reference {item.supplierReturnReference}</small></article>)}
        {canTechnical && data?.state.receipts.length ? <form className={styles.grid} onSubmit={(event) => { event.preventDefault(); void command("record-return", cells(new FormData(event.currentTarget))); }}><label>Received line<select name="source" required onChange={(event) => { const [receiptId, materialId] = event.target.value.split("|"); const form = event.target.form; if (form) { (form.elements.namedItem("receiptId") as HTMLInputElement).value = receiptId; (form.elements.namedItem("materialId") as HTMLInputElement).value = materialId; } }}><option value="">Choose physically received material</option>{data.state.receipts.flatMap((receipt) => receipt.lines.map((line) => <option key={`${receipt.id}-${line.materialId}`} value={`${receipt.id}|${line.materialId}`}>{receipt.location} · {line.materialId} · {line.acceptedQuantity} accepted</option>))}</select></label><input type="hidden" name="receiptId" /><input type="hidden" name="materialId" /><label>Return quantity<input type="number" name="quantity" min="0.001" step="0.001" required /></label><label>Supplier return reference<input name="supplierReturnReference" required /></label><label>Reason<input name="reason" required /></label><button disabled={busy}>Record controlled return</button></form> : null}        <h3>Receipts and discrepancies</h3>{data?.state.receipts.map((receipt) => <article className={styles.record} key={receipt.id}><b>{receipt.location} · {receipt.status}</b><span>{receipt.lines.map((line) => `${line.materialId}: ${line.acceptedQuantity} accepted, ${line.rejectedQuantity} rejected`).join("; ")}</span><small>Receipt {receipt.id} · immutable count history</small></article>)}
      </section>}
      {section === "invoice" && <section className={styles.card}><h2>Supplier invoice matching</h2><p>This is a Graybar payable source, separate from Rybex customer invoices. No payment is executed here.</p>
        <label>Exact purchase order<select value={currentOrder?.id ?? ""} onChange={(event) => setSelectedOrderId(event.target.value)}><option value="">Choose order</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.id.slice(0, 8)} · {order.status} · {money(order.amountMinor)}</option>)}</select></label>
        {currentOrder?.status === "Acknowledged" && canFinance && <form onSubmit={(event) => { event.preventDefault(); const values = cells(new FormData(event.currentTarget)); void command("record-supplier-invoice", { ...values, orderId: currentOrder.id, currency: "USD",
          totalMinor: String(minor(values.invoiceUsd)), lines: currentOrder.lines.map((line) => ({ materialId: line.materialId,
            quantity: values[`qty-${line.materialId}`], amountMinor: String(minor(values[`amount-${line.materialId}`])) })) }); }} className={styles.grid}>
          <label>Retained supplier invoice<select name="documentId" required><option value="">Choose file</option>{data?.documents.filter((doc) => doc.kind === "supplier_invoice").map((doc) => <option key={doc.id} value={doc.id}>{doc.filename}</option>)}</select></label><label>Invoice number<input name="invoiceNumber" required /></label>
          {currentOrder.lines.map((line) => <div className={styles.inline} key={line.materialId}><label>{line.materialId} invoiced quantity<input type="number" min="0.001" step="0.001" name={`qty-${line.materialId}`} required /></label><label>Amount USD<input type="number" min="0" step="0.01" name={`amount-${line.materialId}`} required /></label></div>)}
          <label>Invoice total USD<input type="number" name="invoiceUsd" min="0" step="0.01" required /></label><button className={styles.primary} disabled={busy}>Record payable for review</button></form>}
        {data?.state.supplierInvoices.map((invoice) => <article className={styles.record} key={invoice.id}><b>Supplier invoice {invoice.invoiceNumber} · {invoice.status}</b><span>{money(invoice.totalMinor)} USD · PO {invoice.orderId}</span><small>Receipt-matched quantity; no payment recorded</small>
          {canFinance && ["Review", "Exception"].includes(invoice.status) && <div className={styles.inline}><button disabled={busy || invoice.status === "Exception"} onClick={() => void command("review-supplier-invoice", { invoiceId: invoice.id, decision: "Matched", reason: "Retained invoice and accepted physical receipt agree" })}>Approve match</button><button disabled={busy} onClick={() => void command("review-supplier-invoice", { invoiceId: invoice.id, decision: "Hold", reason: "Requires supplier correction or Finance disposition" })}>Hold discrepancy</button></div>}{role === "billing_commercial_lead" && invoice.status === "Matched" && financePosting?.links.some((link) => link.orderId === invoice.orderId && link.kind === "Committed") && !financePosting.links.some((link) => link.invoiceId === invoice.id && link.kind === "Incurred") ? <button disabled={busy} onClick={() => void postJobCost("post-matched-invoice", { orderId: invoice.orderId, invoiceId: invoice.id })}>Reconcile matched invoice to Job Finance</button> : null}</article>)}
        <h3>Supplier credits</h3>{data?.state.credits.map((item, index) => <article className={styles.record} key={index}><b>{money(item.amountMinor)} credit</b><span>{item.supplierCreditReference} · {item.reason}</span></article>)}
        {canFinance && data?.state.supplierInvoices.length ? <form className={styles.grid} onSubmit={(event) => { event.preventDefault(); const values = cells(new FormData(event.currentTarget)); void command("record-credit", { ...values, amountMinor: String(minor(values.amountUsd)) }); }}><label>Supplier invoice<select name="invoiceId" required><option value="">Choose invoice</option>{data.state.supplierInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber}</option>)}</select></label><label>Credit USD<input type="number" name="amountUsd" min="0.01" step="0.01" required /></label><label>Supplier credit reference<input name="supplierCreditReference" required /></label><label>Reason<input name="reason" required /></label><button disabled={busy}>Record sourced credit</button></form> : null}      </section>}
      {section === "operate" && <section className={styles.card}><h2>Installed equipment for support</h2><p>Record serialized equipment only after physical receipt. Consumables remain package material, not separate maintained assets.</p>
        {canTechnical && <form onSubmit={(event) => { event.preventDefault(); void command("handoff-installed", cells(new FormData(event.currentTarget))); }} className={styles.grid}>
          <label>Supported asset<select name="assetId" required><option value="">Choose asset</option>{work?.operate?.assets?.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label><label>Physical receipt<select name="receiptId" required><option value="">Choose receipt</option>{data?.state.receipts.map((receipt) => <option key={receipt.id} value={receipt.id}>{receipt.location} · {receipt.id.slice(0, 8)}</option>)}</select></label><label>Received material<select name="materialId" required><option value="">Choose material</option>{bom?.lines.map((line) => <option key={line.materialId} value={line.materialId}>{line.item}</option>)}</select></label>
          <label>Serial number<input name="serialNumber" required /></label><label>Warranty source / expiry<input name="warrantyReference" placeholder="Not stated, or retained document reference" /></label><label>Installed location<input name="installedLocation" required /></label><button className={styles.primary} disabled={busy}>Record installed-equipment handoff</button></form>}
        {data?.state.installed.map((item) => <article className={styles.record} key={item.id}><b>{item.serialNumber}</b><span>Asset {item.assetId} · material {item.materialId} · {item.installedLocation}</span><small>Supplier reference and warranty: {item.warrantyReference || "Not stated"}</small></article>)}
      </section>}
      </div><footer className={styles.footer}>Revision {data?.revision ?? "—"} · D5O Work Record {workId} · Graybar document channel only · Build {build.slice(0, 12)}</footer>
    </main></div>;
}
