"use client";

import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import type { WorkRecord } from "./work-types";
import type { PackageCrewDemand } from "./schedule-model";
import { assessDesignPackage, designRequirementRefs, designState, documentRef, type DesignMaterial, type DesignPackage, type DesignReview } from "./design-model";
import type { DesignCommand } from "@/lib/d5o/prototype-work/design-command";
import { legacyDesignControlPolicy, type DesignControlPolicy } from "./design-policy";
import type { ConfigurationInventory } from "@/lib/d5o/configuration/version-inventory";
import { DesignPipeline } from "./DesignPipeline";
import { FocusedTaskFrame } from "./FocusedTaskFrame";
import { FieldChangeDesignSummary } from "./FieldChangeDesignSummary";
import styles from "./DesignWorkspace.module.css";
import { serviceExecutionBasisIssue } from "@/lib/d5o/prototype-work/service-execution-basis";

type PackageRef = { id: string; name: string; owner: string; status: string };
type Props = {
  taskFocus?: string | null; onFullRecord?: () => void;
  work: WorkRecord; packages: PackageRef[]; packageDemands: PackageCrewDemand[];
  actorRole?: string; actorId?: string;
  allWork: WorkRecord[]; configurationInventory: ConfigurationInventory; onSelectWork: (id: string) => void;
  policy?: DesignControlPolicy;
  onCommand: (command: Omit<DesignCommand, "workId" | "expectedRevision" | "commandId">) => Promise<boolean>;
  onHandoff: (decision: "accept-design-handoff" | "return-design-handoff", note: string) => Promise<boolean>;
  onCreatePackage: (event: FormEvent<HTMLFormElement>) => void;
  demand: ReactNode; resources: ReactNode;
};
const tabs = ["Pipeline", "Basis", "Documents", "Packages", "Reviews", "Changes", "Readiness & release"] as const;
type Tab = typeof tabs[number];
const disciplines: DesignReview["discipline"][] = ["Engineering", "Delivery", "Safety", "Quality", "Procurement"];
const field = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const csv = (form: FormData, key: string) => field(form, key).split(",").map((item) => item.trim()).filter(Boolean);
const readable = (value: string | undefined) => value?.trim() || "Not recorded";

