"use client";
import { FocusedTaskFrame } from "./FocusedTaskFrame";

import { useRef, useState } from "react";
import type { DefinitionRecord, WorkRecord } from "./work-types";
import type { WorkspaceKey } from "./work-types";
import { ConfiguredPhasePanel } from "./ConfiguredPhasePanel";
import { DefinitionRegister } from "./DefinitionRegister";
import { DefineInvestigation } from "./DefineInvestigation";
import { DefineScopeControls } from "./DefineScopeControls";
import { assessDefine } from "./define-readiness";
import type { DefineCommand } from "@/lib/d5o/prototype-work/define-command";
import { evaluateRule } from "./phase-configuration";
import { resolvePublishedPhaseConfiguration } from "./published-phase-configuration";
import type { ConfigurationInventory } from "@/lib/d5o/configuration/version-inventory";
import styles from "./DefineWorkspace.module.css";
import { WorkPhaseJourney, type WorkPhase, type WorkControl } from "./WorkPhaseJourney";

type Section = "brief" | "investigation" | "scope" | "delivery" | "commercial" | "risks";
const sections: Array<{ key: Section; label: string }> = [
  { key: "brief", label: "Project brief" },
  { key: "investigation", label: "Investigation" },
  { key: "scope", label: "Scope & acceptance" },
  { key: "delivery", label: "Delivery basis" },
  { key: "commercial", label: "Commercial dependency" },
  { key: "risks", label: "Review & handoff" },
];
const now = () => new Date().toISOString();
const initial = (work: WorkRecord): DefinitionRecord => ({
  revision: 1, status: "Draft", outcome: "", acceptance: "", includedScope: "", excludedScope: "",
  deliveryApproach: "", milestones: "", dependencies: "", estimateBasis: "", commercialTerms: "",
  risks: "", owner: work.owner, history: [],
  ...(work.workspace === "rybex" && work.id === "rybex-3" ? {
    project: { customerContact: "", siteArea: "DC-3 generator plant · Manassas", affectedSystems: "Generator monitoring and telemetry", accessConstraints: "Live data center; access and shutdown windows to confirm", requiredDate: "2026-10-22" },
    findings: [{ id: "dc3-briefing", kind: "Customer input" as const, status: "Provisional" as const, detail: "Customer seeks generator monitoring across the DC-3 plant; monitoring points and network access remain unverified.", source: "Synthetic customer briefing · reference only", author: "Rybex pursuit team", at: "2026-10-06T12:00:00.000Z" }],
    clarifications: [{ id: "dc3-points", question: "Which generator points and alarm thresholds must be included?", owner: "North Campus facilities lead", due: "2026-10-12", answer: "", source: "", status: "Open" as const, openedAt: "2026-10-06T12:00:00.000Z" }],
  } : {}),
});

