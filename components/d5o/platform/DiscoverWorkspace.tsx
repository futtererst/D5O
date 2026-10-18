"use client";
import { FocusedTaskFrame } from "./FocusedTaskFrame";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { DiscoveryRecord, ProposalPackage, WorkRecord, WorkspaceKey } from "./work-types";
import { assessCommercialAuthority, type CommercialAuthorityProfile } from "./commercial-authority";
import styles from "./DiscoverWorkspace.module.css";
import { ConfiguredPhasePanel } from "./ConfiguredPhasePanel";
import type { ConfigurationInventory } from "@/lib/d5o/configuration/version-inventory";
import { activePhaseConfigurationVersion, phaseContractFromManifest, resolvePublishedPhaseConfiguration } from "./published-phase-configuration";
import { verifyActiveConfigurationPin } from "@/app/work/configuration-actions";
import { WorkPhaseJourney, type WorkPhase, type WorkControl } from "./WorkPhaseJourney";
import { PursuitControl } from "./PursuitControl";
import { DiscoverCRMWorkspace } from "./DiscoverCRMWorkspace";
import { DevelopPlanning } from "./DevelopPlanning";
import { RomDesignPanel } from "./RomDesignPanel";
import { DesignSpendControl } from "./DesignSpendControl";
import { PricingPolicyAdmin } from "./PricingPolicyAdmin";
import { DevelopPipeline } from "./DevelopPipeline";
import { FieldChangeControl } from "./FieldChangeControl";
import { currentAcceptedRelease } from "./deploy-model";
import { formatMinor } from "./develop-pricing";
import { romScenarioPrices } from "./rom-model";
import { blankPursuit, type PursuitCommand } from "./pursuit-control";
import type { CommercialCommand } from "@/lib/d5o/prototype-work/commercial-command";

