"use client";

import { useCallback, useState } from "react";
import { DesignDocumentEvidence } from "@/components/d5o/platform/DesignDocumentEvidence";
import type { CustomerDesignAction } from "@/lib/d5o/hosted/customer-design-contract";

type Document = { id: string; revision: number; title: string; status: string; evidenceId?: string;
  packageIds?: string[]; submittedByActorId?: string };
type Review = { id: string; packageId: string; revision?: number; discipline: string; status: string;
  requestedByActorId?: string; decision?: string };
type Package = { packageId: string; name?: string; revision?: number;
  scope?: string; location?: string; systems?: string; materials?: string; access?: string;
  permit?: string; safetyControls?: string; equipment?: string; method?: string;
  rollback?: string; verification?: string; proof?: string; acceptingAuthority?: string;
  windowStart?: string; windowEnd?: string;
  completionBasis?: { unit?: string; criterion?: string } };
type DesignWork = { id: string; owner?: string; design?: { packages?: Package[]; documents?: Document[];
  reviews?: Review[]; releases?: Array<{ packageId: string; status: string }> };
  discovery?: { outcome?: string; designHandoff?: { status?: string; submittedByActorId?: string } };
  definition?: { scopeControl?: { requirements?: Array<{ id: string; state?: string; description?: string }> } } };
type Props = { workspace: string; work: DesignWork; connectedPackages: Package[]; role: string; busy: boolean;
  onAction: (action: CustomerDesignAction, input: Record<string, unknown>) => Promise<void> };
const disciplines = ["Engineering", "Delivery", "Safety", "Quality"];
const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const note = "Design decision recorded against the exact connected Work revision";