function MaterialLinesField({ initial }: { initial: DesignMaterial[] }) {
  const [rows, setRows] = useState(initial);
  const change = (index: number, patch: Partial<DesignMaterial>) => setRows((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <fieldset className={styles.materials}><legend>Approved material and procurement lines</legend><p>One item per line. Leave unknown facts blank in a draft; they remain release blockers.</p>{rows.map((row, index) => <div className={styles.materialRow} key={row.id}>
    <input type="hidden" name="materialId" value={row.id} />
    <label>Item<input name="materialItem" value={row.item} onChange={(event) => change(index, { item: event.target.value })} /></label>
    <label>Quantity<input name="materialQuantity" type="number" min="0" step="any" value={row.quantity || ""} onChange={(event) => change(index, { quantity: Number(event.target.value) })} /></label>
    <label>Unit<input name="materialUnit" value={row.unit} onChange={(event) => change(index, { unit: event.target.value })} placeholder="reels, m, each" /></label>
    <label>Source / quote<input name="materialSourceLine" value={row.source} onChange={(event) => change(index, { source: event.target.value })} /></label>
    <label>Source confidence<select name="materialConfidence" value={row.confidence ?? "Unknown"} onChange={(event) => change(index, { confidence: event.target.value as DesignMaterial["confidence"] })}>{["Unknown", "Planning assumption", "Supplier confirmed", "Physically counted"].map((value) => <option key={value}>{value}</option>)}</select></label>
    <label>Quote date<input name="materialQuoteDate" type="date" value={row.quoteDate ?? ""} onChange={(event) => change(index, { quoteDate: event.target.value })} /></label>
    <label>Quote expiry<input name="materialQuoteExpiry" type="date" value={row.quoteExpiry ?? ""} onChange={(event) => change(index, { quoteExpiry: event.target.value })} /></label>
    <label>Status<select name="materialStatusLine" value={row.status} onChange={(event) => change(index, { status: event.target.value as DesignMaterial["status"] })}>{["Unknown", "Planned", "Ordered", "Supplier confirmed", "Received", "Available"].map((value) => <option key={value}>{value}</option>)}</select></label>
    <label>Required on site<input name="materialRequiredLine" type="date" value={row.requiredDate} onChange={(event) => change(index, { requiredDate: event.target.value })} /></label>
    <label>Forecast delivery<input name="materialForecastLine" type="date" value={row.forecastDate} onChange={(event) => change(index, { forecastDate: event.target.value })} /></label>
    <label>Received quantity<input name="materialReceived" type="number" min="0" step="any" value={row.receivedQuantity ?? ""} onChange={(event) => change(index, { receivedQuantity: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
    <label>Available-for-use quantity<input name="materialAvailable" type="number" min="0" step="any" value={row.availableQuantity ?? ""} onChange={(event) => change(index, { availableQuantity: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
    <label>Approved alternative<input name="materialAlternative" value={row.alternative} onChange={(event) => change(index, { alternative: event.target.value })} /></label>
    <button type="button" onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>Remove item</button>
  </div>)}<button type="button" onClick={() => setRows((current) => [...current, { id: crypto.randomUUID(), item: "", quantity: 0, unit: "", source: "", status: "Unknown", requiredDate: "", forecastDate: "", alternative: "" }])}>+ Add material item</button></fieldset>;
}

export function DesignWorkspace({ taskFocus, onFullRecord, work, packages, packageDemands, allWork, configurationInventory, onSelectWork, actorRole, actorId, policy = legacyDesignControlPolicy, onCommand, onHandoff, onCreatePackage, demand, resources }: Props) {
  const [tab, setTab] = useState<Tab>("Basis");
  const [selectedId, setSelectedId] = useState(packages[0]?.id ?? "");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get("package");
    const destination = params.get("focus") === "reviews" ? "Reviews" : params.get("designTab");
    if (target && packages.some((item) => item.id === target) && tabs.includes(destination as Tab)) {
      queueMicrotask(() => { setSelectedId(target); setTab(destination as Tab); });
    }
  }, [work.id, packages]);
  const [handoffNote, setHandoffNote] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [changeSource, setChangeSource] = useState("");
  const [documentReviewNote, setDocumentReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const state = designState(work);
  const requirementRefs = designRequirementRefs(work);
  const selected = packages.find((item) => item.id === selectedId) ?? packages[0];
  const detail = state.packages.find((item) => item.packageId === selected?.id);
  const assessment = selected ? assessDesignPackage(work, selected.id, undefined, packageDemands.find((item) => item.workId === work.id && item.packageId === selected.id) ?? null, policy) : null;
  const serviceIssue = serviceExecutionBasisIssue(work, allWork)
    ?? (work.canonicalWorkId && work.serviceSource
      && work.serviceExecutionBasis?.status !== "accepted"
      ? "This service visit needs an independently accepted execution basis before Design package preparation."
      : null);
  const releaseSetIds = packages.map((item) => item.id);
  const releaseSetReady = !policy.allowPartialRelease && releaseSetIds.length > 0 && !state.releases.some((item) => ["Awaiting receipt", "Accepted"].includes(item.status)) && releaseSetIds.every((id) => assessDesignPackage(work, id, undefined, packageDemands.find((item) => item.workId === work.id && item.packageId === id) ?? null, policy, new Set(releaseSetIds)).recommendation === "Ready for release");
  const forecast = selected ? [...(state.forecasts ?? [])].reverse().find((item) => item.packageId === selected.id) : undefined;
  const handoff = work.discovery?.designHandoff;
  const serviceBasis = work.serviceExecutionBasis;
  const received = !serviceIssue && (work.serviceSource
    ? serviceBasis?.status === "accepted"
    : !work.discovery?.pursuitControl || (work.discovery.outcome === "Won" && handoff?.status === "accepted" && handoff.brief.definitionRevision === work.definition?.revision && handoff.brief.configurationVersionId === work.phaseConfigurationVersionId));
  async function send(command: Omit<DesignCommand, "workId" | "expectedRevision" | "commandId">) {
    setBusy(true); try { return await onCommand(command); } finally { setBusy(false); }
  }
  async function respondHandoff(decision: "accept-design-handoff" | "return-design-handoff") {
    setBusy(true); try { if (await onHandoff(decision, handoffNote)) setHandoffNote(""); } finally { setBusy(false); }
  }
  async function saveDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const element = event.currentTarget, form = new FormData(element);
    if (await send({ action: "save-document", document: { id: field(form, "id"), type: field(form, "type"), title: field(form, "title"), source: field(form, "source"), owner: field(form, "owner"), packageIds: selected ? [selected.id] : [], requirementIds: form.getAll("requirements").map(String), dueDate: field(form, "due") } })) element.reset();
  }
  function savePackage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const form = new FormData(event.currentTarget);
    const materialIds = form.getAll("materialId").map(String);
    const materialLines: DesignMaterial[] = materialIds.map((id, index) => ({ id, item: form.getAll("materialItem").map(String)[index] ?? "", quantity: Number(form.getAll("materialQuantity")[index] ?? 0), unit: form.getAll("materialUnit").map(String)[index] ?? "", source: form.getAll("materialSourceLine").map(String)[index] ?? "", status: (form.getAll("materialStatusLine").map(String)[index] ?? "Unknown") as DesignMaterial["status"], requiredDate: form.getAll("materialRequiredLine").map(String)[index] ?? "", forecastDate: form.getAll("materialForecastLine").map(String)[index] ?? "", alternative: form.getAll("materialAlternative").map(String)[index] ?? "", quoteDate: form.getAll("materialQuoteDate").map(String)[index] ?? "", quoteExpiry: form.getAll("materialQuoteExpiry").map(String)[index] ?? "", receivedQuantity: form.getAll("materialReceived").map(String)[index] ? Number(form.getAll("materialReceived").map(String)[index]) : undefined, availableQuantity: form.getAll("materialAvailable").map(String)[index] ? Number(form.getAll("materialAvailable").map(String)[index]) : undefined, confidence: (form.getAll("materialConfidence").map(String)[index] ?? "Unknown") as DesignMaterial["confidence"] }));
    const keys = ["scope", "location", "systems", "materials", "materialRequiredDate", "materialForecastDate", "materialSource", "access", "permit", "safetyControls", "equipment", "method", "rollback", "verification", "proof", "acceptingAuthority", "windowStart", "windowEnd", "targetReleaseDate", "commercialImpact"] as const;
    const completionBasis: DesignPackage["completionBasis"] = field(form, "completionKind") === "Qualitative"
      ? { kind: "Qualitative", criterion: field(form, "completionCriterion") }
      : { kind: "Measured", plannedQuantity: Number(form.get("plannedQuantity") || 0), unit: field(form, "plannedUnit") };
    const entry: Partial<DesignPackage> = { packageId: selected.id, requirementIds: form.getAll("requirementIds").map(String), predecessorIds: form.getAll("predecessorIds").map(String), documentRefs: form.getAll("documentRefs").map(String), materialLines, materialStatus: field(form, "materialStatus") as DesignPackage["materialStatus"], completionBasis, crewDemandRequired: form.has("crewDemandRequired"), crewExemptionReason: field(form, "crewExemptionReason"), commercialDisposition: field(form, "commercialDisposition") as DesignPackage["commercialDisposition"] };
    for (const key of keys) entry[key] = field(form, key);
    void send({ action: "save-package", package: entry, note: "Package engineering basis saved" });
  }
  function exportManifest(releaseId: string) {
    const release = state.releases.find((item) => item.id === releaseId); if (!release) return;
    const blob = new Blob([JSON.stringify({ workId: work.id, workTitle: work.title, release }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `d5o-design-release-${release.id}.json`; link.click(); URL.revokeObjectURL(url);
  }
  function recordCustomerApproval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const form = new FormData(event.currentTarget);
    void send({ action: "record-customer-approval", packageId: selected.id, customerParty: field(form, "customerParty"), authorityBasis: field(form, "authorityBasis"), source: field(form, "source"), approvedAt: field(form, "approvedAt"), note: field(form, "note") });
  }
  function recordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const form = new FormData(event.currentTarget);
    void send({ action: "record-change", packageId: selected.id, source: field(form, "source"), reason: field(form, "reason"), affectedRequirementIds: form.getAll("requirementIds").map(String), affectedDocumentRefs: form.getAll("documentRefs").map(String), technicalImpact: field(form, "technicalImpact"), commercialImpact: field(form, "commercialImpact"), scheduleImpact: field(form, "scheduleImpact"), note: "Design change recorded against exact package revision" });
  }
  const linkedParams = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  if (taskFocus === "document-review" || taskFocus === "document-issue") {
    const documentId = linkedParams?.get("decision");
    const sourceRevision = Number(linkedParams?.get("sourceRevision"));
    const linkedPackageId = linkedParams?.get("package");
    const document = state.documents.find((item) => item.id === documentId && item.revision === sourceRevision);
    const review = taskFocus === "document-review";
    const current = document && actorId && (!linkedPackageId || document.packageIds.includes(linkedPackageId)) &&
      (review ? actorRole === "operations_leader" && document.status === "In review" && document.submittedByActorId !== actorId
        : actorRole === "project_manager" && document.status === "Approved" && document.approvedByActorId !== actorId);
    if (!current || !document) return <section className={styles.workspace} role="status"><h2>This document task changed or was decided</h2>
      <p>The exact document revision, package or current role no longer matches. No substitute document was selected.</p>
      <a href={`/work?workspace=${encodeURIComponent(work.workspace)}&view=my-work`}>Return to refreshed My Work</a></section>;
    const packageNames = document.packageIds.map((id) => packages.find((item) => item.id === id)?.name ?? `Unavailable package ${id}`);
    return <FocusedTaskFrame title={`${review ? "Review" : "Issue"} · ${document.title}`} work={work.title}
      customer={work.customer} site={work.site} workspace={work.workspace} revision={document.revision}
      scope={`${document.type} · ${packageNames.join(", ") || "Work Record"}`}
      outcome={review ? "Independently assess this submitted revision before it can be issued for use." : "Issue the independently approved revision for the named packages."}
      nextOwner={review ? "Project manager to issue the approved revision" : "Project manager to link the issued revision to the engineering package"}
      onFullRecord={onFullRecord}
      context={<><p>Source or custody reference: {document.source}</p><p>Document owner: {document.owner}</p>
        <p>Requirements: {document.requirementIds.map((id) => requirementRefs.find((item) => item.id === id)?.label ?? id).join("; ") || "None linked"}</p>
        {document.reviewNote ? <p>Independent review: {document.reviewNote}</p> : null}</>}>
      <section className={styles.card}><h2>Exact document revision</h2><p>{document.title} · revision {document.revision} · {document.status}</p>
        <p><strong>Recorded source:</strong> {document.source}</p>
        <p>A source reference alone does not prove that private file bytes were retained. Inspect the source before approving or issuing.</p>
        {review ? <><label>Independent review rationale<input aria-label="Document review rationale" value={documentReviewNote}
          onChange={(event) => setDocumentReviewNote(event.target.value)} /></label>
          <button disabled={busy || documentReviewNote.trim().length < 15} onClick={() => void send({ action: "approve-document",
            documentId: document.id, documentRevision: document.revision, note: documentReviewNote })}>Approve exact document revision</button></>
          : <><p><strong>Review basis:</strong> {document.reviewNote || "Independent approval recorded"}</p>
            <button disabled={busy} onClick={() => void send({ action: "issue-document", documentId: document.id,
              documentRevision: document.revision })}>Issue exact document revision</button></>}
      </section>
    </FocusedTaskFrame>;
  }
  if (linkedParams?.get("focus") === "reviews") {
    const reviewId = linkedParams.get("decision");
    const sourceRevision = Number(linkedParams.get("sourceRevision"));
    const review = state.reviews.find((item) => item.id === reviewId);
    const packageRef = packages.find((item) => item.id === review?.packageId);
    const packageBasis = state.packages.find((item) => item.packageId === review?.packageId);
    if (!review || !packageRef || review.status !== "Requested" || review.revision !== sourceRevision || packageBasis?.revision !== review.revision)
      return <section className={styles.workspace} role="status"><h2>This Design review changed or was decided</h2>
        <p>The exact review, package and source revision no longer match. No other review was selected.</p>
        <a href={`/work?workspace=${encodeURIComponent(work.workspace)}&view=my-work`}>Return to refreshed My Work</a></section>;
    return <FocusedTaskFrame title={`${review.discipline} package review`} work={work.title} customer={work.customer} site={work.site}
      workspace={work.workspace} scope={`${packageRef.name} · ${packageBasis.scope}`} revision={review.revision}
      outcome="Approve this exact engineering package revision or return it for correction."
      blocker={serviceIssue} nextOwner="Engineering Lead for corrections or Delivery Leader for release assessment"
      onFullRecord={() => { const url = new URL(window.location.href); for (const key of ["focus", "decision", "sourceRevision"]) url.searchParams.delete(key); window.location.assign(url.toString()); }}
      context={<><h3>Governing documents</h3>{packageBasis.documentRefs.length ? <ul>{packageBasis.documentRefs.map((ref) => {
        const document = state.documents.find((item) => documentRef(item) === ref);
        return <li key={ref}>{document ? `${document.title} · revision ${document.revision} · ${document.status} · source ${document.source}` : `Unavailable document revision ${ref}`}</li>;
      })}</ul> : <p>None recorded</p>}
        <h3>Affected requirements</h3>{packageBasis.requirementIds.length ? <ul>{packageBasis.requirementIds.map((id) => {
          const requirement = requirementRefs.find((item) => item.id === id);
          return <li key={id}>{requirement ? `${requirement.label} · source ${requirement.source}` : `Unavailable requirement ${id}`}</li>;
        })}</ul> : <p>None recorded</p>}
        <p>Approved Define acceptance: {work.definition?.acceptance || "Not recorded"}</p>
        <p>Safety: {packageBasis.safetyControls || "Not recorded"}</p>
        <p>Verification: {packageBasis.verification || "Not recorded"}</p>
        <p>Required proof: {packageBasis.proof || "Not recorded"}</p></>}>
      <section className={styles.card}><h2>Review the governing package</h2><p><strong>Scope:</strong> {packageBasis.scope}</p>
        <p><strong>Location:</strong> {packageBasis.location}</p><p><strong>Completion basis:</strong> {packageBasis.completionBasis?.kind ?? "Not recorded"}</p>
        <p><strong>Assigned queue:</strong> {review.assignee} · due {review.dueDate || "not recorded"}</p>
        <label>Decision rationale<input aria-label="Review rationale" value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} /></label>
        <div className={styles.actions}><button disabled={busy || !decisionNote.trim()} onClick={() => void send({ action: "decide-review", reviewId: review.id, decision: "Approved", note: decisionNote })}>Approve exact revision</button>
          <button disabled={busy || !decisionNote.trim()} onClick={() => void send({ action: "decide-review", reviewId: review.id, decision: "Returned", note: decisionNote })}>Return for correction</button></div>
      </section>
    </FocusedTaskFrame>;
  }
  if (["package-prep", "package-engineering", "package-review-request"].includes(taskFocus ?? "")) {
    const linkedPackageId = linkedParams?.get("package");
    const linkedRevision = Number(linkedParams?.get("sourceRevision"));
    const exactPackage = packages.find((item) => item.id === linkedPackageId);
    const exactDetail = state.packages.find((item) => item.packageId === linkedPackageId);
    const rawDetail = work.design?.packages?.find((item) => item.packageId === linkedPackageId);
    const malformed = !!rawDetail && (![rawDetail.requirementIds, rawDetail.predecessorIds, rawDetail.documentRefs].every(Array.isArray)
      || !rawDetail.materialStatus || !rawDetail.commercialDisposition);
    const preparation = taskFocus === "package-prep";
    const engineering = taskFocus === "package-engineering";
    const current = actorRole === "project_manager" && received &&
      (preparation ? !linkedPackageId && !packages.length && handoff?.revision === linkedRevision
        : !!exactPackage && (engineering ? (!exactDetail && linkedRevision === 0 || malformed && exactDetail?.revision === linkedRevision)
          : !malformed && exactDetail?.revision === linkedRevision && ["Draft", "Returned"].includes(exactDetail.status)));
    if (!current) return <section className={styles.workspace} role="status"><h2>This package task changed or was completed</h2>
      <p>The accepted source, exact package, revision or your current role no longer matches. No other package was selected.</p>
      <a href={`/work?workspace=${encodeURIComponent(work.workspace)}&view=my-work`}>Return to refreshed My Work</a></section>;
    return <FocusedTaskFrame title={preparation ? "Prepare Work Package" : engineering ? `Engineer ${exactPackage!.name}` : `Request review · ${exactPackage!.name}`}
      work={work.title} customer={work.customer} site={work.site} workspace={work.workspace}
      scope={preparation ? `Accepted Develop handoff revision ${handoff!.revision} · ${readable(handoff?.brief.offerScope)}` : `${exactPackage!.name} · ${engineering ? "engineering draft needed" : `engineering revision ${exactDetail!.revision}`}`}
      revision={linkedRevision} outcome={preparation ? "Create the first shared package against this exact accepted award and Define basis." : engineering ? "Save a measured or qualitative engineering draft for this exact package." : "Assign independent discipline review of this exact package revision."}
      nextOwner={preparation ? "Project manager for package engineering" : engineering ? "Project manager for review request" : "Independent engineering, delivery, safety or quality reviewer"}
      blocker={serviceIssue} onFullRecord={onFullRecord}
      context={<><p><strong>Approved Define:</strong> revision {work.definition?.revision ?? "unknown"} · {readable(work.definition?.acceptance)}</p><p><strong>Award:</strong> {readable(handoff?.brief.awardBasis)}</p><p><strong>Exclusions:</strong> {readable(handoff?.brief.excludedScope)}</p><p><strong>Configuration:</strong> {work.phaseConfigurationVersionId}</p></>}>
      {preparation ? <form className={styles.form} onSubmit={onCreatePackage}><label>Work Package name<input name="package" required minLength={3} placeholder="e.g. North zone controls installation" /></label><label>Package owner<input name="owner" defaultValue={work.owner} required /></label><button type="submit">Create shared package</button></form> : null}
      {engineering ? <>{malformed ? <p role="status">The retained revision has missing structured references. Save a corrected revision before requesting review.</p> : null}<form className={styles.form} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void send({ action: "save-package", package: { packageId: exactPackage!.id, scope: field(form, "scope"), location: field(form, "location"), method: field(form, "method"), verification: field(form, "verification"), proof: field(form, "proof"), acceptingAuthority: field(form, "acceptingAuthority"), requirementIds: form.getAll("requirements").map(String), predecessorIds: [], documentRefs: [], materialLines: [], materialStatus: "Unknown", commercialDisposition: "None", completionBasis: { kind: "Measured", plannedQuantity: Number(form.get("quantity")), unit: field(form, "unit") }, crewDemandRequired: true }, note: "Package engineering basis saved" }); }}>
        <label>Exact scope<textarea name="scope" defaultValue={exactDetail?.scope} required /></label><label>Location<input name="location" defaultValue={exactDetail?.location} required /></label><label>Approved requirements<select name="requirements" multiple>{requirementRefs.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Planned quantity<input name="quantity" type="number" min="0.001" step="any" defaultValue={exactDetail?.completionBasis?.kind === "Measured" ? exactDetail.completionBasis.plannedQuantity : undefined} required /></label><label>Unit<input name="unit" defaultValue={exactDetail?.completionBasis?.kind === "Measured" ? exactDetail.completionBasis.unit : undefined} required /></label><label>Method<textarea name="method" defaultValue={exactDetail?.method} /></label><label>Verification<textarea name="verification" defaultValue={exactDetail?.verification} /></label><label>Required proof<textarea name="proof" defaultValue={exactDetail?.proof} /></label><label>Accepting authority<input name="acceptingAuthority" defaultValue={exactDetail?.acceptingAuthority} /></label><button type="submit" disabled={busy}>Save engineering draft</button></form></> : null}
      {!preparation && !engineering ? <section className={styles.card}><p><strong>Scope:</strong> {exactDetail!.scope}</p><p><strong>Verification:</strong> {exactDetail!.verification || "Not recorded; review may return incomplete design"}</p><form className={styles.form} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void send({ action: "request-review", packageId: exactPackage!.id, discipline: field(form, "discipline") as DesignReview["discipline"], assignee: `${field(form, "discipline")} review queue`, dueDate: field(form, "dueDate") }); }}><label>Review discipline<select name="discipline">{disciplines.map((item) => <option key={item}>{item}</option>)}</select></label><label>Due date<input name="dueDate" type="date" required /></label><button type="submit" disabled={busy}>Request exact-revision review</button></form></section> : null}
    </FocusedTaskFrame>;
  }
  if (taskFocus === "package-release-prep") {
    const linkedPackage = packages.find((item) => item.id === linkedParams?.get("package"));
    const linkedDetail = state.packages.find((item) => item.packageId === linkedPackage?.id);
    const linkedRevision = Number(linkedParams?.get("sourceRevision"));
    const current = actorRole === "project_manager" && received && linkedPackage &&
      linkedDetail?.revision === linkedRevision && linkedDetail.status === "In review" &&
      !state.releases.some((release) => release.packageId === linkedPackage.id &&
        release.packageRevision === linkedRevision && ["Awaiting receipt", "Accepted"].includes(release.status));
    if (!current || !linkedPackage || !linkedDetail) return <section className={styles.workspace} role="status"><h2>This package task changed or was completed</h2>
      <p>The accepted source, exact package, revision or your current role no longer matches. No other package was selected.</p>
      <a href={`/work?workspace=${encodeURIComponent(work.workspace)}&view=my-work`}>Return to refreshed My Work</a></section>;
    const readiness = assessDesignPackage(work, linkedPackage.id, undefined,
      packageDemands.find((item) => item.workId === work.id && item.packageId === linkedPackage.id) ?? null, policy);
    const mandatoryHolds = readiness.findings.filter((finding) => finding.severity === "blocker");
    const preparationGaps = readiness.findings.filter((finding) => finding.severity !== "blocker");
    const openControls = (nextTab: Tab) => {
      const url = new URL(window.location.href);
      url.searchParams.delete("focus");
      url.searchParams.delete("sourceRevision");
      url.searchParams.set("section", "Design");
      url.searchParams.set("package", linkedPackage.id);
      url.searchParams.set("designTab", nextTab);
      window.location.assign(url);
    };
    return <FocusedTaskFrame title={`Complete release preparation · ${linkedPackage.name}`} work={work.title}
      customer={work.customer} site={work.site} workspace={work.workspace} revision={linkedRevision}
      scope={`${linkedPackage.name} · ${linkedDetail.scope}`}
      outcome="Resolve the current package findings. Delivery release and independent Deploy receipt are separate decisions."
      blocker={readiness.recommendation === "Ready for release" ? null : readiness.recommendation}
      nextOwner="Project manager for preparation; Delivery Leader for release authorization"
      onFullRecord={onFullRecord}>
      <section className={styles.card}><h2>Current release position</h2>
        <p>{readiness.recommendation} · package revision {linkedRevision} · {readiness.findings.length} finding{readiness.findings.length === 1 ? "" : "s"}</p>
        <h3>Mandatory holds</h3>
        {mandatoryHolds.length ? <ul>{mandatoryHolds.map((finding) => <li key={finding.key}>
          <strong>{finding.area} · {finding.severity}:</strong> {finding.message} Next: {finding.nextAction}
        </li>)}</ul> : <p>No mandatory hold recorded.</p>}
        <div className={styles.actions}>
          <button type="button" onClick={() => openControls("Packages")}>Open exact package controls</button>
          <button type="button" onClick={() => openControls("Documents")}>Open governing documents</button>
          <button type="button" onClick={() => openControls("Reviews")}>Open discipline reviews</button>
          <button type="button" onClick={() => openControls("Readiness & release")}>Recheck release readiness</button>
        </div>
        {preparationGaps.length ? <details><summary>Other preparation gaps ({preparationGaps.length})</summary>
          <ul>{preparationGaps.map((finding) => <li key={finding.key}>
            <strong>{finding.area} · {finding.severity}:</strong> {finding.message} Next: {finding.nextAction}
          </li>)}</ul></details> : null}
      </section>
    </FocusedTaskFrame>;
  }
  return <section className={styles.workspace} aria-label="Design workspace">
    <header className={styles.header}><div><p>DESIGN · CONTROLLED ENGINEERING</p><h2>Prepare executable work for release</h2><span>{work.customer} · {work.site} · {work.type}</span></div><strong>{state.releases.filter((item) => item.status === "Accepted").length} received / {packages.length} packages</strong></header>
    <div className={styles.position}><span><b>Engineering owner</b>{work.develop?.designOwner || work.owner}</span><span><b>Received basis</b>{handoff ? `Develop handoff ${handoff.revision} · ${handoff.status}` : work.serviceSource ? `Service request ${work.serviceSource.requestId ?? "maintenance"}` : work.discovery?.pursuitControl ? "Awaiting awarded Develop handoff" : "Legacy work · source unverified"}</span><span><b>Configuration</b>{work.phaseConfigurationVersionId ?? "Unpinned"}</span><span><b>Design next action</b>{serviceIssue ?? (received ? state.packages.length ? "Complete reviews and resolve release findings" : "Create an executable Work Package" : "Receive the exact approved Develop basis")}</span></div>
    <nav className={styles.tabs} aria-label="Design sections">{tabs.map((item) => <button key={item} type="button" aria-current={tab === item ? "page" : undefined} onClick={() => setTab(item)}>{item}</button>)}</nav>
    {tab === "Pipeline" ? <div className={styles.stack}><DesignPipeline work={allWork} inventory={configurationInventory} demands={packageDemands} onSelect={onSelectWork} /></div> : null}
    {tab === "Basis" ? <div className={styles.stack}>
      {work.serviceSource ? <section className={styles.card}>
        <h3>Receive the service execution basis</h3>
        <p>The source is this asset, request cycle and approved coverage. Operations must independently accept the exact proposed scope before package preparation. Coverage by itself does not authorize field work.</p>
        <div className={styles.grid}><span><b>Source Work</b>{work.serviceSource.parentWorkId}</span><span><b>Request</b>{work.serviceSource.requestId} · cycle {work.serviceSource.requestCycleAt}</span><span><b>Coverage</b>{work.serviceSource.coverage ?? "Unknown"}</span><span><b>Decision</b>{serviceBasis ? `${serviceBasis.status} · revision ${serviceBasis.revision}` : "Basis required"}</span></div>
        {serviceBasis ? <p><b>Proposed scope:</b> {serviceBasis.brief.scope}<br /><b>Completion:</b> {serviceBasis.brief.completionCriteria}<br /><b>Verification:</b> {serviceBasis.brief.verification}<br /><b>Coverage rationale:</b> {serviceBasis.brief.coverageRationale}</p> : null}
        {actorRole === "project_manager" && (!serviceBasis || ["draft", "returned", "accepted"].includes(serviceBasis.status)) ? <form className={styles.form} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void send({ action: serviceBasis?.status === "accepted" ? "revise-service-basis" : "save-service-basis", serviceBasis: { scope: field(form, "scope"), coveredScope: field(form, "coveredScope"), uncoveredScope: field(form, "uncoveredScope"), exclusions: field(form, "exclusions"), completionCriteria: field(form, "completionCriteria"), verification: field(form, "verification"), coverageRationale: field(form, "coverageRationale"), safety: field(form, "safety"), access: field(form, "access"), resources: field(form, "resources"), serviceCategory: field(form, "serviceCategory") } }); }}>
          <label>Covered service category<input name="serviceCategory" defaultValue={serviceBasis?.brief.serviceCategory} required /></label>
          {work.serviceSource.coverage === "Partially covered" ? <><label>Covered agreement scope<textarea name="coveredScope" defaultValue={serviceBasis?.brief.coveredScope} minLength={20} required /></label><label>Priced uncovered scope<textarea name="uncoveredScope" defaultValue={serviceBasis?.brief.uncoveredScope ?? serviceBasis?.brief.source.pricing?.uncoveredScope} minLength={20} required /></label></> : null}<label>Authorized scope<textarea name="scope" defaultValue={serviceBasis?.brief.scope} minLength={20} required /></label>
          <label>Exclusions<textarea name="exclusions" defaultValue={serviceBasis?.brief.exclusions} /></label>
          <label>Why this scope is within the agreement<textarea name="coverageRationale" defaultValue={serviceBasis?.brief.coverageRationale} minLength={20} required /></label>
          <label>Completion criteria<textarea name="completionCriteria" defaultValue={serviceBasis?.brief.completionCriteria} minLength={15} required /></label>
          <label>Required verification<textarea name="verification" defaultValue={serviceBasis?.brief.verification} minLength={15} required /></label>
          <label>Safety controls<input name="safety" defaultValue={serviceBasis?.brief.safety} minLength={10} required /></label>
          <label>Site access<input name="access" defaultValue={serviceBasis?.brief.access} minLength={10} required /></label>
          <label>People and equipment<input name="resources" defaultValue={serviceBasis?.brief.resources} minLength={10} required /></label>
          <button disabled={busy}>{serviceBasis?.status === "accepted" ? "Create revised basis" : "Save service basis draft"}</button>
        </form> : null}
        {actorRole === "project_manager" && serviceBasis?.status === "draft" ? <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void send({ action: "submit-service-basis", note: field(new FormData(event.currentTarget), "reason") }); }}><label>Submission rationale<input name="reason" minLength={15} required /></label><button disabled={busy}>Submit for Operations receipt</button></form> : null}
        {actorRole === "operations_leader" && serviceBasis?.status === "submitted" ? <form className={styles.form} onSubmit={(event) => { event.preventDefault(); const note = field(new FormData(event.currentTarget), "reason"); void send({ action: "accept-service-basis", note }); }}><label>Independent review and coverage decision<textarea name="reason" minLength={20} required /></label><div className={styles.actions}><button disabled={busy}>Accept exact service basis</button><button type="button" disabled={busy} onClick={(event) => { const form = event.currentTarget.closest("form"); const note = form ? field(new FormData(form), "reason") : ""; if (note.length >= 20) void send({ action: "return-service-basis", note }); }}>Return for correction</button></div></form> : null}
        {serviceIssue ? <p className={styles.warning}>{serviceIssue}</p> : null}
      </section> : null}
      {!work.serviceSource ? <>
      <section className={styles.card}><h3>Received scope and customer commitment</h3><p>Exact approved sources stay visible throughout engineering. Design cannot alter the awarded price or scope here.</p><div className={styles.grid}><span><b>Define baseline</b>Revision {work.definition?.revision ?? "unknown"} · {work.definition?.status ?? "unavailable"}</span><span><b>Customer outcome</b>{readable(handoff?.brief.customerOutcome ?? work.definition?.outcome)}</span><span><b>Accepted result</b>{readable(handoff?.brief.acceptance ?? work.definition?.acceptance)}</span><span><b>Offer scope</b>{readable(handoff?.brief.offerScope)}</span><span><b>Exclusions</b>{readable(handoff?.brief.excludedScope ?? work.definition?.excludedScope)}</span><span><b>Customer award</b>{readable(handoff?.brief.awardBasis)}</span><span><b>Selected solution</b>{readable(handoff?.brief.develop?.selectedOptionSnapshot.name)}</span><span><b>Estimate source</b>{handoff?.brief.estimateRevision ?? "unknown"} · {handoff?.brief.develop?.currency ?? "currency unknown"}</span></div>{!handoff?.brief.develop ? <p className={styles.warning}>Detailed solution and pricing snapshots are unavailable on this handoff. Known design changes require Develop assessment; exact margin cannot be inferred.</p> : null}</section>
      {handoff?.status === "submitted" ? <section className={styles.card}><h3>Receive or return Develop handoff</h3><p>Revision {handoff.revision} · submitted by {handoff.submittedBy}. A different authorized actor must respond to this exact source.</p><textarea value={handoffNote} onChange={(event) => setHandoffNote(event.target.value)} placeholder="State the acceptance or return basis (20+ characters)" /><div className={styles.actions}><button disabled={busy || handoffNote.trim().length < 20} onClick={() => void respondHandoff("accept-design-handoff")}>Accept into Design</button><button disabled={busy || handoffNote.trim().length < 20} onClick={() => void respondHandoff("return-design-handoff")}>Return for correction</button></div></section> : null}
      {!received ? <p className={styles.warning}>Engineering edits and package release are held until the customer award and exact Develop handoff are accepted. A changed Define baseline requires a new handoff.</p> : null}
      <section className={styles.card}><h3>Requirements and interfaces from Define</h3><div className={styles.list}>{requirementRefs.map((item) => <article key={item.id}><strong>{item.id} · {item.label}</strong><small>Source: {item.source}</small></article>)}{!requirementRefs.length ? <p>No approved Define requirement or legacy acceptance reference is available.</p> : null}</div><details><summary>Interfaces, assumptions, and constraints</summary><p>{readable(work.definition?.dependencies)}</p><p>{readable(work.definition?.project?.accessConstraints)}</p></details></section>
      </> : null}
    </div> : null}
    {tab === "Documents" ? <div className={styles.stack}><section className={styles.card}><h3>Engineering document index</h3><p>A new draft retains the issued revision until the new revision is reviewed and explicitly issued.</p><div className={styles.list}>{state.documents.map((item) => <article key={documentRef(item)}><div><strong>{item.title} · rev {item.revision}</strong><small>{item.type} · {item.status} · {item.source}</small><small>Packages: {item.packageIds.map((id) => packages.find((entry) => entry.id === id)?.name ?? id).join(", ") || "None"}</small></div><div className={styles.actions}>{item.status === "Draft" ? <button disabled={busy} onClick={() => void send({ action: "submit-document", documentId: item.id, documentRevision: item.revision })}>Submit review</button> : null}{item.status === "In review" ? <><input aria-label={`Document review rationale for ${item.title}`} value={documentReviewNote} onChange={(event) => setDocumentReviewNote(event.target.value)} placeholder="Independent review rationale" /><button disabled={busy || documentReviewNote.trim().length < 15} onClick={() => void send({ action: "approve-document", documentId: item.id, documentRevision: item.revision, note: documentReviewNote })}>Approve revision</button></> : null}{item.status === "Approved" ? <button disabled={busy} onClick={() => void send({ action: "issue-document", documentId: item.id, documentRevision: item.revision })}>Issue for use</button> : null}{item.status === "Issued for use" ? <button type="button" onClick={() => { setTab("Packages"); setSelectedId(item.packageIds[0] ?? selected?.id ?? ""); setChangeSource(""); }}>Use in package →</button> : null}</div></article>)}{!state.documents.length ? <p>No engineering deliverable recorded.</p> : null}</div></section>
      <section className={styles.card}><h3>Draft a deliverable</h3><form className={styles.form} onSubmit={saveDocument}><label>Document identity<select name="id"><option value="">New deliverable</option>{[...new Map(state.documents.map((item) => [item.id, item])).values()].map((item) => <option value={item.id} key={item.id}>New revision of {item.title}</option>)}</select></label><label>Type<select name="type"><option>IFC drawing</option><option>Specification</option><option>Cable schedule</option><option>Material submittal</option><option>Method of procedure</option><option>Safety plan</option><option>Quality plan</option><option>Service engineering</option></select></label><label>Title<input name="title" required /></label><label>Source or file reference<input name="source" required placeholder="Evidence ID or controlled document link" /></label><label>Owner<input name="owner" defaultValue={work.owner} /></label><label>Approved requirements<select name="requirements" multiple>{requirementRefs.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.label}</option>)}</select></label><label>Review due<input name="due" type="date" /></label><button disabled={busy || !received}>Save draft for selected package</button></form></section></div> : null}
    {tab === "Packages" ? <div className={styles.stack}><section className={styles.card}><h3>Shared Work Packages</h3><p>Design records the executable method and crew demand. Installed, tested, and accepted quantities are recorded in Deploy.</p><div className={styles.packageStrip}>{packages.map((item) => <button type="button" className={selected?.id === item.id ? styles.selected : ""} key={item.id} onClick={() => { setSelectedId(item.id); setChangeSource(""); }}>{item.name}<small>{state.packages.find((entry) => entry.packageId === item.id)?.status ?? "Needs design"}</small></button>)}</div><form className={styles.form} onSubmit={onCreatePackage}><label>New Work Package<input name="package" required placeholder="e.g. Fiber trunks and termination" /></label><label>Owner<input name="owner" defaultValue={work.owner} /></label><button disabled={!received}>Create shared package</button></form></section>
      {selected ? <section className={styles.card}><h3>{selected.name} · engineering revision {detail?.revision ?? "new"}</h3><form key={`${selected.id}:${detail?.revision ?? 0}`} className={styles.form} onSubmit={savePackage}>
        <label>Scope<textarea name="scope" defaultValue={detail?.scope} /></label><label>Location<input name="location" defaultValue={detail?.location} /></label><label>Affected systems<input name="systems" defaultValue={detail?.systems} /></label><label>Approved requirements<select name="requirementIds" multiple defaultValue={detail?.requirementIds ?? []}>{requirementRefs.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.label}</option>)}</select></label><label>Predecessor packages<select name="predecessorIds" multiple defaultValue={detail?.predecessorIds ?? []}>{packages.filter((item) => item.id !== selected.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Governing document revisions<select name="documentRefs" multiple defaultValue={detail?.documentRefs ?? []}>{state.documents.filter((item) => item.packageIds.includes(selected.id)).map((item) => <option key={documentRef(item)} value={documentRef(item)}>{item.title} · rev {item.revision} · {item.status}</option>)}</select></label>
        <label>Completion basis<select name="completionKind" defaultValue={detail?.completionBasis?.kind ?? "Measured"}><option>Measured</option><option>Qualitative</option></select></label><label>Planned quantity<input name="plannedQuantity" type="number" min="0" step="any" defaultValue={detail?.completionBasis?.kind === "Measured" ? detail.completionBasis.plannedQuantity : ""} /></label><label>Quantity unit<input name="plannedUnit" defaultValue={detail?.completionBasis?.kind === "Measured" ? detail.completionBasis.unit : ""} /></label><label>Qualitative completion criterion<input name="completionCriterion" defaultValue={detail?.completionBasis?.kind === "Qualitative" ? detail.completionBasis.criterion : ""} /></label>
        <MaterialLinesField key={`${selected.id}:${detail?.revision ?? 0}`} initial={detail?.materialLines ?? []} /><details><summary>Legacy material summary</summary><label>Materials and quantities<textarea name="materials" defaultValue={detail?.materials} placeholder="Earlier unstructured material basis" /></label></details><label>Material position<select name="materialStatus" defaultValue={detail?.materialStatus ?? "Unknown"}>{["Unknown", "Planned", "Ordered", "Supplier confirmed", "Received", "Available"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Required on site<input name="materialRequiredDate" type="date" defaultValue={detail?.materialRequiredDate} /></label><label>Forecast delivery<input name="materialForecastDate" type="date" defaultValue={detail?.materialForecastDate} /></label><label>Material source / confidence<input name="materialSource" defaultValue={detail?.materialSource} /></label><label>Access and outage<input name="access" defaultValue={detail?.access} /></label><label>Permit disposition<input name="permit" defaultValue={detail?.permit} /></label><label>Safety controls<textarea name="safetyControls" defaultValue={detail?.safetyControls} /></label><label>Equipment / tools<input name="equipment" defaultValue={detail?.equipment} /></label><label>Method of procedure<textarea name="method" defaultValue={detail?.method} /></label><label>Rollback / recovery<textarea name="rollback" defaultValue={detail?.rollback} /></label><label>Planned verification<textarea name="verification" defaultValue={detail?.verification} /></label><label>Required proof<input name="proof" defaultValue={detail?.proof} /></label><label>Accepting authority<input name="acceptingAuthority" defaultValue={detail?.acceptingAuthority} /></label><label>Window start<input name="windowStart" type="date" defaultValue={detail?.windowStart} /></label><label>Window end<input name="windowEnd" type="date" defaultValue={detail?.windowEnd} /></label><label>Target release<input name="targetReleaseDate" type="date" defaultValue={detail?.targetReleaseDate} /></label><label className={styles.crewChoice}><input name="crewDemandRequired" type="checkbox" defaultChecked={detail?.crewDemandRequired !== false} />Requires a dated qualified crew plan</label><label>If no crew is needed, explain why (leader approval required)<input name="crewExemptionReason" defaultValue={detail?.crewExemptionReason} placeholder="At least 20 characters when not applicable" /></label><label>Commercial impact<textarea name="commercialImpact" defaultValue={detail?.commercialImpact} placeholder="Known quantity, cost, or schedule delta; unknown if not priced" /></label><label>Commercial disposition<select name="commercialDisposition" defaultValue={detail?.commercialDisposition ?? "None"}>{["None", "Assessment required", "Routed to Develop"].map((value) => <option key={value}>{value}</option>)}</select></label><button disabled={busy || !received || selected.status === "accepted"}>Save new design revision</button></form><p>Each save creates a new package revision and requires fresh reviews. Accepted field packages remain read-only. A released package remains locked until its pending release is returned or withdrawn.</p></section> : null}
      <section className={styles.card}><h3>Crew demand and resource feasibility</h3>{demand}{resources}</section></div> : null}
    {tab === "Reviews" ? <div className={styles.stack}><section className={styles.card}><h3>Revision-specific design reviews</h3><p>Define approval is source context. It does not substitute for Engineering, Delivery, Safety, or Quality review of this package revision.</p><div className={styles.list}>{state.reviews.filter((item) => item.packageId === selected?.id).map((item) => <article key={item.id}><div><strong>{item.discipline} · rev {item.revision} · {item.status}</strong><small>Assigned {item.assignee} · due {item.dueDate} · {item.note ?? "No decision note"}</small></div>{item.status === "Requested" ? <div className={styles.actions}><input aria-label="Review rationale" value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Review rationale" /><button disabled={busy || !decisionNote.trim()} onClick={() => void send({ action: "decide-review", reviewId: item.id, decision: "Approved", note: decisionNote })}>Approve</button><button disabled={busy || !decisionNote.trim()} onClick={() => void send({ action: "decide-review", reviewId: item.id, decision: "Returned", note: decisionNote })}>Return</button></div> : null}</article>)}{!state.reviews.some((item) => item.packageId === selected?.id) ? <p>No review requested for this package.</p> : null}</div></section>
      {selected && detail ? <section className={styles.card}><h3>Request review · {selected.name} revision {detail.revision}</h3><form className={styles.form} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void send({ action: "request-review", packageId: selected.id, discipline: field(form, "discipline") as DesignReview["discipline"], assignee: `${field(form, "discipline")} review queue`, dueDate: field(form, "dueDate") }); }}><label>Discipline<select name="discipline">{disciplines.map((item) => <option key={item}>{item}</option>)}</select></label><p>Assignment: the selected discipline review queue. This synthetic prototype does not allocate an individual reviewer.</p><label>Due date<input name="dueDate" type="date" required /></label><button disabled={busy || !received}>Request exact-revision review</button></form></section> : null}{selected && detail ? <section className={styles.card}><h3>Customer technical approval · external source</h3><p>An internal member records an approval received from the named customer party. This is not a customer login or signature. The approval applies only to revision {detail.revision}.</p><div className={styles.list}>{(state.customerApprovals ?? []).filter((item) => item.packageId === selected.id).map((item) => <article key={item.id}><div><strong>{item.customerParty} · rev {item.packageRevision}</strong><small>{item.approvedAt} · {item.authorityBasis} · source {item.source}</small><small>Recorded by {item.recordedByActorId} · {item.note}</small></div></article>)}</div><form className={styles.form} onSubmit={recordCustomerApproval}><label>Approving customer party<input name="customerParty" required /></label><label>Authority basis<input name="authorityBasis" required /></label><label>External source or evidence ID<input name="source" required /></label><label>Customer approval date<input name="approvedAt" type="date" required /></label><label>Internal recording rationale (20+ characters)<textarea name="note" minLength={20} required /></label><button disabled={busy || !received}>Record external approval</button></form></section> : null}</div> : null}
    {tab === "Changes" ? <div className={styles.stack}>{selected && work.canonicalWorkId ? <FieldChangeDesignSummary workspace={work.workspace} workId={work.id} packageId={selected.id} onChooseSource={setChangeSource} /> : null}<section className={styles.card}><h3>Design changes and field holds</h3><p>Record the source and impact before changing an issued package. A field hold stops execution until Deploy acknowledges it; commercial impact requires separate Develop review and customer authorization before a revised release.</p><div className={styles.list}>{(state.changes ?? []).filter((item) => item.packageId === selected?.id).map((item) => <article key={item.id}><div><strong>{item.status} · revision {item.openedRevision} · {item.source}</strong><small>{item.reason}</small><small>Technical: {item.technicalImpact} · commercial: {item.commercialImpact || "unknown/no recorded change"} · schedule: {item.scheduleImpact}</small>{item.resolution ? <small>Resolution: {item.resolution}</small> : null}</div>{item.status === "Open" && detail && detail.revision > item.openedRevision ? <button disabled={busy} onClick={() => void send({ action: "resolve-change", changeId: item.id, note: "Revised package and governing source reviewed after field hold" })}>Resolve reviewed change</button> : null}</article>)}{!state.changes?.some((item) => item.packageId === selected?.id) ? <p>No change recorded for this package.</p> : null}</div></section>{selected && detail ? <section className={styles.card}><h3>Record a change to {selected.name}</h3><form className={styles.form} onSubmit={recordChange}><label>Change source<input name="source" value={changeSource} onChange={(event) => setChangeSource(event.target.value)} required placeholder="RFI, site finding, customer instruction" /></label><label>Reason<textarea name="reason" minLength={20} required /></label><label>Affected requirements<select name="requirementIds" multiple>{requirementRefs.filter((item) => detail.requirementIds.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Affected document revisions<select name="documentRefs" multiple>{detail.documentRefs.map((ref) => <option key={ref}>{ref}</option>)}</select></label><label>Technical impact<textarea name="technicalImpact" required /></label><label>Known commercial impact<textarea name="commercialImpact" placeholder="Leave blank when not established" /></label><label>Schedule impact<textarea name="scheduleImpact" required /></label><button disabled={busy || !received}>Record change and hold active release</button></form></section> : null}</div> : null}
    {tab === "Readiness & release" ? <div className={styles.stack}><section className={styles.card}><h3>{selected ? `${selected.name} · ` : ""}Deployment readiness</h3><p>Recommendation is advisory. Delivery release and Deploy receipt are separate recorded decisions.</p>{serviceIssue ? <p className={styles.warning}>Service release held: {serviceIssue}</p> : null}{assessment ? <><strong className={styles.recommendation}>{serviceIssue ? "Hold for service authorization" : assessment.recommendation}</strong><p>Package rev {assessment.packageRevision} · policy/configuration {assessment.policyVersion}</p><div className={styles.grid}><span><b>Target release</b>{forecast?.targetDate || detail?.targetReleaseDate || "Not set"}</span><span><b>Current forecast</b>{forecast?.forecastDate ?? "Unknown"} · {forecast?.driver ?? "No forecast snapshot"}</span></div><p>{forecast?.reason}</p><div className={styles.list}>{assessment.findings.map((item) => <article key={item.key}><div><strong>{item.area} · {item.severity}</strong><span>{item.message}</span><small>Next: {item.nextAction}</small></div></article>)}{!assessment.findings.length && !serviceIssue ? <p>Recorded readiness checks are clear. Confirm the exact basis before release.</p> : null}</div></> : <p>Create a shared package to assess release.</p>}</section>
      {received && !serviceIssue && selected && (policy.allowPartialRelease ? assessment?.recommendation === "Ready for release" && !state.releases.some((item) => item.packageId === selected.id && ["Awaiting receipt", "Accepted"].includes(item.status)) : releaseSetReady) ? <section className={styles.card}><h3>{policy.allowPartialRelease ? "Authorize exact package release" : `Authorize complete release set · ${releaseSetIds.length} packages`}</h3><form className={styles.form} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void send({ action: policy.allowPartialRelease ? "release-package" : "release-set", packageId: selected.id, packageIds: policy.allowPartialRelease ? undefined : releaseSetIds, receivingOwner: field(form, "owner"), dueDate: field(form, "due"), note: "Exact package and issued document revisions released" }); }}><label>Deploy receiving owner<input name="owner" required /></label><label>Receipt due<input name="due" type="date" required /></label><button disabled={busy}>{policy.allowPartialRelease ? "Release this package to Deploy" : "Release complete set to Deploy"}</button></form></section> : null}
      <section className={styles.card}><h3>Release manifest and Deploy response</h3><div className={styles.list}>{state.releases.map((item) => <article key={item.id}><div><strong>{packages.find((entry) => entry.id === item.packageId)?.name ?? item.packageId} · rev {item.packageRevision} · {item.status}</strong><small>Issued {item.issuedAt} · receiver {item.receivingOwner} · due {item.responseDueDate}</small><small>Documents: {item.documentRefs.join(", ") || "None"} · source handoff {item.sourceHandoffRevision ?? "legacy"}</small>{item.responseNote ? <small>Response: {item.responseNote}</small> : null}</div><div className={styles.actions}><button type="button" onClick={() => exportManifest(item.id)}>Export manifest</button>{item.status === "Awaiting receipt" ? <button disabled={busy} onClick={() => void send({ action: "withdraw-release", releaseId: item.id, note: "Release withdrawn pending correction" })}>Withdraw</button> : null}</div></article>)}{!state.releases.length ? <p>No package has been released.</p> : null}</div></section></div> : null}
  </section>;
}

export function DesignDeployReceipt({ work, onCommand }: Pick<Props, "work" | "onCommand">) {
  const [note, setNote] = useState("");
  const releases = designState(work).releases;
  if (!releases.length) return null;
  return <section className={styles.workspace}><header className={styles.header}><div><p>DEPLOY · RECEIVING</p><h2>Receive released package revisions</h2><span>Receipt records the governing field basis. It does not start execution.</span></div></header><div className={styles.list}>{releases.map((item) => <article key={item.id}><div><strong>{item.packageId} · rev {item.packageRevision} · {item.status}</strong><small>Issued {item.issuedAt} · documents {item.documentRefs.join(", ")}</small><small>Receiving owner {item.receivingOwner} · due {item.responseDueDate}</small>{item.holdReason ? <small>FIELD HOLD: {item.holdReason} · {item.holdAcknowledgedAt ? `acknowledged ${item.holdAcknowledgedAt}` : "acknowledgment required"}</small> : null}{item.responseNote ? <small>Response: {item.responseNote} · {item.receivedAt}</small> : null}</div>{item.status === "Awaiting receipt" ? <div className={styles.actions}><input aria-label="Receipt reason" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Acceptance or return reason" /><button disabled={!note.trim()} onClick={() => void onCommand({ action: "respond-receipt", releaseId: item.id, response: "Accepted", note })}>Accept</button><button disabled={!note.trim()} onClick={() => void onCommand({ action: "respond-receipt", releaseId: item.id, response: "Returned", note })}>Return</button></div> : item.status === "Hold pending acknowledgment" ? <div className={styles.actions}><input aria-label="Field hold acknowledgment reason" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Confirm field instructions received" /><button disabled={!note.trim()} onClick={() => void onCommand({ action: "acknowledge-hold", releaseId: item.id, note })}>Acknowledge field hold</button></div> : null}</article>)}</div></section>;
}