type Phase = DiscoveryRecord["phase"];
const phases: Phase[] = ["Qualification", "Estimate", "Pricing review", "Proposal", "Submitted", "Validation", "Clarification", "Outcome"];
const money = (value: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: currency === "JPY" ? 0 : 2 }).format(value);
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateLabel = (value: string) => value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value.slice(0, 10)}T12:00:00`)) : "No date set";
const elapsedDays = (value: string) => {
  const start = new Date(value);
  if (Number.isNaN(start.getTime())) return null;
  const today = new Date();
  return Math.max(0, Math.floor((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()) / 86_400_000));
};
const proposalDiff = (baseline: ProposalPackage | undefined, current: ProposalPackage | undefined) => {
  if (!baseline || !current) return [];
  return [
    { label: "Scope", before: baseline.scope, after: current.scope },
    { label: "Assumptions", before: baseline.assumptions || "None recorded", after: current.assumptions || "None recorded" },
    { label: "Exclusions", before: baseline.exclusions || "None recorded", after: current.exclusions || "None recorded" },
    { label: "Offer value", before: money(baseline.sellPrice), after: money(current.sellPrice) },
    { label: "Commercial terms", before: baseline.commercialTerms, after: current.commercialTerms },
  ].filter((change) => change.before !== change.after);
};
const newDiscovery = (): DiscoveryRecord => ({
  source: "Direct customer", need: "", procurement: "Direct award", phase: "Qualification", fit: "Unassessed", closeDate: "",
  estimate: { revision: 0, labor: 0, materials: 0, subcontract: 0, travel: 0, contingency: 0, targetMargin: 25, sellPrice: 0, status: "Not started", assumption: "" },
  proposal: { status: "Not started", dueDate: "", method: "Customer portal", recipient: "", response: "" },
});

export function DiscoverWorkspace({ mode = "discover", workspaceKey, workspaceName, configurationInventory, work, commercialProfiles, actor, actorId, actorRole, canEdit, hosted = false, focusRecordId, reviewFocus, onOpen, onDefine, onOpenDevelopControls, onPhase, onControl, onBack, onSelect, onPricingQueued, onProposalQueued, onCommercialCommand, onPursuitCommand, onUpdate, onCreate, onNotice, onPolicyUpdated, onPeople }: {
  mode?: "discover" | "develop";
  workspaceKey: WorkspaceKey;
  workspaceName: string;
  configurationInventory: ConfigurationInventory;
  work: WorkRecord[];
  commercialProfiles: CommercialAuthorityProfile[];
  actor: string; actorId?: string; actorRole?: string; canEdit: boolean;
  hosted?: boolean;
  focusRecordId?: string;
  reviewFocus?: "pricing" | "proposal" | "solution-prep" | "solution-review" | "pricing-prep" | "proposal-prep" | "customer-submission-prep" | "rom-budget-ack" | "rom-design-authorization" | "design-spend-authority-prep" | "design-spend-authority-review" | "design-spend-commitment-prep" | "design-spend-commitment-review" | "design-handoff-receive" | "design-handoff-correction" | "pursuit-prep" | "pursuit-review" | "define-handoff-prep" | "define-handoff-receive" | null;
  onOpen: (record: WorkRecord) => void;
  onDefine: (record: WorkRecord) => void;
  onOpenDevelopControls?: (record: WorkRecord) => void;
  onPhase: (record: WorkRecord, phase: WorkPhase) => void;
  onControl: (record: WorkRecord, control: WorkControl) => void;
  onBack: () => void;
  onSelect: (id: string) => void;
  onPricingQueued: () => void;
  onProposalQueued: () => void;
  onCommercialCommand: (command: Omit<CommercialCommand, "expectedRevision">) => Promise<boolean>;
  onPursuitCommand?: (workId: string, command: PursuitCommand) => Promise<boolean>;
  onUpdate: (id: string, transform: (current: WorkRecord) => WorkRecord) => void;
  onCreate: (record: WorkRecord) => Promise<string>;
  onNotice: (message: string) => void;
  onPolicyUpdated?: () => Promise<void>;
  onPeople?: () => void;
}) {
  const isDevelop = mode === "develop";
  const [captureType, setCaptureType] = useState(workspaceKey === "rybex" ? "Technical delivery" : "Modernization service");
  const [filter, setFilter] = useState<Phase | "All active">("All active");
  const [drawer, setDrawer] = useState<"capture" | "outcome" | "response" | null>(null);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [proposalDecisionNote, setProposalDecisionNote] = useState("");
  const [handoffDecisionNote, setHandoffDecisionNote] = useState("");
  const [pricingDueDate, setPricingDueDate] = useState("");
  const [proposalReviewDueDate, setProposalReviewDueDate] = useState("");
  const [estimateDirty, setEstimateDirty] = useState(false);
  const [policyVersionSignal, setPolicyVersionSignal] = useState(0);
  const [commercialBusy, setCommercialBusy] = useState(false);
  const [submissionDraft, setSubmissionDraft] = useState<{ key: string; recipient: string; method: string; dueDate: string } | null>(null);
  const pricingCard = useRef<HTMLElement>(null);
  const proposalCard = useRef<HTMLElement>(null);
  const pursuits = useMemo(() => work.filter((item) => item.discovery && (!isDevelop || !item.discovery.pursuitControl || item.definition?.status === "Approved")), [work, isDevelop]);
  const active = pursuits.filter((item) => item.discovery?.phase !== "Outcome" && !["held", "declined"].includes(item.discovery?.pursuitControl?.status ?? ""));
  const filtered = useMemo(() => pursuits.filter((item) => (filter === "All active" ? item.discovery?.phase !== "Outcome" : item.discovery?.phase === filter) && `${item.title} ${item.customer} ${item.site}`.toLowerCase().includes(search.toLowerCase())), [pursuits, filter, search]);
  const awaitingIntake = !isDevelop ? work.find((item) => item.id === focusRecordId && !item.discovery) : undefined;
  const selected = awaitingIntake ?? pursuits.find((item) => item.id === focusRecordId);
  const selectedOutsideDevelop = isDevelop && !selected ? work.find((item) => item.id === focusRecordId) : undefined;
  const phaseRecord = selected ?? selectedOutsideDevelop;
  useEffect(() => {
    if (reviewFocus !== "pricing" && reviewFocus !== "proposal") return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      (reviewFocus === "pricing" ? pricingCard : proposalCard).current?.scrollIntoView({ block: "start" });
    }));
    return () => cancelAnimationFrame(frame);
  }, [reviewFocus, focusRecordId]);
  function selectVisible(nextFilter: Phase | "All active", nextSearch: string) {
    const matches = pursuits.filter((item) => (nextFilter === "All active" ? item.discovery?.phase !== "Outcome" : item.discovery?.phase === nextFilter) && `${item.title} ${item.customer} ${item.site}`.toLowerCase().includes(nextSearch.toLowerCase()));
    if (matches.length && !matches.some((item) => item.id === focusRecordId)) onSelect(matches[0].id);
  }
  const phaseConfig = selected ? resolvePublishedPhaseConfiguration(configurationInventory, workspaceKey, selected.type, selected) : null;
  const captureConfig = resolvePublishedPhaseConfiguration(configurationInventory, workspaceKey, awaitingIntake?.type ?? captureType, awaitingIntake);
  const activeVersion = configurationInventory.versions.find((item) => item.id === configurationInventory.activeVersionId);
  const availableTypes = phaseContractFromManifest(activeVersion?.config_manifest_json, workspaceKey)?.workTypes.map((item) => item.workTypeLabel) ?? [];
  const captureComponent = (key: string) => captureConfig?.phases.find((phase) => phase.key === "discover")?.components.find((item) => item.key === key);
  const captureField = (componentKey: string, fieldKey: string) => captureComponent(componentKey)?.fields?.find((item) => item.key === fieldKey);
  const sourceOptions = captureField("demand_source", "source")?.options ?? ["Direct customer", "Existing customer", "Partner referral", "Formal tender", "Service renewal"];
  const procurementOptions = captureField("demand_source", "procurement")?.options ?? ["Direct award", "Competitive bid", "Framework / call-off", "Paid pilot", "Renewal"];
  const fitField = phaseConfig?.phases.find((phase) => phase.key === "discover")?.components.find((item) => item.key === "qualification")?.fields?.find((field) => field.key === "fit");
  const discovery = selected?.discovery;
  const submissionKey = `${selected?.id ?? ""}:${discovery?.proposal.package?.revision ?? 0}:${discovery?.proposal.status ?? ""}`;
  const submissionForm = submissionDraft?.key === submissionKey ? submissionDraft : { key: submissionKey, recipient: discovery?.proposal.recipient ?? "", method: discovery?.proposal.method ?? "Customer portal", dueDate: discovery?.proposal.dueDate ?? "" };
  const estimate = discovery?.estimate;
  const proposal = discovery?.proposal;
  const controlledCommercial = Boolean(discovery?.pursuitControl);
  const definitionSource = controlledCommercial && selected?.definition?.status === "Approved"
    && selected.definition.developHandoff?.status === "accepted"
    && selected.definition.developHandoff.revision === selected.definition.revision
    && selected.phaseConfigurationVersionId && selected.definition.configurationWorkTypeKey
    && selected.definition.configurationVersion === phaseConfig?.version
    ? { revision: selected.definition.revision, configurationVersionId: selected.phaseConfigurationVersionId,
        workTypeKey: selected.definition.configurationWorkTypeKey } : null;
  const estimateSourceCurrent = !controlledCommercial || Boolean(definitionSource && estimate?.definitionSource
    && estimate.definitionSource.revision === definitionSource.revision
    && estimate.definitionSource.configurationVersionId === definitionSource.configurationVersionId
    && estimate.definitionSource.workTypeKey === definitionSource.workTypeKey);
  const approvedCustomerScope = controlledCommercial && selected?.definition
    ? [selected.definition.outcome, ...(selected.definition.registers?.scope_items ?? []).map((row) =>
        [row.deliverable, row.boundary].filter(Boolean).join(" — "))].filter(Boolean).join("\n\n")
    : discovery?.need ?? "";
  const romCommunication = estimate?.detailed?.input.estimateMaturity === "ROM" ? estimate.detailed.input.romBasis?.communication : undefined;
  const romRange = romCommunication && estimate?.detailed ? romScenarioPrices(estimate.detailed.policySnapshot, estimate.detailed.input) : null;
  const lastSubmission = proposal?.submissionHistory?.[proposal.submissionHistory.length - 1] ?? proposal?.submission;
  const lastSubmittedPackage = lastSubmission?.packageSnapshot ?? proposal?.packageHistory?.find((entry) => entry.revision === lastSubmission?.revision) ?? (proposal?.package?.revision === lastSubmission?.revision ? proposal?.package : undefined);
  const changesFromSubmitted = proposalDiff(lastSubmittedPackage, proposal?.package);
  const latestProposalResponse = proposal?.responseEvents?.[proposal.responseEvents.length - 1];
  const submissionHistory = proposal?.submissionHistory ?? (proposal?.submission ? [proposal.submission] : []);
  const totalCost = estimate ? estimate.labor + estimate.materials + estimate.subcontract + estimate.travel + estimate.contingency : 0;
  const commercialAuthority = assessCommercialAuthority(commercialProfiles, proposal?.package, lastSubmittedPackage, totalCost);
  const pricingCount = active.filter((item) => item.discovery?.estimate.status === "Pricing review").length;
  const bidPursuits = pursuits.filter((item) => item.discovery?.proposal.submission && !item.discovery.outcome);
  const awaitingCustomerCount = bidPursuits.filter((item) => item.discovery?.phase !== "Outcome" && item.discovery?.proposal.submission && !(item.discovery?.proposal.responseEvents?.length)).length;
  const overdueResponseCount = bidPursuits.filter((item) => {
    const data = item.discovery!;
    return data.phase !== "Outcome" && Boolean(data.proposal.submission && !data.proposal.responseEvents?.length && data.proposal.submission.responseDueDate && data.proposal.submission.responseDueDate < dateKey(new Date()));
  }).length;
  const overdueFollowUpCount = bidPursuits.filter((item) => {
    const data = item.discovery!;
    const latest = data.proposal.responseEvents?.[data.proposal.responseEvents.length - 1];
    return data.phase !== "Outcome" && Boolean(latest?.followUpDue && latest.followUpDue < dateKey(new Date()));
  }).length;
  const negotiationCount = bidPursuits.filter((item) => item.discovery?.proposal.responseEvents?.[item.discovery.proposal.responseEvents.length - 1]?.status === "Commercial negotiation").length;
  const submittedCurrencies = [...new Set(bidPursuits.map((item) => item.discovery?.proposal.submission?.packageSnapshot?.pricingBasis?.currency ?? "USD"))];
  const submittedValue = submittedCurrencies.length <= 1 ? bidPursuits.reduce((sum, item) => sum + (item.discovery?.proposal.submission ? item.discovery.proposal.submission.packageSnapshot?.sellPrice ?? item.discovery.proposal.packageHistory?.find((entry) => entry.revision === item.discovery?.proposal.submission?.revision)?.sellPrice ?? 0 : 0), 0) : null;
  const submittedValueLabel = submittedValue === null ? "Mixed currencies" : money(submittedValue, submittedCurrencies[0] ?? "USD");
  const sortedBids = bidPursuits.slice().sort((a, b) => {
    const dueFor = (item: WorkRecord) => {
      const data = item.discovery!;
      const latest = data.proposal.responseEvents?.[data.proposal.responseEvents.length - 1];
      return latest?.followUpDue || data.proposal.submission?.responseDueDate || data.proposal.dueDate || item.nextActionDue || "9999-12-31";
    };
    return dueFor(a).localeCompare(dueFor(b));
  });

  function updateDiscovery(id: string, transform: (item: WorkRecord, current: DiscoveryRecord) => WorkRecord) {
    onUpdate(id, (current) => current.discovery ? transform(current, current.discovery) : current);
  }
  async function capture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) { onNotice("Sign in with workspace editing authority and load shared Work before capturing an intake."); return; }
    const form = new FormData(event.currentTarget);
    const title = awaitingIntake?.title ?? String(form.get("title") ?? "").trim();
    const customer = awaitingIntake?.customer ?? String(form.get("customer") ?? "").trim();
    if (!title || !customer) return;
    const discovery = newDiscovery();
    discovery.pursuitControl = blankPursuit();
    discovery.source = String(form.get("source") ?? discovery.source);
    discovery.need = String(form.get("need") ?? "").trim();
    discovery.procurement = String(form.get("procurement") ?? discovery.procurement);
    discovery.closeDate = String(form.get("closeDate") ?? "");
    const type = awaitingIntake?.type ?? String(form.get("type") ?? "Technical delivery");
    const phaseConfigurationVersionId = awaitingIntake?.phaseConfigurationVersionId ?? activePhaseConfigurationVersion(configurationInventory, workspaceKey, type);
    if (!phaseConfigurationVersionId) { onNotice("A published phase contract for this Work Type is required before capturing new work."); return; }
    if (!captureConfig || captureConfig.version !== phaseConfigurationVersionId) { onNotice("The pinned configuration is unavailable. This Work Record cannot start Discover intake."); return; }
    if (!awaitingIntake) {
      const currentPin = await verifyActiveConfigurationPin(configurationInventory.workspaceId, phaseConfigurationVersionId);
      if (!currentPin.ok) { onNotice("The published configuration changed while this form was open. Refresh the workspace before capturing new work."); return; }
    }
    if (awaitingIntake) {
      onUpdate(awaitingIntake.id, (current) => {
        if (current.discovery || current.phaseConfigurationVersionId !== phaseConfigurationVersionId) return current;
        return { ...current, nextAction: "Qualify customer need", nextActionDue: discovery.closeDate || null,
          nextActionImpact: "High", discovery,
          history: [`${new Date().toLocaleString()} · Discover intake started on existing Work Record from ${discovery.source}`, ...current.history] };
      });
      setFilter("All active"); setSearch(""); setDrawer(null);
      onNotice("Discover intake added to the same Work Record. Save and submit the intake for a pursuit decision.");
      return;
    }
    const id = `${workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-discover-${crypto.randomUUID()}`;
    const record: WorkRecord = {
      id, workspace: workspaceKey, title, type, customer, phaseConfigurationVersionId,
      site: String(form.get("site") ?? "To be confirmed"), stage: "Intake & Shape", owner: String(form.get("owner") ?? "Unassigned"),
      nextAction: "Qualify customer need", nextActionDue: discovery.closeDate || null, nextActionImpact: "High", progress: 5,
      value: "Unpriced", status: "moving", proof: [], blockers: [], history: [`${new Date().toLocaleString()} · Pursuit captured from ${discovery.source}`], discovery,
    };
    try {
      const createdId = await onCreate(record);
      onSelect(createdId); setFilter("All active"); setSearch(""); setDrawer(null);
      onNotice("Opportunity captured on one shared Work Record. Complete qualification before requesting a pursuit decision.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "The opportunity could not be captured."); }
  }
  function saveEstimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !discovery || !estimate) return;
    if (estimate.detailed || controlledCommercial && estimate.revision === 0) { onNotice("Use the detailed estimator for new Develop pricing. Existing manual estimates remain explicitly legacy."); return; }
    if (controlledCommercial && !definitionSource) { onNotice("Develop requires an approved Define revision and an accepted receipt for that exact revision and configuration before saving an estimate."); return; }
    const form = new FormData(event.currentTarget);
    const labor = Number(form.get("labor") || 0), materials = Number(form.get("materials") || 0), subcontract = Number(form.get("subcontract") || 0), travel = Number(form.get("travel") || 0), contingency = Number(form.get("contingency") || 0), margin = Number(form.get("margin") || 0);
    const cost = labor + materials + subcontract + travel + contingency;
    if (margin < 0 || margin >= 100) { onNotice("Target margin must be from 0% to less than 100%."); return; }
    const sellPrice = margin >= 100 ? 0 : Math.round(cost / (1 - margin / 100));
    const revision = estimate.revision + 1;
    updateDiscovery(selected.id, (current, data) => ({ ...current, value: money(sellPrice), commercial: { condition: data.procurement, amount: money(sellPrice), confidence: data.fit === "Qualified" ? "Under review" : "Indicative" }, discovery: { ...data, phase: "Estimate", estimate: { revision, labor, materials, subcontract, travel, contingency, targetMargin: margin, sellPrice, status: "Draft", assumption: String(form.get("assumption") ?? ""), definitionSource: definitionSource ? { ...definitionSource, capturedAt: new Date().toISOString() } : undefined, pricingHistory: data.estimate.pricingHistory ?? [] } }, history: [`${new Date().toLocaleString()} · Estimate revision ${revision} prepared · ${money(sellPrice)}${definitionSource ? ` · Define revision ${definitionSource.revision}` : ""}`, ...current.history] }));
    setEstimateDirty(false);
    onNotice(`Estimate revision ${revision} saved at ${money(sellPrice)}. Pricing remains unapproved until an authorized review.`);
  }
  function setEstimateStatus(status: "Pricing review" | "Approved" | "Changes requested") {
    if (!selected || !discovery || !estimate) return;
    if (status !== "Changes requested" && !estimateSourceCurrent) { onNotice("The estimate is not bound to the current approved Define revision. Return it for correction, then save a new estimate revision before pricing review or approval."); return; }
    if (estimateDirty) { onNotice("Save the estimate as a new revision before routing it for pricing review."); return; }
    if (status === "Pricing review" && !pricingDueDate) { onNotice("Set a decision due date so the pricing review has a clear service expectation."); return; }
    if (status !== "Pricing review" && !decisionNote.trim()) { onNotice("Add a decision basis before recording a pricing review outcome."); return; }
    if (status === "Pricing review" && (!estimate.sellPrice || estimate.status === "Pricing review" || estimate.status === "Approved")) return;
    if (status !== "Pricing review" && (estimate.status !== "Pricing review" || !estimate.review || estimate.review.revision !== estimate.revision)) { onNotice("This estimate revision is not awaiting pricing review."); return; }
    if (controlledCommercial) {
      if (commercialBusy) return;
      setCommercialBusy(true);
      const action = status === "Pricing review" ? "submit-pricing" as const : status === "Approved" ? "approve-pricing" as const : "return-pricing" as const;
      void onCommercialCommand({ workId: selected.id, packageRevision: estimate.revision, action, dueDate: status === "Pricing review" ? pricingDueDate : undefined, note: status === "Pricing review" ? undefined : decisionNote.trim() })
        .then((saved) => { if (saved) setDecisionNote(""); })
        .finally(() => setCommercialBusy(false));
      return;
    }
    const now = new Date().toLocaleString();
    const pricingState = status === "Pricing review" ? "Submitted" : status;
    updateDiscovery(selected.id, (current, data) => ({ ...current, owner: status === "Pricing review" ? "Pricing authority · workspace role" : data.estimate.review?.submittedBy ?? current.owner, discovery: { ...data, phase: status === "Pricing review" ? "Pricing review" : status === "Approved" ? "Proposal" : "Estimate", estimate: { ...data.estimate, status, review: status === "Pricing review" ? { revision: data.estimate.revision, submittedAt: now, submittedBy: current.owner } : { ...data.estimate.review, revision: data.estimate.revision, submittedAt: data.estimate.review?.submittedAt ?? now, submittedBy: data.estimate.review?.submittedBy ?? current.owner, decidedAt: now, decisionNote: decisionNote.trim() }, pricingHistory: [...(data.estimate.pricingHistory ?? []), { revision: data.estimate.revision, state: pricingState, at: now, note: decisionNote.trim(), cost: data.estimate.labor + data.estimate.materials + data.estimate.subcontract + data.estimate.travel + data.estimate.contingency, sellPrice: data.estimate.sellPrice, targetMargin: data.estimate.targetMargin }] } }, nextAction: status === "Pricing review" ? `Review estimate revision ${data.estimate.revision}` : status === "Approved" ? "Prepare customer proposal" : "Revise estimate and resubmit", history: [`${now} · Pricing ${status.toLowerCase()} · Revision ${data.estimate.revision}${decisionNote.trim() ? ` · ${decisionNote.trim()}` : ""}`, ...current.history] }));
    updateDiscovery(selected.id, (current, data) => ({ ...current, nextActionDue: status === "Pricing review" ? pricingDueDate : null, nextActionImpact: status === "Pricing review" ? "High" : current.nextActionImpact, discovery: status === "Pricing review" ? { ...data, estimate: { ...data.estimate, review: { ...data.estimate.review!, dueDate: pricingDueDate } } } : data }));
    setDecisionNote("");
    onNotice(status === "Approved" ? `Estimate revision ${estimate.revision} approved for proposal preparation.` : status === "Pricing review" ? `Estimate revision ${estimate.revision} routed to the pricing-authority queue.` : `Changes requested on estimate revision ${estimate.revision}. Revise and resubmit.`);
    if (status === "Pricing review") onPricingQueued();
  }
  function saveProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!estimateSourceCurrent) { onNotice("The approved Define basis changed. Save and approve a new estimate revision before preparing an offer."); return; }
    if (!selected || !discovery || !estimate || !proposal || estimate.status !== "Approved") { onNotice("An approved estimate revision is required before preparing the customer proposal."); return; }
    if (["Internal review", "Approved", "Submitted"].includes(proposal.status)) { onNotice("This proposal revision is locked. Resolve its current review or create a new approved estimate before preparing another offer."); return; }
    const form = new FormData(event.currentTarget);
    const revision = (proposal.package?.revision ?? 0) + 1;
    const proposalPackage = {
      revision, estimateRevision: estimate.revision, scope: String(form.get("scope") ?? "").trim(),
      assumptions: String(form.get("assumptions") ?? "").trim(), exclusions: String(form.get("exclusions") ?? "").trim(),
      commercialTerms: String(form.get("commercialTerms") ?? "").trim(), sellPrice: estimate.sellPrice, preparedAt: new Date().toISOString(),
      definitionSource: estimate.definitionSource,
      pricingBasis: estimate.detailed ? { policyId: estimate.detailed.evaluation.policyId, policyVersion: estimate.detailed.evaluation.policyVersion, solutionRevision: estimate.detailed.input.solutionRevision, currency: estimate.detailed.input.currency, includedCostMinor: estimate.detailed.evaluation.includedCostMinor, priceMinor: estimate.detailed.evaluation.proposedPriceMinor } : undefined,
      changeReason: String(form.get("changeReason") ?? "").trim() || undefined,
    };
    if (!proposalPackage.scope || !proposalPackage.commercialTerms) { onNotice("Add the customer scope and commercial terms before saving the proposal package."); return; }
    if (revision > 1 && !proposalPackage.changeReason) { onNotice("Record why this offer revision changed before saving it for review."); return; }
    if (selected.canonicalWorkId && controlledCommercial && proposal.status === "Changes requested") {
      if (commercialBusy) return;
      setCommercialBusy(true);
      void onCommercialCommand({ workId: selected.id, packageRevision: revision,
        action: "save-proposal-revision", offerInput: {
          scope: proposalPackage.scope, assumptions: proposalPackage.assumptions,
          exclusions: proposalPackage.exclusions,
          commercialTerms: proposalPackage.commercialTerms,
          changeReason: proposalPackage.changeReason ?? ""
        } }).finally(() => setCommercialBusy(false));
      return;
    }
    updateDiscovery(selected.id, (current, data) => {
      const packageHistory = data.proposal.packageHistory ?? (data.proposal.package ? [data.proposal.package] : []);
      return { ...current, discovery: { ...data, phase: "Proposal", proposal: { ...data.proposal, status: "Draft", package: proposalPackage, packageHistory: [...packageHistory.filter((entry) => entry.revision !== revision), proposalPackage], review: undefined, history: [...(data.proposal.history ?? []), { revision, state: "Draft saved", at: new Date().toLocaleString(), note: `${proposalPackage.changeReason ? `${proposalPackage.changeReason} · ` : ""}Bound to approved estimate revision ${estimate.revision}` }] } }, nextAction: `Complete proposal revision ${revision}`, history: [`${new Date().toLocaleString()} · Proposal revision ${revision} saved against estimate revision ${estimate.revision}${proposalPackage.changeReason ? ` · ${proposalPackage.changeReason}` : ""}`, ...current.history] };
    });
    onNotice(`Proposal revision ${revision} saved from approved estimate revision ${estimate.revision}.`);
  }
  function startNegotiatedRevision() {
    if (!selected || !discovery || !proposal?.submission || !proposal.package || proposal.status !== "Submitted" || discovery.outcome) return;
    const latest = proposal.responseEvents?.[proposal.responseEvents.length - 1];
    if (!latest || latest.revision !== proposal.submission.revision || !["Commercial negotiation", "Clarification requested"].includes(latest.status)) { onNotice("Record a customer clarification or negotiation against the current submitted offer before preparing a revised proposal."); return; }
    if (controlledCommercial) {
      if (commercialBusy) return;
      setCommercialBusy(true);
      void onCommercialCommand({ workId: selected.id, packageRevision: proposal.package.revision, action: "start-negotiated-revision" }).finally(() => setCommercialBusy(false));
      return;
    }
    const now = new Date().toLocaleString();
    updateDiscovery(selected.id, (current, data) => ({ ...current, owner: current.owner, nextAction: `Prepare negotiated proposal revision ${(data.proposal.package?.revision ?? 0) + 1}`, nextActionDue: latest.followUpDue ?? current.nextActionDue, nextActionImpact: "High", discovery: { ...data, phase: "Proposal", proposal: { ...data.proposal, status: "Draft", history: [...(data.proposal.history ?? []), { revision: data.proposal.submission!.revision, state: "Negotiated revision started", at: now, note: `Customer ${latest.status.toLowerCase()}: ${latest.details}` }] } }, history: [`${now} · Negotiated proposal revision started from submitted revision ${data.proposal.submission!.revision}`, ...current.history] }));
    onNotice(`Proposal revision ${(proposal.package?.revision ?? 0) + 1} is open. The submitted offer remains in history; any price change must first pass estimate pricing review.`);
  }
  function proposalAction(status: "Internal review" | "Changes requested" | "Approved" | "Submitted") {
    if (!selected || !discovery || !estimate || !proposal) return;
    if (!estimateSourceCurrent) { onNotice("The estimate no longer matches the approved Define basis. Reconcile scope and price before changing the offer."); return; }
    const proposalPackage = proposal.package;
    if (controlledCommercial && status === "Submitted") {
      if (!proposalPackage || commercialBusy) return;
      setCommercialBusy(true);
      void onCommercialCommand({ workId: selected.id, packageRevision: proposalPackage.revision, action: "record-customer-submission", recipient: submissionForm.recipient.trim(), method: submissionForm.method, dueDate: submissionForm.dueDate }).finally(() => setCommercialBusy(false));
      return;
    }
    if (controlledCommercial && status !== "Submitted") {
      if (!proposalPackage || commercialBusy) return;
      setCommercialBusy(true);
      const action = status === "Internal review" ? "submit-proposal" as const : status === "Approved" ? "approve-proposal" as const : "return-proposal" as const;
      void onCommercialCommand({ workId: selected.id, packageRevision: proposalPackage.revision, action, dueDate: status === "Internal review" ? proposalReviewDueDate : undefined, note: status === "Internal review" ? undefined : proposalDecisionNote.trim() })
        .then((saved) => { if (saved) setProposalDecisionNote(""); })
        .finally(() => setCommercialBusy(false));
      return;
    }
    if (status === "Internal review") {
      if (estimate.status !== "Approved" || !proposalPackage || proposalPackage.estimateRevision !== estimate.revision) { onNotice("Save a proposal package against the currently approved estimate revision before requesting approval."); return; }
      if (!commercialAuthority.matchedProfile) { onNotice(commercialAuthority.reasons[0] ?? "No configured commercial authority profile covers this proposal."); return; }
      if (!proposalReviewDueDate) { onNotice("Set a due date for the proposal approval decision."); return; }
      const now = new Date().toLocaleString();
      const routingProfile = commercialAuthority.matchedProfile;
      updateDiscovery(selected.id, (current, data) => ({ ...current, owner: routingProfile.role, nextAction: `Review proposal revision ${proposalPackage.revision}`, nextActionDue: proposalReviewDueDate, nextActionImpact: "High", discovery: { ...data, phase: "Proposal", proposal: { ...data.proposal, status, review: { revision: proposalPackage.revision, submittedAt: now, submittedBy: current.owner, dueDate: proposalReviewDueDate, authorityProfileId: routingProfile.id, authorityRole: routingProfile.role, grossMarginPercent: commercialAuthority.grossMarginPercent ?? undefined, priceChangePercent: commercialAuthority.priceChangePercent, scopeChanged: commercialAuthority.scopeChanged, termsChanged: commercialAuthority.termsChanged }, history: [...(data.proposal.history ?? []), { revision: proposalPackage.revision, state: "Internal review", at: now, note: `Bound to estimate revision ${proposalPackage.estimateRevision}; routed to ${routingProfile.role}` }] } }, history: [`${now} · Proposal revision ${proposalPackage.revision} routed to ${routingProfile.role}`, ...current.history] }));
      onNotice(`Proposal revision ${proposalPackage.revision} routed to ${routingProfile.role}.`);
      onProposalQueued();
      return;
    }
    if (status === "Changes requested" || status === "Approved") {
      if (proposal.status !== "Internal review" || !proposal.review || proposal.review.revision !== proposalPackage?.revision) { onNotice("This proposal revision is not awaiting an approval decision."); return; }
      if (!proposalDecisionNote.trim()) { onNotice("Add a decision basis before recording the proposal review outcome."); return; }
      const now = new Date().toLocaleString();
      updateDiscovery(selected.id, (current, data) => ({ ...current, owner: data.proposal.review?.submittedBy ?? current.owner, nextAction: status === "Approved" ? "Record customer proposal submission" : "Revise proposal package", nextActionDue: status === "Approved" ? data.proposal.dueDate || null : null, discovery: { ...data, phase: status === "Approved" ? "Proposal" : "Proposal", proposal: { ...data.proposal, status, review: { ...data.proposal.review!, decidedAt: now, decisionNote: proposalDecisionNote.trim() }, history: [...(data.proposal.history ?? []), { revision: proposalPackage!.revision, state: status, at: now, note: proposalDecisionNote.trim() }] } }, history: [`${now} · Proposal revision ${proposalPackage!.revision} ${status.toLowerCase()} · ${proposalDecisionNote.trim()}`, ...current.history] }));
      setProposalDecisionNote("");
      onNotice(status === "Approved" ? `Proposal revision ${proposalPackage!.revision} approved for submission.` : `Changes requested on proposal revision ${proposalPackage!.revision}. Save a new package revision before resubmitting.`);
      return;
    }
    if (estimate.status !== "Approved" || proposal.status !== "Approved" || !proposalPackage || proposalPackage.estimateRevision !== estimate.revision) { onNotice("The proposal and its bound estimate revision must both be approved before recording customer submission."); return; }
    if (!proposal.recipient.trim() || !proposal.dueDate) { onNotice("Enter the customer recipient and response due date before recording submission."); return; }
    const now = new Date().toLocaleString();
    const submission = { revision: proposalPackage.revision, estimateRevision: proposalPackage.estimateRevision, recordedAt: now, recipient: proposal.recipient, method: proposal.method, responseDueDate: proposal.dueDate, packageSnapshot: { ...proposalPackage } };
    updateDiscovery(selected.id, (current, data) => ({ ...current, owner: data.proposal.review?.submittedBy ?? current.owner, nextAction: "Track customer response", nextActionDue: data.proposal.dueDate, nextActionImpact: "High", discovery: { ...data, phase: "Submitted", proposal: { ...data.proposal, status: "Submitted", submission, submissionHistory: [...(data.proposal.submissionHistory ?? (data.proposal.submission ? [data.proposal.submission] : [])), submission], history: [...(data.proposal.history ?? []), { revision: proposalPackage.revision, state: "Submitted to customer", at: now, note: `${data.proposal.method} · ${data.proposal.recipient}` }] } }, history: [`${now} · Proposal revision ${proposalPackage.revision} recorded as submitted to ${data.proposal.recipient}`, ...current.history] }));
    onNotice("Customer submission recorded in the prototype. No email, portal upload, or external message was sent.");
  }
  function saveOutcome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !discovery) return;
    const form = new FormData(event.currentTarget);
    const outcome = String(form.get("outcome")) as "Won" | "Lost" | "No bid";
    const note = String(form.get("note") ?? "").trim();
    updateDiscovery(selected.id, (current, data) => ({ ...current, discovery: { ...data, phase: "Outcome", outcome, outcomeNote: note }, stage: outcome === "Won" ? "Authorize & Readiness" : "Close & Lifecycle", nextAction: outcome === "Won" ? "Confirm authorization and delivery handoff" : "Record learning and close pursuit", status: outcome === "Won" ? "moving" : "complete", history: [`${new Date().toLocaleString()} · Pursuit outcome: ${outcome}${note ? ` · ${note}` : ""}`, ...current.history] }));
    setDrawer(null); onNotice(`${outcome} outcome recorded. ${outcome === "Won" ? "The same Work Record continues into authorization and delivery." : "The pursuit is closed with its history retained."}`);
  }
  function recordCustomerResponse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !discovery || !proposal || proposal.status !== "Submitted" || !proposal.submission) { onNotice("Record customer responses only against a submitted proposal revision."); return; }
    const form = new FormData(event.currentTarget);
    const status = String(form.get("responseStatus")) as NonNullable<DiscoveryRecord["proposal"]["responseEvents"]>[number]["status"];
    const receivedAt = String(form.get("receivedAt") ?? "");
    const details = String(form.get("details") ?? "").trim();
    const sourceReference = String(form.get("sourceReference") ?? "").trim();
    const nextAction = String(form.get("nextAction") ?? "").trim();
    const followUpDue = String(form.get("followUpDue") ?? "");
    if (controlledCommercial) {
      if (commercialBusy || !proposal.package) return;
      setCommercialBusy(true);
      void onCommercialCommand({ workId: selected.id, packageRevision: proposal.package.revision, action: "record-customer-response", responseStatus: status, receivedAt, note: details, sourceReference, nextAction, followUpDue })
        .then((saved) => { if (saved) setDrawer(null); })
        .finally(() => setCommercialBusy(false));
      return;
    }
    if (!receivedAt || !details) { onNotice("Enter when the response arrived and what the customer said."); return; }
    if (!["Awarded", "Not awarded"].includes(status) && (!nextAction || !followUpDue)) { onNotice("Add an owner action and due date for clarification, negotiation, or a deferred decision."); return; }
    const now = new Date().toLocaleString();
    const response = { revision: proposal.submission.revision, status, receivedAt, details, nextAction, followUpDue };
    const isWon = status === "Awarded";
    const isLost = status === "Not awarded";
    updateDiscovery(selected.id, (current, data) => ({
      ...current,
      ...(isWon ? { stage: "Authorize & Readiness", status: "moving" as const, nextAction: "Confirm authorization and delivery handoff", nextActionDue: null } : isLost ? { stage: "Close & Lifecycle", status: "complete" as const, nextAction: "Review loss and capture learning", nextActionDue: null } : { nextAction, nextActionDue: followUpDue, nextActionImpact: "High" as const }),
      discovery: {
        ...data,
        phase: isWon || isLost ? "Outcome" : data.phase,
        outcome: isWon ? "Won" : isLost ? "Lost" : data.outcome,
        outcomeNote: isWon || isLost ? details : data.outcomeNote,
        proposal: { ...data.proposal, response: details, responseEvents: [...(data.proposal.responseEvents ?? []), response], history: [...(data.proposal.history ?? []), { revision: response.revision, state: `Customer response · ${status}`, at: now, note: details }] },
      },
      history: [`${now} · Customer response to proposal revision ${response.revision}: ${status} · ${details}`, ...current.history],
    }));
    setDrawer(null);
    onNotice(isWon ? "Customer awarded the work. The same Work Record continues to authorization and readiness." : isLost ? "Customer declined the offer. The pursuit is closed with its proposal and response history retained." : `Customer response recorded against proposal revision ${response.revision}. Follow-up is due ${followUpDue}.`);
  }

  function submitDesignHandoff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !proposal?.package || commercialBusy) return;
    const form = new FormData(event.currentTarget);
    const dueDate = String(form.get("handoffDueDate") ?? "");
    const note = String(form.get("handoffCorrectionNote") ?? "").trim();
    setCommercialBusy(true);
    void onCommercialCommand({ workId: selected.id, packageRevision: proposal.package.revision, action: "submit-design-handoff", dueDate, note })
      .then((saved) => { if (saved) setHandoffOpen(false); })
      .finally(() => setCommercialBusy(false));
  }
  function decideDesignHandoff(action: "accept-design-handoff" | "return-design-handoff") {
    if (!selected || !proposal?.package || !discovery?.designHandoff || commercialBusy) return;
    setCommercialBusy(true);
    void onCommercialCommand({ workId: selected.id, packageRevision: proposal.package.revision, handoffRevision: discovery.designHandoff.revision, action, note: handoffDecisionNote.trim() })
      .then((saved) => { if (saved) { setHandoffDecisionNote(""); setHandoffOpen(false); } })
      .finally(() => setCommercialBusy(false));
  }

  const handoff = discovery?.designHandoff;
  const handoffBrief = handoff?.brief;
  const designHandoffDrawer = <div className={styles.drawerForm}>
    <p className={styles.need}>{selected?.title} · Awarded proposal revision {proposal?.submission?.revision}</p>
    <p className={styles.hint}>This exact awarded basis is retained for Design receiving. Receiving does not authorize a package release or send an external notification.</p>
    <div className={styles.proposalFields}>
      {handoffBrief?.correctionNote ? <p><strong>Correction to returned revision {handoffBrief.priorReturnRevision}</strong><br />{handoffBrief.correctionNote}<br /><small>Prior return: {handoffBrief.priorReturnReason}</small></p> : null}
      <p><strong>Customer outcome</strong><br />{handoffBrief?.customerOutcome ?? selected?.definition?.outcome}</p>
      <p><strong>Acceptance basis</strong><br />{handoffBrief?.acceptance ?? selected?.definition?.acceptance}</p>
      <p><strong>Offer scope</strong><br />{handoffBrief?.offerScope ?? proposal?.package?.scope}</p>
      <p><strong>Delivery approach</strong><br />{handoffBrief?.deliveryApproach ?? selected?.definition?.deliveryApproach}</p>
      <details><summary>Dependencies, risks and commercial terms</summary><p><strong>Dependencies:</strong> {handoffBrief?.dependencies ?? selected?.definition?.dependencies}</p><p><strong>Risks:</strong> {handoffBrief?.risks ?? selected?.definition?.risks}</p><p><strong>Exclusions:</strong> {handoffBrief?.excludedScope ?? selected?.definition?.excludedScope}</p><p><strong>Terms:</strong> {handoffBrief?.commercialTerms ?? proposal?.package?.commercialTerms}</p></details>
      {handoffBrief?.develop ? <details><summary>Exact Develop solution, estimate and offer basis</summary><p><strong>Selected solution:</strong> {handoffBrief.develop.selectedOptionSnapshot.name} · revision {handoffBrief.develop.solutionRevision} · {handoffBrief.develop.selectionRationale}</p><p><strong>Cost basis:</strong> {handoffBrief.develop.estimateSnapshot.input.lines.length} sourced lines · policy {handoffBrief.develop.policyId} v{handoffBrief.develop.policyVersion} · {handoffBrief.develop.currency} · included cost {formatMinor(handoffBrief.develop.estimateSnapshot.evaluation.includedCostMinor, handoffBrief.develop.currency)}</p><p><strong>Customer offer:</strong> revision {handoffBrief.develop.offerSnapshot.revision} · {money(handoffBrief.develop.offerSnapshot.sellPrice, handoffBrief.develop.currency)}</p><p><strong>Labor / procurement:</strong> {handoffBrief.develop.laborStrategy} · {handoffBrief.develop.procurementStrategy}</p><p><strong>Schedule / safety / quality:</strong> {handoffBrief.develop.scheduleStrategy} · {handoffBrief.develop.safetyStrategy} · {handoffBrief.develop.qualityStrategy}</p></details> : null}
    </div>
    {!handoff || handoff.status === "returned" ? <form onSubmit={submitDesignHandoff}><p>Send revision {(handoff?.revision ?? 0) + 1} to the Design receiver role queue. A different signed-in reviewer must accept or return it.</p><label className={styles.field}>Receiver response due<input type="date" name="handoffDueDate" required /></label>{handoff?.status === "returned" ? <><p><strong>Returned revision {handoff.revision}:</strong> {handoff.decisionNote}</p><label className={styles.field}>Correction to receiving brief<textarea name="handoffCorrectionNote" required minLength={20} maxLength={2000} rows={4} placeholder="Address the returned clarification. Material scope or price changes require governed source revisions." /></label></> : null}<footer><button type="button" className="d5o-outline" onClick={() => setHandoffOpen(false)}>Cancel</button><button className="d5o-primary" disabled={commercialBusy || !canEdit}>Submit Design handoff</button></footer></form> : handoff.status === "submitted" ? <><p><strong>Revision {handoff.revision} awaits a Design receiver decision.</strong> Response due {dateLabel(handoff.responseDueDate)}. The submitting actor cannot decide their own handoff.</p><label className={styles.field}>Receiver decision basis<textarea value={handoffDecisionNote} onChange={(event) => setHandoffDecisionNote(event.target.value)} rows={3} placeholder="Explain acceptance or what must be corrected" /></label><footer><button type="button" className="d5o-outline" onClick={() => decideDesignHandoff("return-design-handoff")} disabled={commercialBusy || !canEdit || handoffDecisionNote.trim().length < 20}>Return brief</button><button type="button" className="d5o-primary" onClick={() => decideDesignHandoff("accept-design-handoff")} disabled={commercialBusy || !canEdit || handoffDecisionNote.trim().length < 20}>Accept Design handoff</button></footer></> : <><p><strong>Design handoff revision {handoff.revision} accepted</strong> by {handoff.decidedBy}. Package planning can begin; readiness and release remain separate decisions.</p><footer><button type="button" className="d5o-primary" onClick={() => { setHandoffOpen(false); if (selected) onPhase(selected, "Design"); }}>Open Design →</button></footer></>}
    {discovery?.designHandoffHistory?.length ? <details><summary>Handoff history · {discovery.designHandoffHistory.length} events</summary><ol>{discovery.designHandoffHistory.map((event, index) => <li key={`${event.revision}-${index}`}>Revision {event.revision} · {event.state} · {event.note} · {event.at}</li>)}</ol></details> : null}
  </div>;

  if (!isDevelop) return <DiscoverCRMWorkspace workspaceKey={workspaceKey} workspaceName={workspaceName} configurationInventory={configurationInventory} work={work} actor={actor} actorId={actorId} actorRole={actorRole} canEdit={canEdit} focusRecordId={focusRecordId} taskFocus={reviewFocus === "pursuit-prep" || reviewFocus === "pursuit-review" || reviewFocus === "define-handoff-prep" || reviewFocus === "define-handoff-receive" ? reviewFocus : null} onOpen={onOpen} onDefine={onDefine} onPhase={onPhase} onControl={onControl} onBack={onBack} onSelect={onSelect} onPursuitCommand={onPursuitCommand} onUpdate={onUpdate} onCreate={onCreate} onNotice={onNotice} />;
  return <main className="d5o-page d5o-record-full d5o-early-phase d5o-discover-phase">
    {!reviewFocus ? <WorkPhaseJourney active={isDevelop ? "Develop" : "Discover"} record={phaseRecord} backLabel={isDevelop ? "Define" : "Work hub"} onBack={onBack} onChoose={(phase) => { if (phaseRecord) onPhase(phaseRecord, phase); }} onControl={(control) => { if (phaseRecord) onControl(phaseRecord, control); }} /> : null}
    {reviewFocus && selected && estimate && proposal ? <FocusedTaskFrame title={({ pricing: "Pricing review", proposal: "Proposal approval", "solution-prep": "Prepare solution", "solution-review": "Independent solution review", "pricing-prep": "Prepare detailed estimate", "proposal-prep": "Prepare customer proposal", "customer-submission-prep": "Record customer submission", "rom-budget-ack": "Record ROM budget acknowledgment", "rom-design-authorization": "Authorize detailed Design", "design-handoff-receive": "Receive Design handoff", "design-handoff-correction": "Correct Design handoff" } as Record<string, string>)[reviewFocus] ?? "Develop task"}
      work={selected.title} customer={selected.customer} site={selected.site} workspace={workspaceKey}
      scope={["design-handoff-receive", "design-handoff-correction"].includes(reviewFocus) ? `Awarded offer revision ${proposal.submission?.revision ?? "unavailable"} · handoff revision ${handoff?.revision ?? 0}` : reviewFocus.startsWith("solution") ? `Selected option: ${selected.develop?.options.find((item) => item.id === selected.develop?.selectedOptionId)?.name ?? "Not selected"}. ${selected.develop?.selectionRationale ?? "Selection rationale needed"}` : reviewFocus.startsWith("pricing") ? `Estimate revision ${estimate.revision} · ${estimate.status}` : `Offer revision ${proposal.package?.revision ?? "unavailable"} · ${proposal.status}`}
      revision={["design-handoff-receive", "design-handoff-correction"].includes(reviewFocus) ? handoff?.revision ?? 0 : reviewFocus.startsWith("solution") ? selected.develop?.revision ?? 0 : reviewFocus.startsWith("pricing") ? estimate.revision : proposal.package?.revision ?? 0}
      outcome={reviewFocus === "rom-budget-ack" ? "Record the customer's sourced response to the indicative ROM. This does not award delivery." : reviewFocus === "rom-design-authorization" ? "Independently authorize only the extent and internal spend for detailed Design." : reviewFocus === "design-handoff-correction" ? "Address the receiver's return with an explicit clarification and resubmit the next revision. Material scope or price changes require governed source revisions." : reviewFocus === "design-handoff-receive" ? "Accept this exact awarded basis for Design, or return it for correction." : reviewFocus === "customer-submission-prep" ? "Record how the approved offer was submitted to the customer; this does not send it." : reviewFocus === "solution-review" ? "Approve this exact solution revision or return it for correction." : reviewFocus === "solution-prep" ? "Compare alternatives, cover confirmed requirements, select with rationale and submit." : reviewFocus === "pricing-prep" ? "Save and submit a sourced estimate against the approved solution." : reviewFocus === "proposal-prep" ? "Prepare the approved-price customer offer and request independent approval." : reviewFocus === "pricing" ? "Approve the sourced price basis or request a corrected estimate." : "Approve this exact customer offer or return it for correction."}
      nextOwner={reviewFocus === "rom-budget-ack" ? "Independent Operations Design authority" : reviewFocus === "rom-design-authorization" ? "Detailed Design preparer; delivery award remains separate" : reviewFocus === "design-handoff-correction" ? "Independent Operations receiver" : reviewFocus === "design-handoff-receive" ? "Project manager for package planning or corrected handoff" : reviewFocus === "customer-submission-prep" ? "Project manager for customer response and award" : reviewFocus === "solution-review" ? "Project manager for estimate preparation or corrected solution" : reviewFocus === "solution-prep" ? "Configured independent solution reviewer" : reviewFocus === "pricing-prep" ? "Configured independent pricing reviewer" : reviewFocus === "proposal-prep" ? "Configured independent proposal reviewer" : reviewFocus === "pricing" ? "Proposal preparer after pricing approval" : "Project manager for customer offer response"}
      onFullRecord={() => onOpen(selected)}
      context={<><p>Customer outcome: {selected.definition?.outcome ?? "Not recorded"}</p><p>Selected solution: {selected.develop?.selectedOptionId ?? "See full record"}</p><p>Estimate policy: {estimate.detailed?.policySnapshot.id ?? "Historical aggregate basis"}</p></>}>
      <p>Use the exact controls below. The server checks your membership, source revision and independence when you save.</p>
    </FocusedTaskFrame> : null}
    {isDevelop && !reviewFocus && selectedOutsideDevelop ? <div className={styles.sourceAlert}><strong>This work is waiting for an approved Define basis</strong><span>{selectedOutsideDevelop.title} is selected, but commercial preparation cannot begin until its current definition is approved and received.</span><button className="d5o-outline" type="button" onClick={() => onDefine(selectedOutsideDevelop)}>Open the current Define work →</button></div> : null}
    {isDevelop && !reviewFocus && !selectedOutsideDevelop ? <div className={styles.sourceAlert}><strong>Develop · commercial work</strong><span>Controlled pursuits enter here after their Define baseline is approved. Build the estimate, route pricing and the offer, then record customer response and award on the same Work Record. Legacy records retain their earlier commercial history.</span></div> : null}
    {!reviewFocus ? <div className={`${styles.metrics} d5o-early-phase-metrics`}>
      <><Metric label="ESTIMATES IN REVIEW" value={String(pricingCount)} note="Exact revisions awaiting a decision" /><Metric label="AWAITING CUSTOMER" value={String(awaitingCustomerCount)} note="Submitted offers without a response" /><Metric label="ACTIVE SUBMITTED VALUE" value={submittedValueLabel} note="Exact customer snapshots; currencies separate" /></>
    </div> : null}
    {isDevelop && !reviewFocus && onPolicyUpdated ? <PricingPolicyAdmin workspace={workspaceKey} hosted={hosted} onNotice={onNotice} onPolicyUpdated={async () => { await onPolicyUpdated(); setPolicyVersionSignal((value) => value + 1); }} /> : null}
    {isDevelop && !reviewFocus && hosted && selected?.canonicalWorkId ? selected.packages?.filter((pkg) => currentAcceptedRelease(selected,pkg.id)).map((pkg) => <FieldChangeControl key={pkg.id} mode="commercial" workspace={selected.workspace} workId={selected.id} packageId={pkg.id} releaseId={currentAcceptedRelease(selected,pkg.id)?.id} reports={[]} evidence={[]} />) : null}
    {isDevelop && !reviewFocus ? <DevelopPipeline work={work} selectedId={selected?.id} onSelect={(id) => { const item = work.find((candidate) => candidate.id === id); if (item && item.discovery?.pursuitControl && item.definition?.status !== "Approved") onDefine(item); else { onSelect(id); setEstimateDirty(false); } }} /> : null}
    <div className={`${styles.layout} d5o-early-phase-layout`} style={isDevelop ? { gridTemplateColumns: "minmax(0, 1fr)" } : undefined}>
      {!isDevelop ? <section className={`${styles.register} d5o-early-phase-rail`} aria-label="Discover work register">
        <div className={styles.sectionHeader}><div><p className={styles.kicker}>GOVERNED WORK</p><h2>{isDevelop ? "Estimate and offer queue" : "Qualification and pursuit queue"}</h2></div><span>{filtered.length} {filtered.length === 1 ? "record" : "records"}</span></div>
        {!isDevelop ? <button className="d5o-early-phase-create d5o-primary" onClick={() => setDrawer("capture")}>+ Capture opportunity</button> : null}
        <section className={styles.toolbar} aria-label="Filter pursuits"><div className={styles.filters}>{(["All active", ...(isDevelop ? phases.slice(1) : phases.slice(0, 1))] as Array<Phase | "All active">).map((phase) => <button key={phase} className={filter === phase ? styles.filterActive : ""} onClick={() => { selectVisible(phase, search); setFilter(phase); }}>{phase}<span>{phase === "All active" ? active.length : pursuits.filter((item) => item.discovery?.phase === phase).length}</span></button>)}</div><label className={styles.search}>Find work<input value={search} onChange={(event) => { selectVisible(filter, event.target.value); setSearch(event.target.value); }} placeholder="Customer, Work Record, or site" /></label></section>
        {filtered.length ? filtered.map((item) => <button key={item.id} className={`${styles.row} d5o-early-phase-queue-row ${selected?.id === item.id ? styles.rowSelected : ""}`} onClick={() => { onSelect(item.id); setEstimateDirty(false); setDecisionNote(""); }}>
          <div className={styles.rowTitle}><strong>{item.title}</strong><span>{item.customer} · {item.site}</span><small>{item.id.toUpperCase()} · {item.type}</small></div>
          <div><small>{isDevelop ? "COMMERCIAL STEP" : "PURSUIT"}</small><strong>{isDevelop ? item.discovery?.phase : item.discovery?.pursuitControl?.status ?? "Legacy qualification"}</strong></div>
          <div><small>OWNER · NEXT ACTION</small><strong>{item.owner}</strong><span>{item.nextAction}</span></div>
          <div><small>{isDevelop ? "COMMERCIAL VALUE" : "ROUGH VALUE"}</small><strong>{isDevelop ? item.discovery?.estimate.sellPrice ? money(item.discovery.estimate.sellPrice) : "Unpriced" : item.discovery?.pursuitControl?.roughValue ? `${item.discovery.pursuitControl.currency} ${Number(item.discovery.pursuitControl.roughValue).toLocaleString()}` : "Not recorded"}</strong><span>{isDevelop ? `${item.discovery?.fit ?? "Unassessed"} · Estimate rev ${item.discovery?.estimate.revision ?? 0}` : `Qualification: ${item.discovery?.fit ?? "Unassessed"}`}</span></div>
          <b className={`${styles.status} ${item.status === "attention" ? styles.attention : ""}`}>{item.status === "attention" ? "Needs attention" : "Moving"}</b>
        </button>) : <div className={styles.empty}><h3>No work matches this view</h3><p>{isDevelop ? "An approved Define baseline is needed before a controlled pursuit enters Develop. Historical commercial records remain visible." : "Capture a customer need or change the qualification filter."}</p>{!isDevelop ? <button className="d5o-primary" onClick={() => setDrawer("capture")}>Capture opportunity</button> : null}</div>}
      </section> : null}
      {selected && discovery && estimate && proposal ? <section className={`${styles.detail} d5o-early-phase-main`} aria-label={isDevelop ? "Selected commercial workspace" : "Selected pursuit workspace"}>
        {!reviewFocus ? <header className={styles.detailHeader}><div><p className={styles.kicker}>{isDevelop ? `DEVELOP · ${discovery.phase.toUpperCase()}` : `DISCOVER · ${(discovery.pursuitControl?.status ?? "legacy pursuit").toUpperCase()}`}</p><h2>{isDevelop ? "Solution, estimate, offer and award" : "Qualify the customer need"}</h2><p>{selected.customer} · {selected.site} · {selected.id.toUpperCase()}</p></div><div className={styles.detailHeaderActions}>{!isDevelop && (discovery.pursuitControl?.handoff?.status === "accepted" || selected.definition) ? <button type="button" className="d5o-primary" onClick={() => { onDefine(selected); onNotice(`Defining ${selected.title} on the same Work Record.`); }}>Open Define →</button> : null}<button type="button" className="d5o-outline" onClick={() => onOpen(selected)}>Open Work Record →</button></div></header> : null}
        {!reviewFocus ? <div className={styles.identity}><Identity label="OWNER / NEXT ACTION" value={selected.owner} detail={selected.nextAction} /><Identity label="LIFECYCLE POSITION" value={selected.stage} detail={`Qualification: ${discovery.fit}`} /><Identity label="NEXT DATE" value={isDevelop ? discovery.closeDate || "Not set" : discovery.pursuitControl?.requiredDate || discovery.closeDate || "Not set"} detail={`Source: ${discovery.source}`} /><Identity label={isDevelop ? "VALUE AT STAKE" : "ROUGH VALUE"} value={isDevelop ? estimate.sellPrice ? money(estimate.sellPrice, estimate.detailed?.input.currency) : selected.value : discovery.pursuitControl?.roughValue ? `${discovery.pursuitControl.currency} ${Number(discovery.pursuitControl.roughValue).toLocaleString()}` : "Not recorded"} detail={isDevelop ? `Estimate revision ${estimate.revision} · ${estimate.status}` : `Intake revision ${discovery.pursuitControl?.revision ?? 0}`} /></div> : null}
        {isDevelop && !reviewFocus ? <div className={styles.workflow}>{phases.slice(1).map((phase, index) => <span key={phase} className={phase === discovery.phase ? styles.currentStep : phases.indexOf(discovery.phase) > index + 1 ? styles.pastStep : ""}>{index + 1}<b>{phase}</b></span>)}</div> : null}
        {!isDevelop ? <><details className="d5o-phase-disclosure"><summary>Configured Discover requirements and source</summary>{phaseConfig?.phases.find((phase) => phase.key === "discover") ? <ConfiguredPhasePanel config={phaseConfig} phase={phaseConfig.phases.find((phase) => phase.key === "discover")!} work={selected} compact /> : <p>No pinned configuration matches this Work Type in the selected workspace. Requirements cannot be inferred from another Work Type.</p>}</details><PursuitControl key={selected.id} work={selected} actor={actor} canEdit={canEdit || (Boolean(selected.canonicalWorkId && onPursuitCommand) && ["admin", "project_manager", "business_development_lead", "billing_commercial_lead", "operations_leader"].includes(actorRole ?? ""))} connected={Boolean(selected.canonicalWorkId && onPursuitCommand)} onCommand={onPursuitCommand} onUpdate={onUpdate} onNotice={onNotice} onDefine={onDefine} /></> : null}
        {isDevelop && controlledCommercial ? <div className={styles.sourceAlert} role={!definitionSource && !discovery.outcome || estimate.revision > 0 && !estimateSourceCurrent && !discovery.outcome ? "alert" : undefined}>
          <strong>{!definitionSource && discovery.outcome ? "Historical commercial basis" : !definitionSource ? "Define receipt required" : estimate.revision > 0 && !estimateSourceCurrent ? "Estimate basis needs reconciliation" : "Approved Define basis"}</strong>
          <span>{!definitionSource ? "Develop can inspect this Work Record, but a new estimate needs an approved Define baseline accepted for this exact revision and pinned configuration. Open Define to complete the receipt."
            : estimate.revision > 0 && !estimateSourceCurrent
            ? estimate.status === "Pricing review" ? "Return this submitted review for correction, then save a new estimate revision against the approved scope before pricing or offer decisions." : "Save a new estimate revision against the current approved scope before pricing or offer decisions."
            : `Define revision ${definitionSource?.revision ?? "unavailable"} · configuration ${definitionSource?.configurationVersionId ?? "unavailable"}${estimate.definitionSource ? ` · captured ${estimate.definitionSource.capturedAt}` : " · will be bound when the estimate is saved"}`}</span>
          {!definitionSource ? <button type="button" className="d5o-outline" onClick={() => onDefine(selected)}>Open Define receipt →</button> : null}
        </div> : null}
        {isDevelop && (!reviewFocus || ["solution-prep", "solution-review", "pricing-prep"].includes(reviewFocus)) && onPeople ? <DevelopPlanning key={`${selected.id}-${estimate.revision}-${policyVersionSignal}`} work={selected} workspace={workspaceKey} canEdit={canEdit} hosted={hosted} focusMode={reviewFocus === "solution-prep" || reviewFocus === "solution-review" || reviewFocus === "pricing-prep" ? reviewFocus : undefined} onUpdate={onUpdate} onCommercialCommand={onCommercialCommand} onNotice={onNotice} onDefine={() => onDefine(selected)} onPeople={onPeople} /> : null}
        {isDevelop && hosted && estimate.detailed?.input.estimateMaturity === "ROM" && (!reviewFocus || reviewFocus === "customer-submission-prep" || reviewFocus === "rom-budget-ack" || reviewFocus === "rom-design-authorization") ? <RomDesignPanel work={selected} workspace={workspaceKey} role={actorRole} focus={reviewFocus} /> : null}
        {isDevelop && hosted && estimate.detailed?.input.estimateMaturity === "ROM" && (!reviewFocus || reviewFocus.startsWith("design-spend-")) ? <DesignSpendControl work={selected} workspace={workspaceKey} role={actorRole} actorId={actorId} focus={reviewFocus} /> : null}
        <div className={styles.detailGrid}>
          {!isDevelop ? <article className={styles.card}><p className={styles.kicker}>CUSTOMER NEED &amp; FIT</p><h3>Why this work matters</h3><p className={styles.need}>{discovery.need || "Capture the customer outcome and the reason this work should proceed."}</p><div className={styles.facts}><Fact label="Procurement" value={discovery.procurement} /><Fact label="Source" value={discovery.source} /><Fact label="Qualification" value={discovery.fit} /></div>
            <small className={styles.hint}>{fitField?.label ?? "Qualification outcome"} is recorded through the D1 pursuit decision above. This display does not grant spend or delivery authority.</small>
          </article> : null}
          {isDevelop && (!reviewFocus || reviewFocus === "pricing" || reviewFocus === "pricing-prep") ? <article ref={pricingCard} className={styles.card}><p className={styles.kicker}>ESTIMATE · REVISION {estimate.revision}</p><h3>Cost, price and margin</h3><div className={styles.estimateSummary}><div><small>INCLUDED COST</small><strong>{money(totalCost, estimate.detailed?.input.currency)}</strong></div><div><small>SELL PRICE</small><strong>{money(estimate.sellPrice, estimate.detailed?.input.currency)}</strong></div><div><small>TARGET MARGIN</small><strong>{estimate.targetMargin}%</strong></div></div>
            {!estimate.detailed && estimate.revision > 0 ? <details><summary>Legacy manual aggregate estimate</summary><p className={styles.hint}>Historical partial-cost basis; it does not claim quantity or rate coverage.</p><form className={styles.estimateForm} key={`${selected.id}-${estimate.revision}-${policyVersionSignal}`} onChange={() => setEstimateDirty(true)} onSubmit={saveEstimate}><fieldset className={styles.estimateFields} disabled={estimate.status === "Pricing review" || ["Internal review", "Approved", "Submitted"].includes(proposal.status)}><div className={styles.costGrid}><NumberField label="Labor" name="labor" value={estimate.labor} /><NumberField label="Materials" name="materials" value={estimate.materials} /><NumberField label="Subcontract" name="subcontract" value={estimate.subcontract} /><NumberField label="Travel" name="travel" value={estimate.travel} /><NumberField label="Contingency" name="contingency" value={estimate.contingency} /><NumberField label="Target margin %" name="margin" value={estimate.targetMargin} /></div><label className={styles.field}>Source, confidence, assumptions and exclusions<input name="assumption" defaultValue={estimate.assumption} required placeholder="Manual total source, confidence and exclusions" /></label><button className="d5o-primary" disabled={!estimateDirty}>{estimateDirty ? "Save new manual revision" : `Manual revision ${estimate.revision} saved`}</button></fieldset></form></details> : null}
            <section className={`${styles.pricingState} ${estimate.status === "Approved" ? styles.approved : estimate.status === "Changes requested" ? styles.changesRequested : estimate.status === "Pricing review" ? styles.awaitingReview : ""}`} aria-live="polite">
              <div className={styles.pricingStateHeader}><div><p className={styles.kicker}>PRICING CONTROL</p><h4>{estimate.status === "Pricing review" ? "Awaiting pricing decision" : estimate.status === "Approved" ? "Pricing approved" : estimate.status === "Changes requested" ? "Revision required" : "Ready for pricing review"}</h4></div><span>REV {estimate.status === "Pricing review" || estimate.status === "Approved" ? estimate.review?.revision ?? estimate.revision : estimate.revision}</span></div>
              <p>{estimate.status === "Pricing review" ? `Revision ${estimate.review?.revision ?? estimate.revision} is in review. Record approval or requested changes against this exact revision.` : estimate.status === "Approved" ? `Revision ${estimate.review?.revision ?? estimate.revision} is approved. Proposal preparation is now available.` : estimate.status === "Changes requested" ? `${estimate.review?.decisionNote || "The reviewer requested changes."} Save a new revision before resubmitting.` : estimateDirty ? "You have unsaved changes. Save them as a new estimate revision before routing it to pricing." : `Revision ${estimate.revision} is saved. Submit this exact version for pricing review; later edits must be saved as a new revision.`}</p>
              {estimate.status === "Pricing review" ? <p className={styles.nextOwner}><strong>Decision owner</strong><span>{estimate.detailed?.policySnapshot.pricingApproverRole ?? "Legacy pricing role"}</span><small>Due {estimate.review?.dueDate || "date not set"} · membership role and separation from the estimator are checked by the server for controlled detailed estimates.</small></p> : null}
              {estimate.detailed?.evaluation.issues.some((issue) => issue.code === "below_floor") ? <div className={styles.reviewBasis}><strong>Below configured margin floor</strong><p>{estimate.detailed.evaluation.issues.find((issue) => issue.code === "below_floor")?.message} Price correction is preferred. A bounded exception requires {estimate.detailed.policySnapshot.marginExceptionRole ?? "admin"} authority for this revision.</p>{estimate.review?.exception?.revision === estimate.revision ? <p>Exception authorized by {estimate.review.exception.role} on {estimate.review.exception.at}: {estimate.review.exception.reason}</p> : estimate.status === "Pricing review" ? <button className="d5o-outline" disabled={commercialBusy || !decisionNote.trim()} onClick={() => void onCommercialCommand({ workId: selected.id, packageRevision: estimate.revision, action: "approve-margin-exception", note: decisionNote.trim() }).then((saved) => { if (saved) setDecisionNote(""); })}>Authorize bounded exception</button> : null}</div> : null}
              {estimate.status !== "Pricing review" && estimate.status !== "Approved" ? <label className={styles.field}>Pricing decision due date<input type="date" value={pricingDueDate} onChange={(event) => setPricingDueDate(event.target.value)} /><small className={styles.fieldHint}>The assigned reviewer sees this deadline in the pricing review queue.</small></label> : null}
              {estimate.status === "Pricing review" ? <><label className={styles.field}>Decision basis<input value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Reason, conditions, or requested changes" /></label><div className={styles.buttonRow}><button className="d5o-outline" onClick={() => setEstimateStatus("Changes requested")} disabled={commercialBusy || !decisionNote.trim()}>Request changes</button><button className="d5o-primary" onClick={() => setEstimateStatus("Approved")} disabled={commercialBusy || !decisionNote.trim() || !estimateSourceCurrent}>Approve revision {estimate.review?.revision ?? estimate.revision}</button></div></> : estimate.status === "Draft" || estimate.status === "Not started" || estimate.status === "Changes requested" ? <button className="d5o-primary" onClick={() => setEstimateStatus("Pricing review")} disabled={commercialBusy || !estimate.sellPrice || estimateDirty || !estimateSourceCurrent || (estimate.status === "Changes requested" && estimate.review?.revision === estimate.revision)}>{estimate.status === "Changes requested" && estimate.review?.revision === estimate.revision ? "Save a new revision before resubmitting" : `Submit revision ${estimate.revision} for pricing review`}</button> : <p className={styles.reviewBasis}>Decision basis: {estimate.review?.decisionNote || "Pricing approval recorded for this revision."}</p>}
              {estimate.pricingHistory?.length ? <details className={styles.pricingHistory}><summary>Pricing history · {estimate.pricingHistory.length} events</summary><ol>{estimate.pricingHistory.slice().reverse().map((entry, index) => <li key={`${entry.revision}-${entry.state}-${index}`}><strong>Revision {entry.revision} · {entry.state}</strong><span>{money(entry.sellPrice)} sell price · {money(entry.cost)} cost · {entry.targetMargin}% margin</span><small>{entry.at}{entry.note ? ` · ${entry.note}` : ""}</small></li>)}</ol></details> : null}
            </section>
          </article> : null}
          {isDevelop && (!reviewFocus || reviewFocus === "proposal" || reviewFocus === "proposal-prep" || reviewFocus === "customer-submission-prep") ? <article ref={proposalCard} className={styles.card}>
            <p className={styles.kicker}>BID / PROPOSAL CONTROL</p><h3>Prepare and submit the offer</h3>
            <div className={styles.facts}><Fact label="Proposal status" value={proposal.status} /><Fact label="Offer value" value={proposal.package ? money(proposal.package.sellPrice, proposal.package.pricingBasis?.currency) : "Not prepared"} /><Fact label="Bound estimate" value={proposal.package ? `Revision ${proposal.package.estimateRevision}` : "None"} /></div>
            {proposal.package ? <section className={styles.pricingState} aria-label="Saved proposal revision">
              <div className={styles.pricingStateHeader}><div><p className={styles.kicker}>CUSTOMER OFFER SNAPSHOT</p><h4>Proposal revision {proposal.package.revision}</h4></div><span>ESTIMATE REV {proposal.package.estimateRevision}</span></div>
              {proposal.package.definitionSource ? <p><strong>Approved scope source:</strong> Define revision {proposal.package.definitionSource.revision} · configuration {proposal.package.definitionSource.configurationVersionId}</p> : null}
              <p><strong>Scope:</strong> {proposal.package.scope}</p><p><strong>Assumptions:</strong> {proposal.package.assumptions || "None recorded"}</p><p><strong>Exclusions:</strong> {proposal.package.exclusions || "None recorded"}</p><p><strong>Commercial terms:</strong> {proposal.package.commercialTerms}</p>{proposal.package.changeReason ? <p><strong>Revision reason:</strong> {proposal.package.changeReason}</p> : null}
              {estimate.status !== "Approved" || proposal.package.estimateRevision !== estimate.revision ? <p className={styles.reviewBasis}>This package is out of date. Save it again only after the current estimate revision is approved.</p> : null}
            </section> : <p className={styles.hint}>An approved pricing revision is required. The saved proposal will carry an immutable snapshot of its estimate value and terms.</p>}
            {lastSubmittedPackage && proposal.package && proposal.package.revision !== lastSubmission?.revision ? <section className={`${styles.pricingState} ${styles.awaitingReview}`} aria-label="Changes from submitted offer">
              <div className={styles.pricingStateHeader}><div><p className={styles.kicker}>REVISION CONTROL</p><h4>Changes from submitted revision {lastSubmission?.revision}</h4></div><span>{changesFromSubmitted.length} changed</span></div>
              {changesFromSubmitted.length ? <ul className={styles.changeList}>{changesFromSubmitted.map((change) => <li key={change.label}><strong>{change.label}</strong><span>Submitted: {change.before}</span><span>Current: {change.after}</span></li>)}</ul> : <p>No offer terms changed from the last submitted snapshot. The new revision reason is still recorded for review.</p>}
              <p>Submitted offer stays preserved in history. This new revision must pass proposal approval before it can be submitted.</p>
            </section> : null}

            {estimate.status === "Approved" && ["Not started", "Draft", "Changes requested"].includes(proposal.status) ? <form className={styles.estimateForm} key={`${selected.id}-proposal-${proposal.package?.revision ?? 0}-${estimate.revision}`} onSubmit={saveProposal}>
              <p className={styles.kicker}>PROPOSAL PACKAGE · FROM APPROVED ESTIMATE REV {estimate.revision}</p>
              {romCommunication ? <p>Indicative ROM only. Detailed Design will validate quantities and methods; budget acknowledgment does not award delivery.</p> : null}
              <label className={styles.field}>Customer-facing scope<textarea name="scope" required rows={3} defaultValue={proposal.package?.scope ?? (romCommunication ? `Indicative ROM: ${romCommunication.scope}\n\nDesign to confirm: ${romCommunication.designValidation}` : approvedCustomerScope)} placeholder="Describe the proposed outcome, deliverables, and boundaries." /></label>
              <label className={styles.field}>Assumptions<textarea name="assumptions" rows={2} defaultValue={proposal.package?.assumptions ?? (romCommunication ? `${romCommunication.assumptions}\nInformation still required: ${romCommunication.informationNeeded}` : estimate.assumption)} placeholder="Dependencies, customer inputs, site conditions, or planning basis." /></label>
              <label className={styles.field}>Exclusions<textarea name="exclusions" rows={2} defaultValue={proposal.package?.exclusions ?? romCommunication?.exclusions ?? (controlledCommercial ? selected.definition?.excludedScope : "")} placeholder="State what is outside this offer." /></label>
              <label className={styles.field}>Commercial terms<textarea name="commercialTerms" required rows={2} defaultValue={proposal.package?.commercialTerms ?? (romCommunication ? `${romRange ? `Indicative ROM base ${formatMinor(romRange.base.proposedPriceMinor, estimate.detailed!.input.currency)}; scenario range ${formatMinor(romRange.low.proposedPriceMinor, estimate.detailed!.input.currency)}–${formatMinor(romRange.high.proposedPriceMinor, estimate.detailed!.input.currency)}` : "Indicative ROM price requires a current calculation"}. Review by ${romCommunication.reviewDate}. Not a guaranteed maximum or final engineering approval. No purchasing or execution authority.` : `${discovery.procurement}. Price based on approved estimate revision ${estimate.revision}; final terms subject to contract.`)} /></label>
              {proposal.package ? <label className={styles.field}>Why is this revision changing?<textarea name="changeReason" required rows={2} defaultValue="" placeholder="Customer request, negotiation point, or clarification being addressed." /></label> : null}
              <button className="d5o-primary">{proposal.package ? `Save proposal revision ${(proposal.package.revision ?? 0) + 1}` : "Save proposal package"}</button>
            </form> : null}

            {proposal.status === "Draft" || proposal.status === "Changes requested" ? <section className={styles.pricingState} aria-label="Proposal approval routing">
              <div className={`${styles.commercialAssessment} ${estimate.detailed || commercialAuthority.matchedProfile ? styles.commercialMatched : styles.commercialBlocked}`}><div><small>OFFER VALUE</small><strong>{money(proposal.package?.sellPrice ?? 0, proposal.package?.pricingBasis?.currency)}</strong></div><div><small>INCLUDED-COST MARGIN</small><strong>{estimate.detailed?.evaluation.marginPercent === null ? "Unavailable" : estimate.detailed ? `${estimate.detailed.evaluation.marginPercent?.toFixed(1)}%` : commercialAuthority.grossMarginPercent === null ? "Unavailable" : `${commercialAuthority.grossMarginPercent.toFixed(1)}%`}</strong></div><div><small>CHANGE VS LAST SUBMISSION</small><strong>{lastSubmittedPackage ? `${commercialAuthority.priceChangePercent.toFixed(1)}%` : "No submitted baseline"}</strong></div><div><small>CHANGED SCOPE / TERMS</small><strong>{commercialAuthority.scopeChanged ? "Scope" : "No scope"} · {commercialAuthority.termsChanged ? "Terms" : "No terms"}</strong></div><div className={styles.commercialRoute}><small>ROUTING RESULT</small><strong>{estimate.detailed ? estimate.detailed.policySnapshot.proposalApproverRole : commercialAuthority.matchedProfile?.role ?? "No matching authority profile"}</strong><span>{estimate.detailed ? `Published tenant policy ${estimate.detailed.evaluation.policyId} v${estimate.detailed.evaluation.policyVersion}; exact estimate and solution revisions required.` : commercialAuthority.matchedProfile ? "Matched by offer, calculated margin, price movement, and change rights." : commercialAuthority.reasons.join(" ")}</span></div></div>
              <label className={styles.field}>Internal approval due date<input type="date" value={proposalReviewDueDate} onChange={(event) => setProposalReviewDueDate(event.target.value)} /></label>
              {!controlledCommercial && !commercialProfiles.length ? <small className={styles.hint}>Configure a local demonstration authority profile before routing this prototype offer.</small> : null}
              <button className="d5o-primary" onClick={() => proposalAction("Internal review")} disabled={commercialBusy || !proposal.package || !estimate.detailed && !commercialAuthority.matchedProfile || estimate.status !== "Approved" || proposal.package.estimateRevision !== estimate.revision}>Request proposal approval</button>
            </section> : null}

            {proposal.status === "Internal review" ? <section className={`${styles.pricingState} ${styles.awaitingReview}`} aria-live="polite">
              <div className={styles.pricingStateHeader}><div><p className={styles.kicker}>INTERNAL COMMERCIAL REVIEW</p><h4>Proposal revision {proposal.review?.revision} is awaiting a decision</h4></div><span>Due {proposal.review?.dueDate || "Not set"}</span></div>
              <p className={styles.nextOwner}><strong>Decision owner</strong><span>{proposal.review?.authorityRole ?? "Legacy proposal authority · profile not recorded"}</span><small>Authority profile {proposal.review?.authorityProfileId ?? "not recorded"} · the controlled detailed route checks authenticated membership role and a reviewer distinct from the preparer.</small></p>
              <div className={styles.reviewBasis}><small>APPROVAL BASIS</small><span>Offer {money(proposal.package?.sellPrice ?? 0)} · Calculated margin {proposal.review?.grossMarginPercent === undefined ? "not recorded" : `${Number(proposal.review.grossMarginPercent).toFixed(1)}%`} · Price movement {proposal.review?.priceChangePercent === undefined ? "not recorded" : `${Number(proposal.review.priceChangePercent).toFixed(1)}%`} · Scope {proposal.review?.scopeChanged ? "changed" : "unchanged"} · Terms {proposal.review?.termsChanged ? "changed" : "unchanged"}</span></div>
              <label className={styles.field}>Decision basis<input value={proposalDecisionNote} onChange={(event) => setProposalDecisionNote(event.target.value)} placeholder="Commercial rationale, conditions, or changes needed" /></label>
              <div className={styles.buttonRow}><button className="d5o-outline" onClick={() => proposalAction("Changes requested")} disabled={commercialBusy || !proposalDecisionNote.trim()}>Request changes</button><button className="d5o-primary" onClick={() => proposalAction("Approved")} disabled={commercialBusy || !proposalDecisionNote.trim()}>Approve proposal revision {proposal.review?.revision}</button></div>
            </section> : null}

            {proposal.status === "Approved" ? <section className={styles.pricingState} aria-label="Customer submission details">
              <div className={styles.pricingStateHeader}><div><p className={styles.kicker}>APPROVED FOR CUSTOMER SUBMISSION</p><h4>Record where and when this exact offer is sent</h4></div><span>REV {proposal.package?.revision}</span></div>
              <div className={styles.proposalFields}>
                <label className={styles.field}>Customer recipient<input value={controlledCommercial ? submissionForm.recipient : proposal.recipient} onChange={(event) => controlledCommercial ? setSubmissionDraft({ ...submissionForm, recipient: event.target.value }) : updateDiscovery(selected.id, (current, data) => ({ ...current, discovery: { ...data, proposal: { ...data.proposal, recipient: event.target.value } } }))} placeholder="Contact or procurement mailbox" /></label>
                <label className={styles.field}>Submission route<select value={controlledCommercial ? submissionForm.method : proposal.method} onChange={(event) => controlledCommercial ? setSubmissionDraft({ ...submissionForm, method: event.target.value }) : updateDiscovery(selected.id, (current, data) => ({ ...current, discovery: { ...data, proposal: { ...data.proposal, method: event.target.value } } }))}><option>Customer portal</option><option>Email</option><option>Procurement platform</option><option>Direct presentation</option></select></label>
                <label className={styles.field}>Customer response due<input type="date" value={controlledCommercial ? submissionForm.dueDate : proposal.dueDate} onChange={(event) => controlledCommercial ? setSubmissionDraft({ ...submissionForm, dueDate: event.target.value }) : updateDiscovery(selected.id, (current, data) => ({ ...current, discovery: { ...data, proposal: { ...data.proposal, dueDate: event.target.value } } }))} /></label>
              </div>
              <button className="d5o-primary" onClick={() => proposalAction("Submitted")} disabled={commercialBusy || !(controlledCommercial ? submissionForm.recipient : proposal.recipient).trim() || !(controlledCommercial ? submissionForm.dueDate : proposal.dueDate)}>Record customer submission</button>
              <small className={styles.hint}>This records the event and follow-up date. It does not send email or upload the proposal to a customer portal.</small>
            </section> : null}

            {proposal.status === "Submitted" ? <section className={styles.pricingState} aria-label="Recorded customer submission">
              <div className={styles.pricingStateHeader}><div><p className={styles.kicker}>SUBMISSION RECORDED</p><h4>Proposal revision {proposal.submission?.revision} sent to {proposal.submission?.recipient}</h4></div><span>{proposal.submission?.method}</span></div>
              <p>Approved estimate revision {proposal.submission?.estimateRevision} · response due {proposal.submission?.responseDueDate || proposal.dueDate} · recorded {proposal.submission?.recordedAt}</p>
              {latestProposalResponse ? <><p><strong>Latest customer response · {latestProposalResponse.status}</strong><br />{latestProposalResponse.details}</p>{latestProposalResponse.sourceReference ? <p><strong>Source:</strong> {latestProposalResponse.sourceReference}</p> : null}{latestProposalResponse.nextAction ? <p><strong>Next action:</strong> {latestProposalResponse.nextAction} · due {latestProposalResponse.followUpDue}</p> : null}</> : <p>No customer response has been recorded. The follow-up date above is the expected response deadline.</p>}
              <button className="d5o-primary" onClick={() => setDrawer("response")} disabled={commercialBusy || !!discovery.outcome}>Record customer response</button>
              {proposal.submission && latestProposalResponse?.revision === proposal.submission.revision && ["Clarification requested", "Commercial negotiation"].includes(latestProposalResponse.status) && !discovery.outcome ? <button className="d5o-outline" onClick={startNegotiatedRevision} disabled={commercialBusy}>Prepare negotiated revision</button> : null}
              <small className={styles.hint}>External delivery is not connected. The prototype records the submission details; no message or portal upload was sent.</small>
            </section> : null}
            {proposal.responseEvents?.length ? <details className={styles.pricingHistory}><summary>Customer response history · {proposal.responseEvents.length} entries</summary><ol>{proposal.responseEvents.slice().reverse().map((entry, index) => <li key={`${entry.revision}-${entry.receivedAt}-${index}`}><strong>Proposal rev {entry.revision} · {entry.status}</strong><span>{entry.details}{entry.nextAction ? ` · Follow-up: ${entry.nextAction}` : ""}</span><small>Received {entry.receivedAt}{entry.followUpDue ? ` · Follow-up due ${entry.followUpDue}` : ""}{entry.recordedByActorId ? ` · Recorded by ${entry.recordedByActorId}` : ""}</small></li>)}</ol></details> : null}
            {submissionHistory.length ? <details className={styles.pricingHistory}><summary>Submitted offer history · {submissionHistory.length} revisions</summary><ol>{submissionHistory.slice().reverse().map((entry) => {
              const snapshot = entry.packageSnapshot ?? proposal.packageHistory?.find((item) => item.revision === entry.revision) ?? (proposal.package?.revision === entry.revision ? proposal.package : undefined);
              return <li key={`${entry.revision}-${entry.recordedAt}`}><strong>Proposal rev {entry.revision} · Estimate rev {entry.estimateRevision} · {snapshot ? money(snapshot.sellPrice) : "Snapshot unavailable"}</strong><span>{snapshot ? `${snapshot.scope} · ${snapshot.commercialTerms}` : "Legacy submission record does not contain a preserved offer snapshot."}</span><small>Sent to {entry.recipient} by {entry.method} · response due {dateLabel(entry.responseDueDate)} · {entry.recordedAt}{entry.recordedByActorId ? ` · Recorded by ${entry.recordedByActorId}` : ""}</small></li>;
            })}</ol></details> : null}
            {proposal.history?.length ? <details className={styles.pricingHistory}><summary>Proposal history · {proposal.history.length} events</summary><ol>{proposal.history.slice().reverse().map((entry, index) => <li key={`${entry.revision}-${entry.state}-${index}`}><strong>Revision {entry.revision} · {entry.state}</strong><span>{entry.note}</span><small>{entry.at}</small></li>)}</ol></details> : null}
          </article> : null}
          {isDevelop && !reviewFocus ? <article className={`${styles.card} ${styles.outcomeCard}`}><p className={styles.kicker}>AWARD &amp; DELIVERY CONTINUITY</p><h3>Record the customer award separately</h3><p>An approved offer is not an award. The customer response stays tied to the submitted revision; the same Work Record continues after an award.</p><div className={styles.buttonRow}><button className="d5o-outline" onClick={() => setDrawer(controlledCommercial ? "response" : "outcome")} disabled={proposal.status !== "Submitted" || commercialBusy || !!discovery.outcome}>Record customer outcome</button><button className="d5o-outline" onClick={() => onOpen(selected)}>View full history →</button></div></article> : null}
          {isDevelop && !reviewFocus && controlledCommercial && discovery.outcome === "Won" ? <article className={`${styles.card} ${styles.outcomeCard}`}><p className={styles.kicker}>D3 → D4 · RECEIVING CONTROL</p><h3>Design handoff</h3><p>{handoff?.status === "accepted" ? `Revision ${handoff.revision} accepted by ${handoff.decidedBy}. Design can plan executable packages; release remains separate.` : handoff?.status === "submitted" ? `Revision ${handoff.revision} awaits a different signed-in Design receiver. Due ${dateLabel(handoff.responseDueDate)}.` : handoff?.status === "returned" ? `Revision ${handoff.revision} was returned. Correct the brief and resubmit it.` : "The customer award is recorded. Send the approved scope, acceptance basis and offer to a Design receiver for acceptance."}</p><div className={styles.buttonRow}><button className="d5o-primary" onClick={() => setHandoffOpen(true)} disabled={commercialBusy}>{handoff?.status === "accepted" ? "View accepted handoff" : handoff?.status === "submitted" ? "Review Design handoff" : "Prepare Design handoff"}</button>{handoff?.status === "accepted" ? <button className="d5o-outline" onClick={() => onPhase(selected, "Design")}>Open Design →</button> : null}</div></article> : null}
        </div>
      </section> : selectedOutsideDevelop ? null : <section className={styles.emptyDetail}><h2>{awaitingIntake ? "Start Discover on this Work Record" : "Select a Work Record"}</h2><p>{awaitingIntake ? `${awaitingIntake.title} has its stable identity and pinned configuration, but no customer-need intake yet. Capture the need here without creating another Work Record.` : `Choose work from the pipeline to review its ${isDevelop ? "received Define basis, solution, estimate and customer decision" : "qualification and Define handoff"}.`}</p>{awaitingIntake && canEdit ? <button className="d5o-primary" onClick={() => setDrawer("capture")}>Complete D1 intake</button> : null}</section>}
    </div>
    {drawer ? <div className={styles.scrim} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDrawer(null); }}><section className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="discover-drawer-title"><header><div><p className={styles.kicker}>{isDevelop ? "DEVELOP" : "DISCOVER"} · {drawer === "capture" ? awaitingIntake ? "EXISTING WORK RECORD" : "NEW WORK RECORD" : drawer === "response" ? "CUSTOMER RESPONSE" : "CUSTOMER OUTCOME"}</p><h2 id="discover-drawer-title">{drawer === "capture" ? "Capture customer need" : drawer === "response" ? "Record customer response" : "Record customer outcome"}</h2></div><button aria-label="Close" onClick={() => setDrawer(null)}>×</button></header>
      {drawer === "capture" ? <form onSubmit={capture} className={styles.drawerForm}><p className={styles.hint}>Published phase form: {captureConfig?.version ?? "Unavailable"}. {awaitingIntake ? "The existing Work Record keeps its exact pinned version." : "New work retains this exact version when captured."}</p>{awaitingIntake ? <p className={styles.need}>{awaitingIntake.title} · {awaitingIntake.customer} · {awaitingIntake.type}</p> : <><label>Work Record name<input name="title" required placeholder="e.g. Regional controls modernization" /></label><label>Customer / account<input name="customer" required placeholder="Customer name" /></label><label>Site / location<input name="site" placeholder="Site, facility or region" /></label><label>Work Type<select name="type" value={captureType} onChange={(event) => setCaptureType(event.target.value)}>{availableTypes.map((type) => <option key={type}>{type}</option>)}</select></label></>}<label>{captureComponent("customer_need")?.fields?.[0]?.label ?? "Customer need"}<textarea name="need" required placeholder={captureComponent("customer_need")?.help ?? "What outcome does the customer need, and why now?"} rows={3} /></label><div className={styles.drawerTwo}><label>{captureField("demand_source", "source")?.label ?? "Source"}<select name="source">{sourceOptions.map((option) => <option key={option}>{option}</option>)}</select></label><label>{captureField("demand_source", "procurement")?.label ?? "Procurement route"}<select name="procurement">{procurementOptions.map((option) => <option key={option}>{option}</option>)}</select></label></div><div className={styles.drawerTwo}>{!awaitingIntake ? <label>Accountable owner<input name="owner" defaultValue="Unassigned" /></label> : null}<label>{captureField("demand_source", "closeDate")?.label ?? "Target decision date"}<input name="closeDate" type="date" /></label></div><footer><button type="button" className="d5o-outline" onClick={() => setDrawer(null)}>Cancel</button><button className="d5o-primary" disabled={!canEdit || !captureConfig || (!awaitingIntake && !availableTypes.length)}>{awaitingIntake ? "Save intake on this Work Record" : "Create Work Record"}</button></footer></form> : drawer === "response" ? <form onSubmit={recordCustomerResponse} className={styles.drawerForm}><p className={styles.need}>{selected?.title} · {selected?.customer} · Proposal revision {proposal?.submission?.revision}</p><label>Customer response<select name="responseStatus"><option>Clarification requested</option><option>Commercial negotiation</option><option>Decision deferred</option><option>Awarded</option><option>Not awarded</option></select></label><label>Date received<input type="date" name="receivedAt" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><label>What did the customer say?<textarea name="details" required rows={4} placeholder="Capture the response, conditions, requested changes, or award basis." /></label><label>Customer response source<input name="sourceReference" placeholder="Award letter, procurement reference, or correspondence ID (required for award/decline)" /></label><div className={styles.drawerTwo}><label>Next action<input name="nextAction" placeholder="e.g. Return revised delivery schedule" /></label><label>Follow-up due<input name="followUpDue" type="date" /></label></div><small className={styles.hint}>Clarification, negotiation, and deferred-decision responses require a next action and due date. An award advances this Work Record to authorization; a decline closes the pursuit.</small><footer><button type="button" className="d5o-outline" onClick={() => setDrawer(null)}>Cancel</button><button className="d5o-primary" disabled={commercialBusy}>Save customer response</button></footer></form> : <form onSubmit={saveOutcome} className={styles.drawerForm}><p className={styles.need}>{selected?.title} · {selected?.customer}</p><label>Customer outcome<select name="outcome"><option>Won</option><option>Lost</option><option>No bid</option></select></label><label>Decision basis / learning<textarea name="note" rows={4} placeholder="Record the reason, conditions, or learning." /></label><footer><button type="button" className="d5o-outline" onClick={() => setDrawer(null)}>Cancel</button><button className="d5o-primary">Save outcome</button></footer></form>}
      </section></div> : null}
    {["design-handoff-receive", "design-handoff-correction"].includes(reviewFocus ?? "") ? <article className={styles.card}><h3>Exact awarded Design basis</h3>{designHandoffDrawer}</article> : null}
    {handoffOpen ? <div className={styles.scrim} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHandoffOpen(false); }}><section className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="design-handoff-title"><header><div><p className={styles.kicker}>DEVELOP · AWARD HANDOFF</p><h2 id="design-handoff-title">Design receiving decision</h2></div><button aria-label="Close Design handoff" onClick={() => setHandoffOpen(false)}>×</button></header>{designHandoffDrawer}</section></div> : null}
  </main>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <article className={styles.metric}><small>{label}</small><strong>{value}</strong><span>{note}</span></article>; }
function Identity({ label, value, detail }: { label: string; value: string; detail: string }) { return <div><small>{label}</small><strong>{value}</strong><span>{detail}</span></div>; }
function Fact({ label, value }: { label: string; value: string }) { return <div><small>{label}</small><strong>{value}</strong></div>; }
function NumberField({ label, name, value }: { label: string; name: string; value: number }) { return <label className={styles.field}>{label}<input type="number" min="0" step="0.01" name={name} defaultValue={value} /></label>; }