export function DefineWorkspace({ workspaceKey, configurationInventory, work, focusRecordId, reviewFocus, actorLabel, onReviewQueued, onCommand, onOpen, onPhase, onControl, onBack, onSelect, onUpdate, onNotice, visiblePhases }: {
  workspaceKey: WorkspaceKey;
  workspaceName: string;
  configurationInventory: ConfigurationInventory;
  work: WorkRecord[];
  focusRecordId?: string;
  reviewFocus?: "commercial" | "delivery" | "define-prep" | "develop-handoff-prep" | "develop-handoff-receive" | null;
  actorLabel: string;
  onReviewQueued: () => void;
  onCommand: (command: Omit<DefineCommand, "expectedRevision" | "commandId">) => Promise<boolean>;
  onOpen: (work: WorkRecord) => void;
  onPhase: (work: WorkRecord, phase: WorkPhase) => void;
  onControl: (work: WorkRecord, control: WorkControl) => void;
  onBack: () => void;
  onSelect: (id: string) => void;
  onUpdate: (id: string, transform: (work: WorkRecord) => WorkRecord) => void;
  onNotice: (notice: string) => void;
  visiblePhases?: readonly WorkPhase[];
}) {
  const candidates = work.filter((item) => item.discovery?.pursuitControl
    ? item.discovery.pursuitControl.handoff?.status === "accepted"
    : item.definition || item.discovery?.fit === "Qualified" || item.discovery?.fit === "Conditional" || item.discovery?.outcome === "Won");
  const [section, setSection] = useState<Section>(reviewFocus === "define-prep" ? "brief" : reviewFocus ? "risks" : "brief");
  const [editingField, setEditingField] = useState<keyof DefinitionRecord | null>(null);
  const [fieldDraft, setFieldDraft] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const [reviewNote, setReviewNote] = useState("");
  const requestedWork = work.find((item) => item.id === focusRecordId);
  const selected = focusRecordId ? candidates.find((item) => item.id === focusRecordId) : candidates[0];
  const definition = selected ? { ...initial(selected), ...selected.definition } : undefined;
  const config = selected ? resolvePublishedPhaseConfiguration(configurationInventory, workspaceKey, selected.type, selected) : null;
  const definePhase = config?.phases.find((item) => item.key === "define");
  const commercialRequired = Boolean(definePhase?.components.some((item) => item.key === "commercial_source"));
  const visibleSections = commercialRequired ? sections : sections.filter((item) => item.key !== "commercial");
  const configuredRules = definePhase?.components.flatMap((item) => item.rules ?? []).filter((item) => item.requiredAt === "review") ?? [];
  const missing = selected ? configuredRules.filter((item) => !evaluateRule(selected, item)) : [];
  const verdict = selected && definition ? assessDefine(selected, definition, config?.version ?? "unavailable", missing.map((item) => item.message)) : null;
  const earlierApproval = definition?.status === "Approved" && !definition.scopeControl;
  const complete = configuredRules.length - missing.length;
  const sourceChanged = (definition?.status === "In review" || definition?.status === "Approved") && (
    (commercialRequired && (definition.sourceEstimateRevision !== selected?.discovery?.estimate.revision ||
    definition.sourceProposalRevision !== selected?.discovery?.proposal.package?.revision ||
    selected?.discovery?.estimate.status !== "Approved")) ||
    definition.configurationVersion !== config?.version ||
    definition.configurationWorkTypeKey !== config?.workTypeKey
  );
  const locked = definition?.status === "In review" || definition?.status === "Approved" || definition?.status === "Changes requested";
  const inReview = candidates.filter((item) => item.definition?.status === "In review").length;
  const ready = candidates.filter((item) => { const pinned = resolvePublishedPhaseConfiguration(configurationInventory, workspaceKey, item.type, item); const requiresCommercial = pinned?.phases.find((phase) => phase.key === "define")?.components.some((component) => component.key === "commercial_source"); return item.definition?.status === "Approved" && (!requiresCommercial || item.definition.sourceEstimateRevision === item.discovery?.estimate.revision && item.definition.sourceProposalRevision === item.discovery?.proposal.package?.revision && item.discovery?.estimate.status === "Approved") && item.definition.configurationVersion === pinned?.version && item.definition.configurationWorkTypeKey === pinned?.workTypeKey; }).length;
  const scopeItems = definition?.registers?.scope_items?.length ?? 0;
  const acceptanceItems = definition?.registers?.acceptance_criteria?.length ?? 0;
  const openQuestions = definition?.clarifications?.filter((item) => item.status === "Open").length ?? 0;
  const investigationReady = Boolean(definition?.project?.customerContact.trim() && definition.project.siteArea.trim() && definition.project.affectedSystems.trim() && definition.project.accessConstraints.trim() && definition.findings?.some((item) => item.status === "Confirmed") && !openQuestions);
  const firstMissingFact = missing[0]?.fact ?? "";
  const nextSection: Section = openQuestions ? "investigation" : firstMissingFact === "discovery.estimate.status" ? "commercial" : firstMissingFact === "definition.deliveryApproach" || firstMissingFact === "definition.registers.milestones" || firstMissingFact === "definition.registers.dependencies" ? "delivery" : firstMissingFact === "definition.registers.risks" ? "risks" : firstMissingFact ? "scope" : "risks";
  const nextStep = sourceChanged ? "Start a new revision" : definition?.status === "Approved" ? "Continue to Develop" : definition?.status === "In review" ? "See review decisions" : definition?.status === "Changes requested" ? "Make corrections" : verdict?.next ? `Resolve: ${verdict.next.label}` : "Review and submit";

  function openSection(target: Section) {
    setSection(target);
    window.requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function saveField(key: keyof DefinitionRecord, value: string) {
    if (!selected || !definition || locked) return;
    onUpdate(selected.id, (current) => {
      const latest = current.definition ?? definition;
      if (latest.status !== "Draft" && latest.status !== "Changes requested") return current;
      const newRevision = latest.status === "Changes requested";
      const revision = newRevision ? latest.revision + 1 : latest.revision;
      return { ...current, definition: {
        ...latest, [key]: value, status: "Draft", revision,
        reviews: newRevision ? undefined : latest.reviews,
        developHandoff: newRevision ? undefined : latest.developHandoff,
        history: [...latest.history, ...(newRevision ? [{ at: now(), revision, event: "New revision started", note: "Changes requested by a reviewer." }] : []), { at: now(), revision, event: "Definition field updated", note: `${actorLabel} updated ${String(key)}.` }],
      } };
    });
  }

  function saveRegister(key: string, rows: Array<Record<string, string>>) {
    if (!selected || !definition || locked) return;
    const legacyKey: Record<string, "includedScope" | "acceptance" | "milestones" | "dependencies" | "risks"> = { scope_items: "includedScope", acceptance_criteria: "acceptance", milestones: "milestones", dependencies: "dependencies", risks: "risks" };
    if (!legacyKey[key]) { onNotice("This register has no compatible definition binding."); return; }
    const summary = rows.map((row) => Object.entries(row).filter(([field]) => !["id", "requirementId", "scopeId"].includes(field)).map(([, value]) => value).filter(Boolean).join(" · ")).join("; ");
    onUpdate(selected.id, (current) => {
      const latest = current.definition ?? definition;
      if (latest.status !== "Draft" && latest.status !== "Changes requested") return current;
      const newRevision = latest.status === "Changes requested";
      const revision = newRevision ? latest.revision + 1 : latest.revision;
      return { ...current, definition: {
        ...latest, registers: { ...latest.registers, [key]: rows }, [legacyKey[key]]: summary,
        status: "Draft", revision,
        reviews: newRevision ? undefined : latest.reviews,
        developHandoff: newRevision ? undefined : latest.developHandoff,
        history: [...latest.history, ...(newRevision ? [{ at: now(), revision, event: "New revision started", note: "Changes requested by a reviewer." }] : []), { at: now(), revision, event: "Definition register updated", note: `${actorLabel} updated ${key}; ${rows.length} ${rows.length === 1 ? "item" : "items"} recorded.` }],
      } };
    });
  }

  function saveInvestigation(patch: Partial<DefinitionRecord>) {
    if (!selected || !definition || locked) return;
    onUpdate(selected.id, (current) => {
      const latest = current.definition ?? definition;
      if (latest.status !== "Draft" && latest.status !== "Changes requested") return current;
      const newRevision = latest.status === "Changes requested";
      const revision = newRevision ? latest.revision + 1 : latest.revision;
      return { ...current, definition: {
        ...latest, ...patch, status: "Draft", revision,
        reviews: newRevision ? undefined : latest.reviews,
        developHandoff: newRevision ? undefined : latest.developHandoff,
        history: [...latest.history, ...(newRevision ? [{ at: now(), revision, event: "New revision started", note: "Investigation updated after changes were requested." }] : []), { at: now(), revision, event: "Investigation updated", note: `${actorLabel} recorded project context, a finding, or a customer clarification.` }],
      } };
    });
  }

  function saveScopeControl(scopeControl: NonNullable<DefinitionRecord["scopeControl"]>) {
    if (!selected || !definition || locked) return;
    onUpdate(selected.id, (current) => {
      const latest = current.definition ?? definition;
      if (latest.status !== "Draft" && latest.status !== "Changes requested") return current;
      const newRevision = latest.status === "Changes requested";
      const revision = newRevision ? latest.revision + 1 : latest.revision;
      return { ...current, definition: {
        ...latest, scopeControl, status: "Draft", revision,
        reviews: newRevision ? undefined : latest.reviews, developHandoff: undefined,
        history: [...latest.history, ...(newRevision ? [{ at: now(), revision, event: "New revision started", note: "Scope controls corrected after review." }] : []), { at: now(), revision, event: "Scope control updated", note: `${actorLabel} changed requirements, interfaces, assumptions, agreement, or ROM basis.` }],
      } };
    });
  }

  const register = (key: string) => {
    const component = definePhase?.components.find((item) => item.key === key);
    const link = key === "scope_items" ? { key: "requirementId", label: "Customer requirement", options: (definition?.scopeControl?.requirements ?? []).map((item) => ({ id: item.id, label: item.need })) } : key === "acceptance_criteria" ? { key: "scopeId", label: "Included deliverable", options: (definition?.registers?.scope_items ?? []).map((item) => ({ id: item.id, label: item.deliverable })) } : undefined;
    return component ? <DefinitionRegister key={`${selected?.id ?? "none"}-${key}`} component={component} rows={definition?.registers?.[key] ?? []} disabled={Boolean(locked)} link={link} onChange={(rows) => saveRegister(key, rows)} /> : null;
  };

  function submit() {
    if (!selected || !definition) return;
    if (!config || !definePhase) { onNotice("No compatible reference configuration exists for this Work Type and workspace."); return; }
    if (verdict?.next) { onNotice(`${verdict.next.label}: ${verdict.next.detail}`); openSection(verdict.next.area); return; }
    if (missing.length) { onNotice(`Complete ${missing.length} required definition ${missing.length === 1 ? "item" : "items"} before requesting review.`); return; }
    if (openQuestions) { onNotice(`Resolve ${openQuestions} open customer ${openQuestions === 1 ? "question" : "questions"} before requesting review.`); openSection("investigation"); return; }
    if (!investigationReady) { onNotice("Confirm the contact, site, affected systems, access constraints, one sourced finding, and all open questions before review."); openSection("investigation"); return; }
    if (definition.status !== "Draft") return;
    void onCommand({ workId: selected.id, action: "submit" });
  }

  function submitDevelopHandoff() {
    if (!selected || !definition || definition.status !== "Approved" || sourceChanged) return;
    if (!investigationReady) { onNotice("Resolve the investigation and sourced project context before handing this revision to Develop."); return; }
    if (definition.scopeControl && verdict?.next) { onNotice(`Define basis is incomplete: ${verdict.next.detail}`); return; }
    if (definition.developHandoff?.status === "submitted" || definition.developHandoff?.status === "accepted") return;
    void onCommand({ workId: selected.id, action: "submit-handoff" });
  }

  function respondDevelopHandoff(status: "accepted" | "returned") {
    if (!selected || !definition || definition.status !== "Approved" || sourceChanged || definition.developHandoff?.status !== "submitted" || definition.developHandoff.revision !== definition.revision) return;
    if (!reviewNote.trim()) { onNotice("Record the receiving decision basis before responding."); return; }
    void onCommand({ workId: selected.id, action: status === "accepted" ? "accept-handoff" : "return-handoff", reason: reviewNote.trim() }).then((saved) => { if (saved) setReviewNote(""); });
  }

  function startReturnedRevision() {
    if (!selected || !definition || (definition.developHandoff?.status !== "returned" && definition.status !== "Changes requested")) return;
    void onCommand({ workId: selected.id, action: "new-revision", reason: definition.status === "Changes requested" ? "Specialist review returned this Define baseline for correction." : "Develop returned this baseline for correction." }).then((saved) => { if (saved) setSection("investigation"); });
  }

  function startInvestigationRevision() {
    if (!selected || !definition || definition.status !== "Approved" || definition.developHandoff?.status === "accepted") return;
    void onCommand({ workId: selected.id, action: "new-revision", reason: "Further project investigation requires a new Define baseline." }).then((saved) => { if (saved) setSection("investigation"); });
  }

  function decide(role: "commercial" | "delivery", decision: "Approved" | "Changes requested") {
    if (!selected || !definition?.reviews || definition.status !== "In review") return;
    if (!config || !definePhase || sourceChanged || missing.length) { onNotice("The governing configuration, requirements or referenced source changed. Start a new definition revision before deciding."); return; }
    if (decision === "Approved" && verdict?.next) { onNotice(`Scope approval is blocked: ${verdict.next.detail}`); return; }
    if (definition.reviews[role] !== "Pending") return;
    if (!reviewNote.trim()) { onNotice("Record the decision basis before deciding."); return; }
    void onCommand({ workId: selected.id, action: decision === "Approved" ? "approve-review" : "return-review", role, reason: reviewNote.trim() }).then((saved) => { if (saved) setReviewNote(""); });
  }

  function refreshSource() {
    if (!selected || !definition || !sourceChanged) return;
    void onCommand({ workId: selected.id, action: "new-revision", reason: "Source or phase configuration changed after Define review." });
  }

  const field = (label: string, key: keyof DefinitionRecord, hint: string) => {
    const registerKey: Partial<Record<keyof DefinitionRecord, string>> = { includedScope: "scope_items", acceptance: "acceptance_criteria", milestones: "milestones", dependencies: "dependencies", risks: "risks" };
    if (registerKey[key]) return register(registerKey[key]);
    const componentKey: Partial<Record<keyof DefinitionRecord, string>> = { outcome: "promised_outcome", excludedScope: "excluded_scope", deliveryApproach: "delivery_design" };
    const configured = definePhase?.components.find((item) => item.key === componentKey[key]);
    return <div className={styles.fieldSummary} key={key}><div><strong>{configured?.label ?? label}</strong><small>{configured?.help ?? hint}</small><p>{String(definition?.[key] ?? "") || "Not recorded"}</p></div><button type="button" className="d5o-outline" onClick={() => { setEditingField(key); setFieldDraft(String(definition?.[key] ?? "")); }}>{locked ? "View" : "Edit"}</button></div>;
  };
  const editableFields: Partial<Record<keyof DefinitionRecord, string>> = { outcome: "Promised outcome", excludedScope: "Exclusions and customer responsibilities", deliveryApproach: "Delivery approach" };

  if (focusRecordId && !selected) return <main className="d5o-page d5o-define-phase">
    {requestedWork && !reviewFocus ? <WorkPhaseJourney active="Define" record={requestedWork} backLabel="Discover" onBack={onBack} visiblePhases={visiblePhases} onChoose={(phase) => onPhase(requestedWork, phase)} onControl={(control) => onControl(requestedWork, control)} /> : null}
    <FocusedTaskFrame title="Define is not ready for this work" work={requestedWork?.title ?? "Work Record unavailable"}
      customer={requestedWork?.customer ?? ""} site={requestedWork?.site} workspace={workspaceKey}
      scope={requestedWork?.discovery?.need ?? "The requested Work Record is not available in this workspace."}
      revision={requestedWork?.discovery?.pursuitControl?.revision ?? "unavailable"}
      outcome="Complete the Discover handoff for this job before preparing its definition."
      blocker={requestedWork ? "This job does not have an accepted Discover-to-Define handoff." : "The requested record is unavailable. Return to My Work for current actions."}
      nextOwner={!requestedWork ? null : requestedWork.discovery?.pursuitControl?.handoff?.status === "submitted" ? "The named Define receiver" : "The project manager preparing the Discover handoff"}>
      {requestedWork ? <button type="button" className="d5o-primary" onClick={() => onPhase(requestedWork, "Discover")}>Open this job in Discover</button> : null}
    </FocusedTaskFrame>
  </main>;

  if ((reviewFocus === "develop-handoff-prep" || reviewFocus === "develop-handoff-receive") && selected && definition) return <main className="d5o-page d5o-define-phase">
    <FocusedTaskFrame title={reviewFocus === "develop-handoff-prep" ? "Submit approved Define basis" : "Receive approved Define basis"}
      work={selected.title} customer={selected.customer} site={selected.site} workspace={workspaceKey}
      scope={`Approved outcome: ${definition.outcome}. Included: ${definition.includedScope || "See structured scope"}. Acceptance: ${definition.acceptance || "See structured criteria"}.`}
      revision={definition.revision} outcome={reviewFocus === "develop-handoff-prep" ? "Submit this exact approved baseline to an independent Develop receiver." : "Accept the exact approved revision into Develop, or return it with a correction reason."}
      blocker={sourceChanged ? "The reviewed source changed; prepare a new revision." : !investigationReady ? "Investigation is incomplete." : null}
      nextOwner={reviewFocus === "develop-handoff-prep" ? "Independent Develop receiver" : "Project manager for solution preparation"}
      onFullRecord={() => onOpen(selected)} context={<><p>Exclusions: {definition.excludedScope}</p><p>Delivery: {definition.deliveryApproach}</p><p>Requirements: {definition.scopeControl?.requirements.map((item) => item.need).join("; ") || "See full baseline"}</p><p>Acceptance criteria: {(definition.registers?.acceptance_criteria ?? []).map((item) => item.result).join("; ") || "See full baseline"}</p></>}>
      {reviewFocus === "develop-handoff-prep" ? <button type="button" className="d5o-primary" disabled={sourceChanged || !investigationReady} onClick={submitDevelopHandoff}>Send approved revision to Develop</button> : <><p>Submitted by a separate actor. Receiving does not approve pricing or delivery.</p><label className={styles.field}>Receiving decision basis<textarea rows={3} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></label><div className={styles.handoffActions}><button type="button" className="d5o-outline" disabled={!reviewNote.trim() || sourceChanged} onClick={() => respondDevelopHandoff("returned")}>Return for correction</button><button type="button" className="d5o-primary" disabled={!reviewNote.trim() || sourceChanged} onClick={() => respondDevelopHandoff("accepted")}>Accept into Develop</button></div></>}
    </FocusedTaskFrame>
  </main>;

  if ((reviewFocus === "commercial" || reviewFocus === "delivery") && selected && definition) return <main className="d5o-page d5o-define-phase">
    <FocusedTaskFrame title={`${reviewFocus === "commercial" ? "Commercial" : "Delivery"} definition review`}
      work={selected.title} customer={selected.customer} site={selected.site} workspace={workspaceKey}
      scope={`Definition baseline · ${definition.outcome || "Outcome not recorded"}`}
      revision={definition.revision} outcome="Approve this exact scope and delivery basis, or return it with required corrections."
      blocker={sourceChanged ? "The upstream source changed; a new revision is required." : missing.length ? `${missing.length} configured requirements remain open.` : null}
      nextOwner={reviewFocus === "commercial" ? "Delivery reviewer after Commercial approval" : "Develop receiver after both reviews"}
      onFullRecord={() => onOpen(selected)}
      context={<><p><strong>Included scope:</strong> {definition.includedScope || "See structured scope register"}</p>
        <p><strong>Exclusions:</strong> {definition.excludedScope || "Not recorded"}</p>
        <p><strong>Delivery approach:</strong> {definition.deliveryApproach || "Not recorded"}</p>
        <p><strong>Acceptance:</strong> {definition.acceptance || "See structured acceptance register"}</p>
        <p><strong>Configuration:</strong> {verdict?.policy ?? "Unavailable"}</p></>}>
      <section className={styles.review}><h2>Review the current baseline</h2>
        <p>Current position: {definition.reviews?.[reviewFocus] ?? "Unavailable"}. Approval does not approve an offer, award or field release.</p>
        <p><strong>Customer outcome:</strong> {definition.outcome || "Not recorded"}</p>
        <p><strong>Scope:</strong> {definition.includedScope || "Review the structured scope in supporting context"}</p>
        <p><strong>Acceptance basis:</strong> {definition.acceptance || "Review structured acceptance criteria in the full record"}</p>
        {verdict?.checks.filter((item) => !item.met).map((item) => <p key={item.key} role="status"><strong>{item.label}:</strong> {item.detail}</p>)}
        {definition.reviews?.[reviewFocus] === "Pending" ? <><label className={styles.field}><span>Decision basis</span>
          <textarea rows={3} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Reason or required correction" /></label>
          <div className={styles.roleActions}><button className="d5o-outline" disabled={!reviewNote.trim() || sourceChanged || missing.length > 0 || !config}
            onClick={() => decide(reviewFocus, "Changes requested")}>Request changes</button>
          <button className="d5o-primary" disabled={!reviewNote.trim() || sourceChanged || verdict?.status !== "Ready for review" || !config}
            onClick={() => decide(reviewFocus, "Approved")}>Approve revision {definition.revision}</button></div></> : <p>This review has changed or was decided. Return to My Work for current actions.</p>}
      </section>
    </FocusedTaskFrame>
  </main>;

  return <main className="d5o-page d5o-record-full d5o-early-phase d5o-define-phase">
    {reviewFocus === "define-prep" && selected && definition ? <FocusedTaskFrame title="Prepare definition" work={selected.title} customer={selected.customer} site={selected.site} workspace={workspaceKey}
      scope={`Discover handoff revision ${selected.discovery?.pursuitControl?.handoff?.revision ?? "unavailable"}: ${selected.discovery?.pursuitControl?.handoff?.brief ?? "No accepted brief"}`}
      revision={definition.revision} outcome="Complete the investigation, structured scope, acceptance and delivery basis; submit this revision for independent review."
      blocker={verdict?.next?.detail ?? null} nextOwner="Independent Commercial and Delivery reviewers"
      onFullRecord={() => onOpen(selected)} context={<p>Customer need: {selected.discovery?.need}. Configuration: {config?.version ?? "Unavailable"}.</p>}>
      <p>Use the definition sections below. Save each source before requesting review.</p>
    </FocusedTaskFrame> : <WorkPhaseJourney active="Define" record={selected} backLabel="Discover" onBack={onBack} visiblePhases={visiblePhases} onChoose={(phase) => { if (selected) onPhase(selected, phase); }} onControl={(control) => { if (selected) onControl(selected, control); }} />}
    <div className={`${styles.layout} d5o-early-phase-layout`} style={reviewFocus === "define-prep" ? { gridTemplateColumns: "minmax(0, 1fr)" } : undefined}>
      {reviewFocus !== "define-prep" && !selected ? <details className={`${styles.queue} d5o-early-phase-rail`} open aria-label="Work ready for definition">
        <summary className={styles.queueSummary}><span><b>CHOOSE WORK TO DEFINE</b><strong>{candidates.length ? "Select a Work Record" : "No work ready for Define"}</strong></span><small>{candidates.length} available · {inReview} in review · {ready} approved</small></summary>
        {candidates.length ? candidates.map((item) => <button key={item.id} className={styles.queueItem} onClick={() => { setEditingField(null); onSelect(item.id); setSection("brief"); }}><strong>{item.title}</strong><span>{item.customer} · {item.site}</span><small>{item.discovery?.outcome === "Won" ? "Awarded pursuit" : item.discovery?.fit ?? "Qualified"} · {item.definition?.status ?? "Definition not started"}</small></button>) : <div className={styles.empty}><strong>No work is ready for definition</strong><p>Qualify work in Discover to establish the scope and delivery basis here.</p></div>}
      </details> : null}
      {selected && definition ? <section className={`${styles.detail} d5o-early-phase-main`} aria-label="Selected Work Record definition">
        {reviewFocus !== "define-prep" ? <div className={styles.summary}><div><small>STATUS</small><strong>{definition.status}</strong></div><div><small>OWNER</small><strong>{definition.owner}</strong></div><div><small>COMPLETENESS</small><strong>{config ? `${complete} / ${configuredRules.length} configured rules` : "Configuration unavailable"}</strong></div><div><small>DISCOVER BASIS</small><strong>{selected.discovery?.pursuitControl?.handoff?.status === "accepted" ? "Accepted pursuit handoff" : selected.discovery?.fit === "Qualified" ? "Legacy qualified record" : "Handoff not accepted"}</strong></div></div> : null}
        <label className="d5o-responsive-section-select">Define section<select aria-label="Define section" value={section} onChange={(event) => setSection(event.target.value as typeof section)}>{visibleSections.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        <nav className={styles.tabs} aria-label="Definition sections" data-responsive-sections>{visibleSections.map((item) => <button key={item.key} className={section === item.key ? styles.active : ""} onClick={() => setSection(item.key)}>{item.label}</button>)}</nav>
        {reviewFocus !== "define-prep" ? <div className={styles.baselineFocus}>
          <div className={styles.baselineHeading}><div><p className={styles.kicker}>THE DEFINITION AT A GLANCE</p><h3>{definition.outcome || "Set the customer outcome"}</h3><p>{definition.outcome ? "The result this revision promises to deliver." : "Start with the customer result before detailing the scope."}</p></div><button type="button" className="d5o-primary" onClick={() => { if (definition.developHandoff?.status === "returned") startReturnedRevision(); else if (sourceChanged) refreshSource(); else if (definition.status === "Approved" && !investigationReady) startInvestigationRevision(); else if (definition.status === "Approved") openSection("risks"); else openSection(definition.status === "Changes requested" ? "scope" : nextSection); }}>{definition.developHandoff?.status === "returned" ? "Revise returned baseline" : definition.status === "Approved" && !investigationReady ? "Start investigation revision" : definition.status === "Approved" ? "Review Develop handoff" : nextStep} →</button></div>
          <div className={styles.baselineFacts}><span><b>INCLUDED SCOPE</b>{scopeItems} {scopeItems === 1 ? "structured item" : "structured items"}</span><span><b>ACCEPTANCE</b>{acceptanceItems} {acceptanceItems === 1 ? "measurable criterion" : "measurable criteria"}</span><span><b>DEFINE VERDICT</b>{earlierApproval ? "Earlier approved basis · clarity v1 not applied" : `${verdict?.status ?? "Unavailable"} · ${verdict?.checks.filter((item) => !item.met).length ?? 0} open checks`}</span></div>
          {verdict?.next && !earlierApproval ? <p className={styles.baselineBlocker}>Next to resolve: {verdict.next.detail}</p> : null}
        </div> : null}
        <details className="d5o-phase-disclosure"><summary>Configured Define requirements and source</summary>{config && definePhase ? <ConfiguredPhasePanel config={config} phase={definePhase} work={selected} compact /> : <p>No reference configuration matches this Work Type in the selected workspace. Definition review is unavailable.</p>}</details>
        {sourceChanged ? <div className={styles.sourceAlert} role="alert"><strong>Review source changed</strong><span>The reviewed estimate, proposal, or configuration no longer matches this Work Record. The previous decision remains in history; start a new revision before treating the definition as current.</span><button type="button" className="d5o-outline" onClick={refreshSource}>Start new revision</button></div> : null}
        {(reviewFocus === "commercial" || reviewFocus === "delivery") && definition.status === "In review" ? <div className={styles.sourceAlert}><strong>{reviewFocus === "commercial" ? "Commercial" : "Delivery"} review · revision {definition.revision}</strong><span>Review this exact definition revision and record the decision basis in Risks &amp; handoff. Current role state: {definition.reviews?.[reviewFocus] ?? "Unavailable"}.</span></div> : null}
        {definition.status === "In review" && !reviewFocus ? <button type="button" className="d5o-outline" onClick={onReviewQueued}>Open Commercial and Delivery queues in My Work →</button> : null}
        <div className={styles.content} ref={editorRef}>
          {section === "brief" ? <div className={styles.brief}>
            <div className={styles.intro}><p className={styles.kicker}>PROJECT BRIEF · CURRENT REVISION</p><h3>Build a baseline Develop can use</h3><p>Gather customer facts, define the promise, establish a delivery basis, then send an exact approved revision to Develop.</p></div>
            <div className={styles.briefContext}><div><small>CUSTOMER NEED · DISCOVER</small><strong>{selected.discovery?.need || "Customer need not recorded"}</strong><span>{selected.discovery?.pursuitControl?.handoff?.status === "accepted" ? "Accepted Discover handoff" : "Legacy or provisional Discover source"}</span></div><div><small>PROJECT CONTACT / SITE</small><strong>{definition.project?.customerContact || "Contact to confirm"}</strong><span>{definition.project?.siteArea || selected.site}</span></div><div><small>CONTROLLED RESULT</small><strong>{definition.outcome || "Outcome to define"}</strong><span>{definition.status} · revision {definition.revision}</span></div></div>
            <div className={styles.briefSteps}>{([
              ["01", "Investigate the site", `${definition.findings?.filter((item) => item.status === "Confirmed").length ?? 0} confirmed findings · ${openQuestions} open questions`, "investigation"],
              ["02", "Set scope and acceptance", `${scopeItems} ${scopeItems === 1 ? "deliverable" : "deliverables"} · ${acceptanceItems} ${acceptanceItems === 1 ? "acceptance criterion" : "acceptance criteria"}`, "scope"],
              ["03", "Set the delivery basis", `${definition.registers?.milestones?.length ?? 0} ${(definition.registers?.milestones?.length ?? 0) === 1 ? "milestone" : "milestones"} · ${definition.registers?.dependencies?.length ?? 0} ${(definition.registers?.dependencies?.length ?? 0) === 1 ? "dependency" : "dependencies"}`, "delivery"],
              ["04", "Review risks and conditions", `${definition.registers?.risks?.length ?? 0} ${(definition.registers?.risks?.length ?? 0) === 1 ? "risk" : "risks"} · ${missing.length} configured requirements open`, "risks"],
              ["05", "Approve and hand off", definition.developHandoff?.status === "accepted" ? "Develop accepted this revision" : `${definition.status} · Develop receipt pending`, "risks"],
            ] as const).map(([number, title, detail, target]) => <button type="button" className={styles.briefStep} key={number} onClick={() => openSection(target)}><b>{number}</b><span><strong>{title}</strong><small>{detail}</small></span><span aria-hidden="true">Open →</span></button>)}</div>
            {commercialRequired ? <p className={styles.baselineBlocker}>This Work Record is pinned to an older configuration requiring approved pricing before Define review. The dependency is shown in Commercial dependency; it has not been silently changed.</p> : null}
          </div> : null}
          {section === "risks" && definition.status === "Approved" ? <section className={styles.handoffPanel} aria-label="Develop receiving handoff">
            <p className={styles.kicker}>DEVELOP RECEIPT · REVISION {definition.revision}</p><h3>Hand the approved project definition to Develop</h3>
            <p>Develop receives this exact scope and acceptance revision on the same Work Record. It does not receive pricing, offer or award approval.</p>
            {definition.developHandoff ? <div className={styles.handoffStatus}><strong>{definition.developHandoff.status.toUpperCase()}</strong><span>{definition.developHandoff.receiver} · revision {definition.developHandoff.revision}</span><small>{definition.developHandoff.note}</small></div> : null}
            {!definition.developHandoff && !investigationReady ? <p className={styles.investigationEmpty}>This earlier baseline lacks complete customer and site context, a confirmed sourced finding, or resolved clarifications. Start a new revision to complete that investigation before handoff.</p> : null}
            {!definition.developHandoff && investigationReady ? <button type="button" className="d5o-primary" disabled={sourceChanged} onClick={submitDevelopHandoff}>Send approved revision to Develop</button> : null}
            {definition.developHandoff?.status === "submitted" ? <div className={styles.handoffActions}><label className={styles.field}>Receiving decision basis<textarea rows={2} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Why can Develop accept this basis, or what must be corrected?" /></label><div><button type="button" className="d5o-outline" disabled={!reviewNote.trim() || sourceChanged} onClick={() => respondDevelopHandoff("returned")}>Return for correction</button><button type="button" className="d5o-primary" disabled={!reviewNote.trim() || sourceChanged} onClick={() => respondDevelopHandoff("accepted")}>Accept into Develop</button></div><small>The receiving actor and exact revision are recorded by the server. Synthetic roles remain prototype memberships.</small></div> : null}
            {definition.developHandoff?.status === "accepted" ? <button type="button" className="d5o-outline" onClick={() => onPhase(selected, "Develop")}>Open Develop on this Work Record →</button> : null}
            {definition.developHandoff?.status === "returned" ? <button type="button" className="d5o-outline" onClick={startReturnedRevision}>Start corrected revision</button> : null}
          </section> : null}
          {section === "investigation" ? <DefineInvestigation key={`${selected.id}:${definition.revision}`} definition={definition} contacts={selected.discovery?.crm?.contacts ?? []} actor={actorLabel} locked={locked}
            onProjectSave={(project) => saveInvestigation({ project })}
            onFinding={(finding) => saveInvestigation({ findings: [...(definition.findings ?? []), finding] })}
            onClarification={(clarification) => saveInvestigation({ clarifications: [...(definition.clarifications ?? []), clarification] })}
            onAnswer={(id, answer, source) => saveInvestigation({ clarifications: (definition.clarifications ?? []).map((item) => item.id === id ? { ...item, answer, source, status: "Answered" as const, answeredAt: now() } : item) })}
            onEvidence={() => onControl(selected, "Evidence")} /> : null}
          {section === "scope" ? <><div className={styles.intro}><p className={styles.kicker}>SCOPE & ACCEPTANCE</p><h3>Trace the customer need through to acceptance</h3><p>Capture requirements first. Link every deliverable to one, then link an acceptance measure to every deliverable.</p></div><div className={styles.carry}><strong>Customer need from Discover</strong><p>{selected.discovery?.need || "No customer need recorded."}</p><small>Source: {selected.discovery?.source ?? "Not recorded"}</small></div>{field("Outcome to deliver", "outcome", "The customer result this work must produce.")}<DefineScopeControls area="scope" control={definition.scopeControl} locked={locked} onChange={saveScopeControl} />{register("scope_items")}{register("acceptance_criteria")}{field("Excluded scope", "excludedScope", "Explicit boundaries and customer responsibilities.")}</> : null}
          {section === "delivery" ? <><div className={styles.intro}><p className={styles.kicker}>DELIVERY BASIS</p><h3>Own the interfaces and assumptions</h3><p>Record responsibilities, preliminary range, dated milestones and dependencies. Detailed estimating and package release remain in later phases.</p></div>{field("Delivery approach", "deliveryApproach", "Approach, likely packages and verification basis.")}{register("milestones")}{register("dependencies")}<DefineScopeControls area="delivery" control={definition.scopeControl} locked={locked} onChange={saveScopeControl} /></> : null}
          {section === "commercial" ? <><div className={styles.intro}><p className={styles.kicker}>PINNED COMMERCIAL DEPENDENCY</p><h3>Review the governing rule</h3><p>The current pinned phase configuration requires approved pricing before Define review. Pricing and offers are worked in Develop; this older rule has not been silently changed.</p></div><div className={styles.carry}><strong>Commercial status on this Work Record</strong><div className={styles.carryFacts}><span>Estimate revision <b>{selected.discovery?.estimate.revision ?? 0}</b></span><span>Price <b>{selected.discovery?.estimate.sellPrice ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(selected.discovery.estimate.sellPrice) : "Unpriced"}</b></span><span>Pricing <b>{selected.discovery?.estimate.status ?? "Not started"}</b></span><span>Proposal revision <b>{selected.discovery?.proposal.package?.revision ?? "Not prepared"}</b></span><span>Proposal <b>{selected.discovery?.proposal.status ?? "Not started"}</b></span></div><small>{selected.discovery?.estimate.status === "Approved" ? "This pinned rule is satisfied by the approved estimate revision." : "This pinned configuration still blocks Define review until the estimate revision is approved. A new published configuration is needed to remove the backward dependency for future work."}</small><button type="button" className="d5o-outline" onClick={() => onPhase(selected, "Develop")}>Open commercial work in Develop →</button></div><div className={styles.carry}><strong>Recorded offer terms</strong><p>{selected.discovery?.proposal.package?.commercialTerms || "No proposal terms have been recorded."}</p><small>Offer terms are displayed from their saved revision; editing them here would create a conflicting source.</small></div></> : null}
                    {section === "risks" ? <><div className={styles.intro}><p className={styles.kicker}>REVIEW & HANDOFF</p><h3>Resolve blockers, then approve this exact revision</h3><p>Record each risk with an owner and control. Develop must accept the approved handoff.</p></div>{register("risks")}<div className={styles.verdict}><header><div><p className={styles.kicker}>EXPLAINABLE DEFINE ASSESSMENT</p><h3>{earlierApproval ? "Earlier approved basis" : verdict?.status ?? "Unavailable"}</h3><small>{verdict?.policy ?? "No pinned policy"} · {earlierApproval ? "This revision predates clarity v1; start a new revision to reassess." : "Advisory; approval remains a separate role decision."}</small></div><b>{verdict?.checks.filter((item) => item.met).length ?? 0}/{verdict?.checks.length ?? 0} checks</b></header><div className={styles.verdictChecks}>{verdict?.checks.filter((item) => !item.met).map((item) => <button type="button" key={item.key} className={item.met ? styles.checkMet : styles.checkOpen} onClick={() => openSection(item.area)}><strong>{item.met ? "✓" : "!"} {item.label}</strong><small>{item.detail}</small></button>)}</div>{verdict?.checks.some((item) => item.met) ? <details className={styles.passedChecks}><summary>{verdict.checks.filter((item) => item.met).length} satisfied checks</summary><ul>{verdict.checks.filter((item) => item.met).map((item) => <li key={item.key}>{item.label}</li>)}</ul></details> : null}<p>What changes this assessment? Resolve each open check, then request review of this revision. A source reference is not proof of uploaded or verified evidence.</p></div><div className={styles.review}><div><p className={styles.kicker}>DEFINITION REVIEW</p><h3>{definition.status === "Approved" ? "Definition baseline approved" : definition.status === "In review" ? "Role decisions required" : "Prepare for role review"}</h3><p>Approval confirms the scope and delivery basis. Offer, award and delivery decisions remain separate.</p></div>{!config ? <div className={styles.missing}><strong>Compatible configuration unavailable</strong><p>Review cannot proceed for this Work Type.</p></div> : missing.length ? <div className={styles.missing}><strong>{missing.length} configured requirements remain</strong><ul>{missing.map((item) => <li key={item.key}>{item.message}</li>)}</ul></div> : <p className={styles.ready}>Configured review requirements are complete.</p>}{!investigationReady ? <div className={styles.missing}><strong>Investigation is incomplete</strong><p>Record the customer contact and site area, a confirmed sourced finding, and answers to all open questions.</p><button type="button" className="d5o-outline" onClick={() => openSection("investigation")}>Open investigation →</button></div> : null}{sourceChanged ? <div className={styles.missing}><strong>Review source changed</strong><p>This review refers to an earlier source or configuration version. Start a new definition revision to use the current source.</p><button className="d5o-outline" onClick={refreshSource}>Start new revision</button></div> : null}{definition.status === "Draft" ? <button className="d5o-primary" disabled={!config || verdict?.status !== "Ready for review" || sourceChanged} onClick={submit}>Request Commercial and Delivery review</button> : null}{definition.status === "Changes requested" ? <button className="d5o-outline" onClick={startReturnedRevision}>Start corrected revision {definition.revision + 1}</button> : null}{definition.status === "In review" && definition.reviews ? <div className={styles.roles}>{(["commercial", "delivery"] as const).map((role) => <div key={role}><strong>{role === "commercial" ? "Commercial role queue" : "Delivery role queue"}</strong><span>{definition.reviews?.[role]}</span>{definition.reviews?.[role] === "Pending" ? <div className={styles.roleActions}><button className="d5o-outline" disabled={!reviewNote.trim() || sourceChanged || missing.length > 0 || !config} onClick={() => decide(role, "Changes requested")}>Request changes</button><button className="d5o-primary" disabled={!reviewNote.trim() || sourceChanged || verdict?.status !== "Ready for review" || !config} onClick={() => decide(role, "Approved")}>Approve revision {definition.revision}</button></div> : null}</div>)}<label className={styles.field}><span>Decision basis</span><textarea rows={2} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Reason, condition or requested change" /></label><small>The server records the authenticated reviewer and exact revision. A specialist must be independent from the submitter.</small></div> : null}{definition.status === "Approved" ? <p className={styles.ready}>Commercial and Delivery reviews are recorded. Next: {commercialRequired ? "authorization and readiness review" : "Develop solution, estimate and offer"} on this Work Record.</p> : null}</div></> : null}
        </div>
        {editingField && !(["includedScope", "acceptance", "milestones", "dependencies", "risks"] as string[]).includes(editingField) ? <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingField(null); }}><aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={editableFields[editingField] ?? "Definition field"}><header><div><p className={styles.kicker}>DEFINE · REVISION {definition.revision}</p><h3>{editableFields[editingField] ?? "Definition field"}</h3></div><button type="button" className="d5o-outline" onClick={() => setEditingField(null)} aria-label="Close drawer">×</button></header><form className={styles.drawerForm} onSubmit={(event) => { event.preventDefault(); saveField(editingField, fieldDraft.trim()); setEditingField(null); }}><label>{editableFields[editingField]}<textarea rows={8} value={fieldDraft} disabled={locked} onChange={(event) => setFieldDraft(event.target.value)} /></label><footer><button type="button" className="d5o-outline" onClick={() => setEditingField(null)}>Close</button>{!locked ? <button type="submit" className="d5o-primary">Save to revision</button> : null}</footer></form></aside></div> : null}
        <details className={styles.history}><summary>Definition revision history · {definition.history.length} events</summary>{definition.approvedBaselines?.length ? <div><strong>Approved scope snapshots</strong><ol>{definition.approvedBaselines.slice().reverse().map((baseline) => <li key={`${baseline.revision}-${baseline.approvedAt}`}><strong>Revision {baseline.revision} · {baseline.configurationVersion}</strong><span>{baseline.outcome}</span><small>{baseline.registers.scope_items?.length ?? 0} scope items · {baseline.registers.acceptance_criteria?.length ?? 0} acceptance criteria · approved {new Date(baseline.approvedAt).toLocaleString()}</small></li>)}</ol></div> : null}{definition.history.length ? <ol>{definition.history.slice().reverse().map((item, index) => <li key={`${item.at}-${index}`}><strong>Revision {item.revision} · {item.event}</strong><span>{item.note}</span><small>{new Date(item.at).toLocaleString()}</small></li>)}</ol> : <p>No review events yet.</p>}</details>
      </section> : <section className={styles.emptyDetail}><h2>Select work to define</h2><p>Qualified pursuits appear here on the same Work Record.</p></section>}
    </div>
  </main>;
}