export function CustomerDesignActions({ workspace, work, connectedPackages, role, busy, onAction }: Props) {
  const [evidenceIds, setEvidenceIds] = useState<Record<string, string>>({});
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const onEvidence = useCallback((evidenceId: string, documentId: string) =>
    setEvidenceIds((current) => current[documentId] === evidenceId ? current
      : { ...current, [documentId]: evidenceId }), []);
  const owner = role === "admin" || role === "project_manager";
  const reviewer = role === "operations_leader";
  const packages = connectedPackages.map((item) => work.design?.packages?.find((draft) => draft.packageId === item.packageId) ?? item);
  const documents = work.design?.documents ?? [];
  const reviews = work.design?.reviews ?? [];
  const requirements = work.definition?.scopeControl?.requirements?.filter((item) => item.state === "Confirmed") ?? [];
  const chosen = packages.find((item) => item.packageId === selectedPackageId) ?? packages[0];
  const governingDocument = documents.find((item) => item.packageIds?.includes(chosen?.packageId ?? ""));
  const packageReviews = reviews.filter((item) => item.packageId === chosen?.packageId
    && item.revision === chosen?.revision);
  const activeRelease = work.design?.releases?.some((item) => item.packageId === chosen?.packageId
    && ["Awaiting receipt", "Accepted"].includes(item.status)) ?? false;
  async function submit(event: React.FormEvent<HTMLFormElement>, action: CustomerDesignAction,
    build: (data: FormData) => Record<string, unknown>) {
    event.preventDefault();
    await onAction(action, build(new FormData(event.currentTarget)));
  }
  if (work.discovery?.designHandoff?.status !== "accepted")
    return <div className="d5o-customer-design-actions"><h4>Design actions</h4>
      <p role="status">The awarded Design handoff must be independently accepted before package preparation begins.</p>
      {owner && work.discovery?.outcome === "Won" &&
        work.discovery?.designHandoff?.status !== "submitted" &&
        <form onSubmit={(event) => void submit(event, "submit-handoff", (data) => ({
          dueDate: str(data, "dueDate") }))}>
          <h5>Awarded Design handoff</h5>
          <label>Handoff due date<input name="dueDate" type="date" required /></label>
          <button disabled={busy}>Send awarded Design handoff</button>
        </form>}
      {reviewer && work.discovery?.designHandoff?.status === "submitted" &&
        <form onSubmit={(event) => void submit(event, "accept-handoff", (data) => ({
          reason: str(data, "reason") }))}>
          <h5>Independent Design handoff receipt</h5>
          <label>Receipt reason<textarea name="reason" minLength={20} required /></label>
          <button disabled={busy}>Accept awarded Design handoff</button>
        </form>}
    </div>;
  return <div className="d5o-customer-design-actions">
    <h4>Design actions</h4>
    <p>Each decision is checked against your role, the accepted handoff, this Work record, and its current revision.</p>
    {owner && !chosen && <form onSubmit={(event) => void submit(event, "create-package", (data) => ({
      name: str(data, "name"), owner: str(data, "owner") }))}>
      <h5>Create connected package</h5>
      <label>Package name<input name="name" minLength={3} maxLength={120} required /></label>
      <label>Responsible owner<input name="owner" defaultValue={work.owner} minLength={2} required /></label>
      <button disabled={busy}>Create package</button>
    </form>}
    {chosen && <><p><strong>{chosen.name ?? "Design package"}</strong></p>
      {packages.length > 1 && <label>Design package<select value={chosen.packageId}
        onChange={(event) => setSelectedPackageId(event.target.value)}>
        {packages.map((item) => <option key={item.packageId} value={item.packageId}>{item.name ?? item.packageId}</option>)}
      </select></label>}
      {owner && !governingDocument && <form onSubmit={(event) => void submit(event, "save-document", (data) => ({
        document: { id: `doc-${crypto.randomUUID()}`, type: str(data, "type"), title: str(data, "title"),
          source: str(data, "source"), packageIds: [chosen.packageId],
          requirementIds: requirements.map((item) => item.id), dueDate: str(data, "dueDate") }, note }))}>
        <h5>Prepare a controlled document</h5>
        <label>Document type<input name="type" defaultValue="Method statement" minLength={2} required /></label>
        <label>Document title<input name="title" minLength={3} required /></label>
        <label>Document source reference<input name="source" minLength={5} required /></label>
        <label>Due date<input name="dueDate" type="date" required /></label>
        <button disabled={busy || requirements.length === 0}>Save document draft</button>
        {requirements.length === 0 && <p role="status">Confirmed Define requirements are needed before a document can be prepared.</p>}
      </form>}
      {governingDocument && <section><h5>Document custody · {governingDocument.title}</h5>
        <p>Status: {governingDocument.status}; revision {governingDocument.revision}.</p>
        <DesignDocumentEvidence workspace={workspace} workId={work.id} documentId={governingDocument.id}
          revision={governingDocument.revision} canUpload={owner && governingDocument.status === "Draft"}
          onEvidence={onEvidence} />
        {owner && governingDocument.status === "Draft" && <button disabled={busy || !evidenceIds[governingDocument.id]}
          onClick={() => void onAction("submit-document", { documentId: governingDocument.id,
            documentRevision: governingDocument.revision, evidenceId: evidenceIds[governingDocument.id], note })}>
          Submit document for independent review</button>}
        {reviewer && governingDocument.status === "In review" && <form onSubmit={(event) => void submit(event,
          "approve-document", (data) => ({ documentId: governingDocument.id,
          documentRevision: governingDocument.revision, evidenceId: governingDocument.evidenceId,
          note: str(data, "note") }))}>
          <label>Independent review note<textarea name="note" minLength={15} required /></label>
          <button disabled={busy}>Approve document</button>
        </form>}
        {owner && governingDocument.status === "Approved" && <button disabled={busy}
          onClick={() => void onAction("issue-document", { documentId: governingDocument.id,
            documentRevision: governingDocument.revision, evidenceId: governingDocument.evidenceId, note })}>
          Issue approved document for use</button>}
      </section>}
      {owner && !activeRelease && <form key={`${chosen.packageId}:${chosen.revision ?? 0}`}
        onSubmit={(event) => void submit(event, "save-package", (data) => ({
        package: { packageId: chosen.packageId, scope: str(data, "scope"), location: str(data, "location"),
          systems: str(data, "systems"), completionBasis: { kind: "Measured", plannedQuantity: 1,
            unit: str(data, "unit"), criterion: str(data, "criterion") },
          requirementIds: requirements.map((item) => item.id), predecessorIds: [],
          documentRefs: governingDocument ? [`${governingDocument.id}@${governingDocument.revision}`] : [],
          materials: str(data, "materials"), materialLines: [], materialStatus: "Unknown",
          materialRequiredDate: str(data, "start"), materialForecastDate: "", materialSource: "",
          access: str(data, "access"), permit: str(data, "permit"), safetyControls: str(data, "safety"),
          equipment: str(data, "equipment"), method: str(data, "method"), rollback: str(data, "rollback"),
          verification: str(data, "verification"), proof: str(data, "proof"),
          acceptingAuthority: str(data, "authority"), windowStart: str(data, "start"),
          windowEnd: str(data, "end"), targetReleaseDate: str(data, "start"), crewDemandRequired: true,
          crewExemptionReason: "", commercialImpact: "", commercialDisposition: "None" }, note }))}>
        <h5>Package basis</h5>
        <p>{requirements.length} confirmed requirement(s); {governingDocument ? "controlled document linked" : "save a document first"}.
          {chosen.revision ? ` Saved package revision ${chosen.revision}.` : ""}</p>
        {([ ["scope","Scope"],["location","Work location"],["systems","Systems"],
          ["unit","Completion unit"],["criterion","Completion criterion"],["materials","Materials"],
          ["access","Access"],["permit","Permit"],["safety","Safety controls"],
          ["equipment","Equipment"],["method","Method of procedure"],["rollback","Rollback"],
          ["verification","Verification"],["proof","Proof"],["authority","Accepting authority"] ] as const)
          .map(([key,label]) => {
            const field=({unit:"completionBasis.unit",criterion:"completionBasis.criterion",
              safety:"safetyControls",authority:"acceptingAuthority"} as Record<string,string>)[key] ?? key;
            const value=field.startsWith("completionBasis.")
              ? chosen.completionBasis?.[field.split(".")[1] as "unit" | "criterion"]
              : chosen[field as keyof Package];
            return <label key={key}>{label}<input name={key}
              defaultValue={typeof value === "string" ? value : undefined}
              required={key !== "method"} /></label>;
          })}
        <label>Execution start<input name="start" type="date" defaultValue={chosen.windowStart} required /></label>
        <label>Execution end<input name="end" type="date" defaultValue={chosen.windowEnd} required /></label>
        <button disabled={busy || requirements.length === 0 || !governingDocument}>Save package basis</button>
      </form>}
      {owner && !activeRelease && <form onSubmit={(event) => void submit(event, "save-demand", (data) => ({
        workId: work.id, packageId: chosen.packageId, qualification: str(data, "qualification"),
        minimumPeople: Number(data.get("people")), estimatedPersonHours: Number(data.get("hours")),
        priority: "High", prerequisite: str(data, "prerequisite"), crewSchedulable: true,
        requiredSlots: [{ date: str(data, "date"), shift: str(data, "shift") }] }))}>
        <h5>Crew demand</h5>
        <label>Qualification<input name="qualification" required /></label>
        <label>Minimum people<input name="people" type="number" min="1" required /></label>
        <label>Estimated person hours<input name="hours" type="number" min="1" required /></label>
        <label>Prerequisite<input name="prerequisite" required /></label>
        <label>Required date<input name="date" type="date" required /></label>
        <label>Shift<input name="shift" required /></label>
        <button disabled={busy}>Save dated crew demand</button>
      </form>}
      {owner && !activeRelease && disciplines.map((discipline) => !packageReviews.some((item) => item.discipline === discipline)
        ? <form key={discipline} onSubmit={(event) => void submit(event, "request-review", (data) => ({
          packageId: chosen.packageId, discipline, assignee: `${discipline} review queue`,
          dueDate: str(data, "dueDate"), note: `Independent ${discipline} review requested for this package` }))}>
          <h5>{discipline} review</h5><label>Review due date<input name="dueDate" type="date" required /></label>
          <button disabled={busy}>Request {discipline} review</button></form> : null)}
      {reviewer && packageReviews.filter((item) => item.status === "Requested").map((review) =>
        <form key={review.id} onSubmit={(event) => void submit(event, "decide-review", (data) => ({
          reviewId: review.id, decision: "Approved", note: str(data, "note") }))}>
          <h5>{review.discipline} review</h5>
          <label>Independent decision note<textarea name="note" minLength={15} required /></label>
          <button disabled={busy}>Approve {review.discipline} review</button>
        </form>)}
      {owner && !work.design?.releases?.some((item) => item.packageId === chosen.packageId) &&
        <form onSubmit={(event) => void submit(event, "release-package", (data) => ({
          packageId: chosen.packageId, dueDate: str(data, "dueDate"), note: str(data, "note") }))}>
          <h5>Release package</h5><p>Requires an issued document, complete package basis, dated crew demand, and all required independent reviews.</p>
          <label>Receipt due date<input name="dueDate" type="date" required /></label>
          <label>Release reason<textarea name="note" minLength={15} required /></label>
          <button disabled={busy}>Release for independent receipt</button>
        </form>}
    </>}
  </div>;
}
