"use client";

import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CrewPlanningBoard } from "./CrewPlanningBoard";
import { PortfolioBoard } from "./PortfolioBoard";
import { HandoffControlBoard } from "./HandoffControlBoard";
import { ExecutionFactsBoard } from "./ExecutionFactsBoard";
import { WorkspaceStudio } from "./WorkspaceStudio";
import { DecisionBoard } from "./DecisionBoard";
import type { DecisionQueueContext } from "./decision-queue-context";
import { PeopleCapacityBoard } from "./PeopleCapacityBoard";
import { MemberAccessPanel } from "./MemberAccessPanel";
import { EvidenceLibrary } from "./EvidenceLibrary";
import { PlatformIcon, type PlatformIconName } from "./PlatformIcon";
import { PlatformWordmark } from "./PlatformWordmark";
import { AccountMenu } from "./AccountMenu";
import { contrastText, previewAccent } from "./theme";
import { OperationalHome } from "./OperationalHome";
import { connectedWorkPosition } from "./connected-work-position";
import { actionDueLabel, actionImpactLabel, compareActionPriority, type ActionImpact } from "./action-priority";
import { MyWorkBoard } from "./MyWorkBoard";
import { applyAvailability, currentScheduleWeek, initialAvailabilityBlocks, peopleProfiles, scheduleRequirement, shiftHours, type Assignment, type CrewDemandSlot, type PackageCrewDemand, type PersonProfile, type SharedSchedule } from "./schedule-model";
import { useSharedSchedule } from "./useSharedSchedule";
import { useWorkforce } from "./useWorkforce";
import { useSharedWorkCatalog } from "./useSharedWorkCatalog";
import { seededWorkIds, type CatalogWorkRecord, type SharedWorkCatalog } from "./work-catalog-model";
import { downloadPrototypeSnapshot } from "./prototype-state-export";
import { lifecycleProfiles, requirementLabel, roleLabel, transitionsAt } from "./lifecycle-profiles";
import { DiscoverWorkspace } from "./DiscoverWorkspace";
import type { PursuitCommand } from "./pursuit-control";
import type { CommercialCommand } from "@/lib/d5o/prototype-work/commercial-command";
import type { DefineCommand } from "@/lib/d5o/prototype-work/define-command";
import type { DesignCommand } from "@/lib/d5o/prototype-work/design-command";
import type { DeployCommand } from "@/lib/d5o/prototype-work/deploy-command";
import type { OperateCommand } from "@/lib/d5o/prototype-work/operate-command";
import type { DesignState } from "./design-model";
import { DesignWorkspace } from "./DesignWorkspace";
import { DeployWorkspace } from "./DeployWorkspace";
import { FieldChangeControl } from "./FieldChangeControl";
import { currentAcceptedRelease } from "./deploy-model";
import { OperateWorkspace, type OperateTab } from "./OperateWorkspace";
import { OperateBoard } from "./OperateBoard";
import { legacyOperateControlPolicy } from "./operate-policy";
import { DefineWorkspace } from "./DefineWorkspace";
import { WorkRecordSwitcher } from "./WorkRecordSwitcher";
import type { DefinitionRecord, DiscoveryRecord, WorkRecord } from "./work-types";
import { syntheticDemoCommercialProfiles, type CommercialAuthorityProfile } from "./commercial-authority";
import visualSystem from "./D5OVisualSystem.module.css";
import type { ConfigurationInventory } from "@/lib/d5o/configuration/version-inventory";
import { activePhaseConfigurationVersion, phaseContractFromManifest } from "./published-phase-configuration";
import { resolvePublishedPhaseConfiguration } from "./published-phase-configuration";
import { decisionCheckPhase, decisionCheckResults, type DecisionCheck, type PhaseKey, type WorkTypeConfiguration } from "./phase-configuration";
import { currentPrototypeTransition, transitionBlockers, transitionPolicies } from "./work-condition";
import { WorkPhaseActions } from "./WorkPhaseActions";
import { PhaseResourceBridge } from "./PhaseResourceBridge";
import { WorkPhaseJourney, type WorkPhase, type WorkControl } from "./WorkPhaseJourney";
import { canPresentSurface, presentationForRole } from "./role-presentation";

type WorkspaceKey = "rybex" | "rotork";
type Screen = "discover" | "define" | "develop" | "operate" | "home" | "my-work" | "portfolio" | "decisions" | "crew" | "people" | "execution" | "handoff" | "library" | "insights" | "operating" | "configuration" | "start" | "record";
type RecordTab = "Overview" | "Lifecycle" | "Develop" | "Design" | "Deploy" | "Operate" | "Plan" | "Readiness" | "Execution" | "Issues & changes" | "Evidence" | "Commercial" | "Handoff" | "Lifecycle Value" | "History";
type WorkPackage = { id: string; name: string; owner: string; installed: number; tested: number; accepted: number; status: "planned" | "in progress" | "ready" | "accepted"; acceptanceBasis?: string };
type EvidenceItem = { id: string; name: string; kind: string; state: "draft" | "verified" | "accepted"; added: string; source?: string; reviewNote?: string; reviewedAt?: string; packageId?: string };
type ControlledIssue = { id: string; title: string; impact: string; owner: string; status: "open" | "resolved"; created: string; blocker?: string; resolution?: string; proofId?: string; requiredProofKind?: string; affectedPackageId?: string; allowsException?: boolean; exceptionAuthority?: string; authorityBasis?: string };
type LifecycleAction = { id: string; action: string; owner: string; due: string; status: "planned" | "active" };
type Work = {
  id: string; canonicalWorkId?: string; workspace: WorkspaceKey; title: string; type: string; customer: string; site: string; stage: string; owner: string;
  nextAction: string; progress: number; value: string; status: "attention" | "moving" | "complete"; proof: string[]; blockers: string[]; history: string[]; issue?: string;
  nextActionDue?: string | null; nextActionImpact?: ActionImpact | null;
  heldFrom?: string; heldNextAction?: string; heldNextActionDue?: string | null; heldNextActionImpact?: ActionImpact | null;
  packages?: WorkPackage[]; evidence?: EvidenceItem[]; issues?: ControlledIssue[]; lifecycle?: LifecycleAction[]; commercial?: { condition: string; amount: string; confidence: string };
  discovery?: DiscoveryRecord;
  definition?: DefinitionRecord;
  develop?: WorkRecord["develop"];
  design?: DesignState;
  deploy?: WorkRecord["deploy"];
  operate?: WorkRecord["operate"];
  serviceSource?: WorkRecord["serviceSource"];
  serviceExecutionBasis?: WorkRecord["serviceExecutionBasis"];
  phaseConfigurationVersionId?: string;
  phaseRegisters?: Record<string, Array<Record<string, string>>>;
  prototypeDecisionRights?: string[];
};

const seed: Work[] = [
  { id: "rybex-1", workspace: "rybex", title: "North Campus Data Hall Turnover", type: "Technical delivery", customer: "North Campus Properties", site: "DC-2 · Ashburn", stage: "Quality verification", owner: "Shawn · Quality lead", nextAction: "Verify certification results", nextActionDue: "2026-10-06", nextActionImpact: "Critical", progress: 72, value: "$680k contracted delivery", status: "attention", proof: ["Installation quantities confirmed", "Certification results captured", "Turnover pack assembled"], blockers: ["One fibre-trunk result requires retest or an authorized exception"], history: ["Testing package submitted", "Rybex quality review started", "Nonconformance isolated to fibre trunk FT-24"], issue: "FT-24 failed certification; remediation is assigned." },
  { id: "rybex-2", workspace: "rybex", title: "West Wing Network Retrofit", type: "Technical delivery", customer: "North Campus Properties", site: "DC-1 · Ashburn", stage: "Customer acceptance", owner: "Maya · Project manager", nextAction: "Record owner acceptance", nextActionDue: "2026-10-09", nextActionImpact: "High", progress: 92, value: "$240k turnover value", status: "moving", proof: ["Installed quantities accepted", "Test records verified", "Turnover pack complete"], blockers: [], history: ["Internal quality verification complete", "Turnover package issued" ] },
  { id: "rybex-3", workspace: "rybex", title: "Generator Monitoring Upgrade", type: "Lifecycle service", customer: "North Campus Properties", site: "DC-3 · Manassas", stage: "Planning", owner: "Liam · Delivery manager", nextAction: "Confirm work package plan", nextActionDue: "2026-10-08", nextActionImpact: "Standard", progress: 28, value: "$90k recurring service", status: "moving", proof: ["Assessment complete"], blockers: [], history: ["Work Record started", "Assessment linked" ] },
  { id: "rotork-1", workspace: "rotork", title: "Offshore Actuator Modernization", type: "Modernization service", customer: "North Sea Energy", site: "Platform Delta", stage: "Pilot review", owner: "Shawn · Pilot reviewer", nextAction: "Review pilot outcome", nextActionDue: "2026-10-07", nextActionImpact: "Critical", progress: 56, value: "$1.2m rollout opportunity", status: "attention", proof: ["Assessment completed", "Paid pilot authorized", "Pilot evidence captured"], blockers: ["Pilot outcome has not been recorded"], history: ["Assessment completed", "Paid pilot authorized", "Pilot evidence submitted" ] },
  { id: "rotork-2", workspace: "rotork", title: "Valve Reliability Pilot", type: "Lifecycle service", customer: "Midland Process", site: "Unit 4", stage: "Commercial readiness", owner: "Anika · Commercial lead", nextAction: "Confirm commercial conditions", nextActionDue: "2026-10-09", nextActionImpact: "High", progress: 68, value: "$420k annual service value", status: "moving", proof: ["Pilot outcome reviewed", "Service baseline prepared"], blockers: [], history: ["Pilot completed", "Pilot review recorded" ] },
  { id: "rotork-3", workspace: "rotork", title: "Terminal Control Upgrade", type: "Modernization service", customer: "Harbor Terminals", site: "Bay 7", stage: "Rollout authorized", owner: "Derek · Service director", nextAction: "Open rollout tranche", progress: 86, value: "$2.4m program value", status: "complete", proof: ["Rollout authority recorded", "Commercial conditions confirmed"], blockers: [], history: ["Pilot outcome accepted", "Rollout authorization recorded" ] }
];

const workspace = {
  rybex: { name: "Rybex Delivery", short: "Rybex", color: "#D4AF37", dark: "#102A43", user: "Shawn · Quality lead", story: "Technical delivery and controlled turnover" },
  rotork: { name: "Rotork Lifecycle Service", short: "Rotork", color: "#C8102E", dark: "#171717", user: "Shawn · Pilot reviewer", story: "Modernization, rollout and lifecycle service" }
} as const;
const defaultWorkTypes: Record<WorkspaceKey, string[]> = { rybex: ["Technical delivery", "Retrofit", "Controlled work package", "Lifecycle service"], rotork: ["Assessment", "Modernization service", "Paid pilot", "Rollout tranche", "Lifecycle service"] };
function conditionTargetTab(item: Work, blockers = transitionBlockers(item)): RecordTab {
  if ((item.issues ?? []).some((issue) => issue.status === "open") || item.stage === "Held for resolution") return "Issues & changes";
  const unmet = blockers.join(" ").toLowerCase();
  if (/solution option|feasible solution/.test(unmet)) return "Develop";
  if (/verification plan|controlled work package|pilot work package/.test(unmet)) return "Design";
  if (/receiving obligation|lifecycle action/.test(unmet)) return "Operate";
  if (unmet.includes("package")) return "Deploy";
  if (unmet.includes("commercial")) return "Commercial";
  if (unmet.includes("proof") || unmet.includes("evidence") || unmet.includes("reviewed") || unmet.includes("acceptance record")) return "Evidence";
  return "Readiness";
}

function phaseSurfaceForCheck(check: DecisionCheck): RecordTab {
  if (check.surface !== "Plan") return check.surface;
  return decisionCheckPhase(check) === "develop" ? "Develop" : "Design";
}

const tabs: RecordTab[] = ["Overview", "Lifecycle", "Readiness", "Issues & changes", "Evidence", "Commercial", "Lifecycle Value", "History"];
const durableRecordTabs = new Set<RecordTab>([...tabs, "Develop", "Design", "Deploy", "Operate", "Plan", "Execution", "Handoff"]);
const durableScreens = new Set<Screen>(["discover", "define", "develop", "operate", "home", "my-work", "portfolio", "decisions", "crew", "people", "execution", "handoff", "library", "insights", "operating", "configuration", "start", "record"]);
const phaseTabs: RecordTab[] = ["Develop", "Design", "Deploy", "Operate"];
const lifecycleStages = ["Intake & Shape", "Plan", "Authorize & Readiness", "Execute & Control", "Verify & Handoff", "Close & Lifecycle"];
const operatingNavigation: { screen: Screen; label: string; icon: PlatformIconName }[] = [
  { screen: "discover", label: "Discover", icon: "discover" },
  { screen: "define", label: "Define", icon: "model" },
  { screen: "home", label: "Work hub", icon: "hub" },
  { screen: "my-work", label: "My work", icon: "inbox" },
  { screen: "portfolio", label: "Portfolio", icon: "portfolio" },
  { screen: "decisions", label: "Decision queue", icon: "decision" },
  { screen: "crew", label: "Crew schedule", icon: "calendar" },
  { screen: "people", label: "People & capacity", icon: "people" },
  { screen: "execution", label: "Execution register", icon: "execution" },
  { screen: "handoff", label: "Handoff register", icon: "handoff" },
  { screen: "library", label: "Evidence library", icon: "evidence" },
  { screen: "insights", label: "Operating insight", icon: "insight" }
];
const designNavigation: { screen: Screen; label: string; icon: PlatformIconName }[] = [
  { screen: "operating", label: "Operating model", icon: "model" },
  { screen: "configuration", label: "Workspace configuration", icon: "settings" },
  { screen: "start", label: "Start work", icon: "plus" }
];
const label = (value: string) => value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const stamp = () => new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function initialDiscovery(work: Work): DiscoveryRecord | undefined {
  if (work.workspace === "rybex" && /generator monitoring upgrade/i.test(work.title)) return { source: "Existing customer", need: "Extend generator monitoring across the DC-3 plant and convert the site assessment into a supportable service scope.", procurement: "Framework / call-off", phase: "Estimate", fit: "Qualified", closeDate: "2026-10-22", estimate: { revision: 1, labor: 32000, materials: 14000, subcontract: 5000, travel: 3000, contingency: 6000, targetMargin: 33.3, sellPrice: 90000, status: "Draft", assumption: "Indicative estimate pending engineering review; final monitoring points subject to site survey." }, proposal: { status: "Not started", dueDate: "2026-10-22", method: "Customer portal", recipient: "", response: "" } };
  if (work.workspace === "rotork" && /offshore actuator modernization/i.test(work.title)) return { source: "Service assessment", need: "Modernize offshore actuator controls, prove reliability improvements in a paid pilot, then authorize the rollout tranche.", procurement: "Paid pilot", phase: "Validation", fit: "Qualified", closeDate: "2026-10-21", estimate: { revision: 2, labor: 390000, materials: 230000, subcontract: 40000, travel: 30000, contingency: 40000, targetMargin: 39.2, sellPrice: 1200000, status: "Approved", assumption: "Pilot evidence submitted; rollout price remains subject to pilot review and site-by-site confirmation." }, proposal: { status: "Submitted", dueDate: "2026-10-21", method: "Direct presentation", recipient: "North Sea Energy", response: "Pilot review pending" } };
  if (work.workspace === "rotork" && /valve reliability pilot/i.test(work.title)) return { source: "Existing customer", need: "Convert the completed valve reliability pilot into a recurring service plan with measurable availability outcomes.", procurement: "Renewal", phase: "Pricing review", fit: "Qualified", closeDate: "2026-10-29", estimate: { revision: 1, labor: 170000, materials: 140000, subcontract: 45000, travel: 20000, contingency: 45000, targetMargin: 0, sellPrice: 420000, status: "Pricing review", assumption: "Annual service value; final commercial conditions are under review." }, proposal: { status: "Draft", dueDate: "2026-10-29", method: "Email", recipient: "Midland Process", response: "" } };
  return undefined;
}
function hydrate(work: Work): Work {
  const original = seed.find((entry) => entry.id === work.id && entry.nextAction === work.nextAction);
  const evidence = work.evidence ?? work.proof.map((name, index) => ({ id: `e-${index}-${work.id}`, name, kind: index === 0 ? "Work fact" : "Proof package", state: index === work.proof.length - 1 ? "accepted" as const : "verified" as const, added: "Baseline", packageId: work.id === "rybex-1" ? index === 1 ? "wp-fibre-rybex-1" : index === 2 ? "wp-turnover-rybex-1" : undefined : work.id === "rotork-1" && index === 2 ? "wp-pilot-rotork-1" : undefined }));
  const issues = work.issues?.map((entry) => entry.id === `i-${work.id}` ? { ...entry, blocker: entry.blocker ?? work.blockers[0] ?? entry.title, requiredProofKind: entry.requiredProofKind ?? "Test result", affectedPackageId: entry.affectedPackageId ?? (work.id === "rybex-1" ? "wp-fibre-rybex-1" : undefined), allowsException: entry.allowsException ?? work.workspace === "rybex" } : entry) ?? (work.issue ? [{ id: `i-${work.id}`, title: work.issue, impact: "Acceptance cannot proceed until the condition is controlled.", owner: work.owner, status: "open" as const, created: "Baseline", blocker: work.blockers[0] ?? work.issue, requiredProofKind: "Test result", affectedPackageId: work.id === "rybex-1" ? "wp-fibre-rybex-1" : undefined, allowsException: work.workspace === "rybex" }] : []);
  const obsoletePlanningPackages = work.id === "rybex-3" && work.packages?.length === 3 && work.packages.every((item) => item.status === "accepted" && item.accepted === 100 && ["Fiber trunks and termination", "Copper management-network cabling", "Certification and turnover package"].includes(item.name));
  const isSeedRecord = seededWorkIds[work.workspace].includes(work.id);
  const inheritedPackageIds = work.workspace === "rybex" ? ["fibre", "copper", "turnover"] : ["assessment", "pilot", "rollout"];
  const authoredPackages = !isSeedRecord ? work.packages?.filter((item) => !inheritedPackageIds.some((kind) => item.id === `wp-${kind}-${work.id}`)) : work.packages;
  const packages = (obsoletePlanningPackages ? undefined : authoredPackages) ?? (!isSeedRecord ? [] : work.id === "rybex-3" ? [
    { id: `wp-monitoring-${work.id}`, name: "Monitoring equipment and site survey", owner: "Delivery manager", installed: 0, tested: 0, accepted: 0, status: "planned" as const },
    { id: `wp-service-${work.id}`, name: "Service integration plan", owner: "Lifecycle service lead", installed: 0, tested: 0, accepted: 0, status: "planned" as const }
  ] : work.workspace === "rybex" ? [
    { id: `wp-fibre-${work.id}`, name: "Fiber trunks and termination", owner: "Delivery lead", installed: 100, tested: work.id === "rybex-1" ? 92 : 100, accepted: work.id === "rybex-1" ? 72 : 100, status: work.id === "rybex-1" ? "ready" as const : "accepted" as const },
    { id: `wp-copper-${work.id}`, name: "Copper management-network cabling", owner: "Field supervisor", installed: 100, tested: 100, accepted: 100, status: "accepted" as const },
    { id: `wp-turnover-${work.id}`, name: "Certification and turnover package", owner: "Quality lead", installed: 100, tested: 100, accepted: work.id === "rybex-1" ? 60 : 100, status: work.id === "rybex-1" ? "ready" as const : "accepted" as const }
  ] : [
    { id: `wp-assessment-${work.id}`, name: "Assessment and modernization case", owner: "Service engineering", installed: 100, tested: 100, accepted: 100, status: "accepted" as const },
    { id: `wp-pilot-${work.id}`, name: "Paid pilot delivery", owner: "Pilot delivery lead", installed: 100, tested: 100, accepted: work.id === "rotork-1" ? 70 : 100, status: work.id === "rotork-1" ? "ready" as const : "accepted" as const },
    { id: `wp-rollout-${work.id}`, name: "Rollout authorization package", owner: "Commercial lead", installed: work.id === "rotork-3" ? 100 : 35, tested: work.id === "rotork-3" ? 100 : 0, accepted: work.id === "rotork-3" ? 100 : 0, status: work.id === "rotork-3" ? "accepted" as const : "planned" as const }
  ]);
  const lifecycle = work.lifecycle ?? (!isSeedRecord ? [] : work.workspace === "rybex" ? [{ id: `l-${work.id}`, action: "90-day post-handoff inspection", owner: "Lifecycle service manager", due: "After acceptance", status: "planned" as const }] : [{ id: `l-${work.id}`, action: "Establish lifecycle service monitoring", owner: "Service success manager", due: "After rollout authorization", status: "planned" as const }]);
  const rawDiscovery = work.discovery ?? initialDiscovery(work);
  const discovery = rawDiscovery?.estimate.status === "Pricing review" ? { ...rawDiscovery, estimate: { ...rawDiscovery.estimate, review: rawDiscovery.estimate.review ?? { revision: rawDiscovery.estimate.revision, submittedAt: "2026-10-05T09:00:00.000Z", submittedBy: "Commercial lead", dueDate: "2026-10-08" } } } : rawDiscovery;
  const pricingPending = discovery?.estimate.status === "Pricing review" && discovery.estimate.review?.revision === discovery.estimate.revision;
  const pricingDueDate = pricingPending ? discovery.estimate.review?.dueDate ?? null : null;
  return { ...work, owner: pricingPending ? "Pricing authority · workspace role" : work.owner, nextAction: pricingPending ? `Review estimate revision ${discovery.estimate.revision}` : work.nextAction, nextActionDue: pricingPending ? pricingDueDate : work.nextActionDue === undefined ? original?.nextActionDue : work.nextActionDue, nextActionImpact: pricingPending ? "High" : work.nextActionImpact === undefined ? original?.nextActionImpact : work.nextActionImpact, evidence, issues, packages, lifecycle, commercial: work.commercial ?? { condition: work.workspace === "rybex" ? "Contracted delivery scope" : "Commercial readiness to be confirmed", amount: work.value, confidence: work.status === "complete" ? "Committed" : "Under review" }, discovery };
}

function mergeSharedWork(local: Work[], catalog: SharedWorkCatalog): Work[] {
  const merged = [...local];
  let changed = false;
  for (const record of catalog.records) {
    if (!merged.some((item) => item.id === record.id)) { merged.push(hydrate(record)); changed = true; }
  }
  for (const workPackage of catalog.packages) {
    const index = merged.findIndex((item) => item.id === workPackage.workId && item.workspace === catalog.workspace);
    if (index < 0) continue;
    const parent = merged[index];
    if (!(parent.packages ?? []).some((item) => item.id === workPackage.id)) {
      merged[index] = { ...parent, packages: [...(parent.packages ?? []), workPackage] };
      changed = true;
    }
  }
  return changed ? merged : local;
}

export function D5OPlatform({ initialWorkspace, configurationInventory, actorLabel, actorRole, actorId, hostedPreview = false, authoritativeCommands = false, sourceVersion = "source-unidentified" }: { initialWorkspace: WorkspaceKey; configurationInventory: ConfigurationInventory; actorLabel?: string; actorRole?: string; actorId?: string; hostedPreview?: boolean; authoritativeCommands?: boolean; sourceVersion?: string }) {
  const [activeWorkspace] = useState<WorkspaceKey>(initialWorkspace);
  const [accent, setAccent] = useState<string>(workspace[initialWorkspace].color);
  const [workspaceDark, setWorkspaceDark] = useState<string>(workspace[initialWorkspace].dark);
  const [configuredTypes, setConfiguredTypes] = useState<string[]>(defaultWorkTypes[initialWorkspace]);
  const publishedStartTypes = useMemo(() => {
    if (configurationInventory.status !== "ready") return [];
    const active = configurationInventory.versions.find((item) => item.id === configurationInventory.activeVersionId);
    return phaseContractFromManifest(active?.config_manifest_json, initialWorkspace)?.workTypes.map((item) => item.workTypeLabel) ?? [];
  }, [configurationInventory, initialWorkspace]);
  const [commercialProfiles, setCommercialProfiles] = useState<CommercialAuthorityProfile[]>(syntheticDemoCommercialProfiles[initialWorkspace]);
  const [commercialPolicyInitialized, setCommercialPolicyInitialized] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const presentation = presentationForRole(actorRole, hostedPreview);
  const [screen, setScreen] = useState<Screen>(hostedPreview ? "my-work" : "home");
  const [urlRestored, setUrlRestored] = useState(false);
  const [unavailableRecordId, setUnavailableRecordId] = useState<string | null>(null);
  const [recordReturn, setRecordReturn] = useState<Exclude<Screen, "record">>("portfolio");
  const [myWorkEntry, setMyWorkEntry] = useState<"all" | "mine" | "pricing" | "proposal" | "definition">("all");
  const [discoverEntry, setDiscoverEntry] = useState<"pricing" | "proposal" | "solution-prep" | "solution-review" | "pricing-prep" | "proposal-prep" | "customer-submission-prep" | "design-handoff-receive" | "design-handoff-correction" | "pursuit-prep" | "pursuit-review" | "define-handoff-prep" | "define-handoff-receive" | null>(null);
  const [defineReviewEntry, setDefineReviewEntry] = useState<"commercial" | "delivery" | "define-prep" | "develop-handoff-prep" | "develop-handoff-receive" | null>(null);
  const [crewEntry, setCrewEntry] = useState<"coverage" | "attendance" | null>(null);
  const [crewFocusWorkId, setCrewFocusWorkId] = useState<string | null>(null);
  const [taskFocus, setTaskFocus] = useState<string | null>(null);
  const [taskPackageId, setTaskPackageId] = useState<string | null>(null);
  const [taskRequestId, setTaskRequestId] = useState<string | null>(null);
  const [taskRevision, setTaskRevision] = useState<number | null>(null);
  const [stalePreparationLink, setStalePreparationLink] = useState(false);
  const [work, setWork] = useState<Work[]>(() => hostedPreview ? [] : seed.map(hydrate));
  const [workLoaded, setWorkLoaded] = useState(false);
  const [canEditWork, setCanEditWork] = useState(false);
  const [sharedWorkRevision, setSharedWorkRevision] = useState<number | null>(null);
  const lastSharedWork = useRef("");
  const workSaveInFlight = useRef(false);
  const pendingDiscoverSave = useRef<string | null>(null);
  const pendingReviewQueue = useRef<"pricing" | "proposal" | "definition" | null>(null);
  const sharedWorkRevisionRef = useRef<number | null>(null);
  const pendingOperateCommand = useRef<{ fingerprint: string; commandId: string; expectedRevision: number } | null>(null);
  const [selectedId, setSelectedId] = useState("rotork-1");
  const [tab, setTab] = useState<RecordTab>("Overview");
  const [operateFocus, setOperateFocus] = useState<{ workId: string; section: OperateTab } | null>(null);
  const [notice, setNotice] = useState("");
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [portfolioSearch, setPortfolioSearch] = useState("");
  const [portfolioFilter, setPortfolioFilter] = useState<"all" | "blocked" | "attention" | "moving" | "complete">("all");
  const sharedSchedule = useSharedSchedule(initialWorkspace, hostedPreview);
  const workforce = useWorkforce(initialWorkspace, hostedPreview && authoritativeCommands);
  const [ownedWorkIds, setOwnedWorkIds] = useState<string[] | null>(null);
  useEffect(() => {
    if (!hostedPreview || !authoritativeCommands) return;
    const controller = new AbortController();
    void fetch(`/api/d5o-hosted/prototype-search?workspace=${initialWorkspace}&view=actions&filter=all`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { ownedIds?: string[] } | null) => { if (!controller.signal.aborted) setOwnedWorkIds(data?.ownedIds ?? []); })
      .catch(() => { if (!controller.signal.aborted) setOwnedWorkIds([]); });
    return () => controller.abort();
  }, [hostedPreview, authoritativeCommands, initialWorkspace]);
  const sharedWork = useSharedWorkCatalog(initialWorkspace, hostedPreview);
  const workStateEndpoint = hostedPreview
    ? `/api/d5o-hosted/prototype-state?workspace=${encodeURIComponent(initialWorkspace)}&key=work`
    : "/api/work/prototype-state";
  const scheduleAssignments = sharedSchedule.schedule?.assignments ?? [];
  const availabilityBlocks = sharedSchedule.schedule?.availabilityBlocks ?? initialAvailabilityBlocks[initialWorkspace];
  const scheduleWeek = sharedSchedule.schedule ? currentScheduleWeek(sharedSchedule.schedule.anchorDate) : 0;

  useEffect(() => {
    let active = true;
    const restore = async () => {
      let restored = hostedPreview ? [] : seed.filter((record) => record.workspace === initialWorkspace).map(hydrate);
      let revision: number | null = null;
      let fromShared = false;
      try {
        const response = await fetch(workStateEndpoint, { cache: "no-store" });
        if (response.ok) {
          const payload = await response.json() as { state?: { revision: number; records: Work[] }; canEdit?: boolean };
          if (active) setCanEditWork(payload.canEdit === true);
          if (payload.state && Array.isArray(payload.state.records)) {
            revision = payload.state.revision;
            restored = payload.state.records.map(hydrate);
            fromShared = true;
          } else if (hostedPreview && response.ok) revision = 0;
        }
      } catch { /* The browser-local copy remains a usable offline fallback. */ }
      if (!fromShared && !hostedPreview) {
        try {
          const saved = localStorage.getItem(`d5o.full-prototype.v3:${initialWorkspace}`);
          if (saved) {
            const parsed = JSON.parse(saved) as { work?: Work[] };
            if (Array.isArray(parsed.work)) restored = parsed.work.map(hydrate);
          }
        } catch { /* Seed data remains available without browser storage. */ }
      }
      if (!active) return;
      const serialized = JSON.stringify(restored);
      // Hosted work is always projected from the server, including an empty workspace.
      // Never import bundled demonstration rows through a hosted draft save.
      lastSharedWork.current = fromShared || hostedPreview ? serialized : "";
      sharedWorkRevisionRef.current = revision;
      setSharedWorkRevision(revision);
      setWork(restored);
      setWorkLoaded(true);
    };
    void restore();
    return () => { active = false; };
  }, [initialWorkspace, hostedPreview, workStateEndpoint]);

  useEffect(() => {
    let savedAccent: string = workspace[initialWorkspace].color;
    let savedFoundation: string = workspace[initialWorkspace].dark;
    let savedTypes = defaultWorkTypes[initialWorkspace];
    let savedCommercialProfiles: CommercialAuthorityProfile[] = syntheticDemoCommercialProfiles[initialWorkspace];
    let savedCommercialPolicyInitialized = true;
    try {
      const saved = localStorage.getItem(`d5o.workspace-preferences.v1:${initialWorkspace}`);
      if (saved) {
        const parsed = JSON.parse(saved) as { accent?: string; foundation?: string; workTypes?: string[]; commercialProfiles?: CommercialAuthorityProfile[]; commercialPolicyInitialized?: boolean };
        if (parsed.accent && /^#[0-9a-f]{6}$/i.test(parsed.accent)) savedAccent = parsed.accent;
        if (parsed.foundation && /^#[0-9a-f]{6}$/i.test(parsed.foundation)) savedFoundation = parsed.foundation;
        if (Array.isArray(parsed.workTypes) && parsed.workTypes.length) savedTypes = parsed.workTypes.filter((item) => typeof item === "string");
        if (Array.isArray(parsed.commercialProfiles)) {
          const validProfiles = parsed.commercialProfiles.filter((item) => item && typeof item.id === "string" && typeof item.role === "string" && Number.isFinite(item.maxOfferValue) && Number.isFinite(item.minimumMarginPercent) && Number.isFinite(item.maximumPriceChangePercent) && typeof item.mayApproveScopeChanges === "boolean" && typeof item.mayApproveTermsChanges === "boolean");
          if (parsed.commercialPolicyInitialized || validProfiles.length) savedCommercialProfiles = validProfiles;
        }
      }
    } catch { /* Workspace defaults remain available. */ }
    const frame = requestAnimationFrame(() => { setAccent(savedAccent); setWorkspaceDark(savedFoundation); setConfiguredTypes(savedTypes); setCommercialProfiles(savedCommercialProfiles); setCommercialPolicyInitialized(savedCommercialPolicyInitialized); setPreferencesLoaded(true); });
    return () => cancelAnimationFrame(frame);
  }, [initialWorkspace]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    try { localStorage.setItem(`d5o.workspace-preferences.v1:${activeWorkspace}`, JSON.stringify({ accent, foundation: workspaceDark, workTypes: configuredTypes, commercialProfiles, commercialPolicyInitialized })); } catch { /* Local preferences are optional. */ }
  }, [activeWorkspace, accent, workspaceDark, configuredTypes, commercialProfiles, commercialPolicyInitialized, preferencesLoaded]);

  useEffect(() => {
    if (!workLoaded) return;
    if (!hostedPreview) try { localStorage.setItem(`d5o.full-prototype.v3:${activeWorkspace}`, JSON.stringify({ work })); } catch { /* local-only preference */ }
  }, [work, activeWorkspace, workLoaded, hostedPreview]);

  useEffect(() => {
    if (!workLoaded || sharedWorkRevision === null) return;
    const persistedWork = work;
    const serialized = JSON.stringify(persistedWork);
    if (serialized === lastSharedWork.current) return;
    const timer = window.setTimeout(async () => {
      // Multiple rapid draft edits must not post the same expected revision
      // concurrently. The successful response advances sharedWorkRevision,
      // which schedules the latest unsaved local draft in the next effect.
      if (workSaveInFlight.current) return;
      workSaveInFlight.current = true;
      try {
        const response = await fetch(workStateEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: hostedPreview
          ? JSON.stringify({ workspace: activeWorkspace, key: "work", expectedRevision: sharedWorkRevisionRef.current,
              state: { schemaVersion: 1, workspace: activeWorkspace, revision: (sharedWorkRevisionRef.current ?? 0) + 1, records: persistedWork } })
          : JSON.stringify({ expectedRevision: sharedWorkRevisionRef.current, records: persistedWork }) });
        const payload = await response.json() as { state?: { revision: number; records?: Work[] }; error?: string; message?: string };
        if (!response.ok || !payload.state) {
          pendingReviewQueue.current = null;
          if (response.status === 409 && payload.error === "stale_state") setNotice("This Work Record changed in another browser. Your current edits are preserved here; refresh to load the latest shared workspace state.");
          else if (response.status === 409) setNotice(`The Work Record draft was blocked: ${payload.message ?? payload.error ?? "conflicting change"}.`);
          else if (pendingDiscoverSave.current) setNotice(`The Discover change was not saved: ${payload.message ?? payload.error ?? `HTTP ${response.status}`}.`);
          else setNotice(`The Work Record draft was not saved: ${payload.message ?? payload.error ?? `HTTP ${response.status}`}.`);
          return;
        }
        // The database projects governed next actions and other decision facts
        // over the draft. Keep the client on that exact returned projection so
        // a subsequent ordinary edit does not resend stale controlled fields.
        const projected = payload.state.records?.map(hydrate);
        lastSharedWork.current = projected ? JSON.stringify(projected) : serialized;
        if (projected) setWork((current) => JSON.stringify(current) === serialized
          ? projected : current);
        sharedWorkRevisionRef.current = payload.state.revision;
        setSharedWorkRevision(payload.state.revision);
        if (pendingDiscoverSave.current) { setNotice(`Discover Work Record ${pendingDiscoverSave.current} saved to shared revision ${payload.state.revision}.`); pendingDiscoverSave.current = null; }
        if (pendingReviewQueue.current) {
          const review = pendingReviewQueue.current;
          pendingReviewQueue.current = null;
          setMyWorkEntry(review);
          setScreen("my-work");
          setMobileMenuOpen(false);
          setNotice(`${review === "definition" ? "Definition" : review === "pricing" ? "Pricing" : "Proposal"} review saved to the shared workspace and opened in its role queue.`);
        }
      } catch (error) {
        pendingReviewQueue.current = null;
        if (pendingDiscoverSave.current) setNotice(`The Discover change was not saved: ${error instanceof Error ? error.message : "Connection failed"}.`);
      } finally { workSaveInFlight.current = false; }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [work, activeWorkspace, workLoaded, sharedWorkRevision, hostedPreview, workStateEndpoint]);

  useEffect(() => {
    if (!workLoaded || sharedWorkRevision === null) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(workStateEndpoint, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { state?: { revision: number; records: Work[] } };
        const remote = payload.state;
        if (!remote || remote.revision <= (sharedWorkRevisionRef.current ?? 0)) return;
        const localSerialized = JSON.stringify(work);
        if (localSerialized !== lastSharedWork.current) {
          setNotice("Another browser has a newer shared Work Record state. Your local edits are preserved; refresh after saving or copying them.");
          return;
        }
        const records = remote.records.map(hydrate);
        const serialized = JSON.stringify(records);
        lastSharedWork.current = serialized;
        sharedWorkRevisionRef.current = remote.revision;
        setSharedWorkRevision(remote.revision);
        setWork(records);
      } catch { /* Shared refresh is opportunistic; local work stays available. */ }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [work, workLoaded, sharedWorkRevision, workStateEndpoint]);

  useEffect(() => {
    if (!workLoaded || !sharedWork.catalog || hostedPreview) return;
    const frame = requestAnimationFrame(() => setWork((all) => mergeSharedWork(all, sharedWork.catalog!)));
    return () => cancelAnimationFrame(frame);
  }, [workLoaded, sharedWork.catalog, hostedPreview]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen, tab, selectedId]);

  const palette = workspace[activeWorkspace];
  const currentUserLabel = actorLabel ?? palette.user;
  const getBlockers = (item: Work) => transitionBlockers(item, resolvePublishedPhaseConfiguration(configurationInventory, item.workspace, item.type, item as WorkRecord));
  const getDecisionContext = (item: Work): DecisionQueueContext => {
    if (item.discovery?.designHandoff?.status === "submitted") return { blockers: [], decision: `Accept or return Design handoff revision ${item.discovery.designHandoff.revision}`, profile: "Design receiver queue · workspace role", target: "Develop", pinned: true };
    const config = resolvePublishedPhaseConfiguration(configurationInventory, item.workspace, item.type, item as WorkRecord);
    const blockers = transitionBlockers(item, config);
    const transition = currentPrototypeTransition(item);
    const pinned = Boolean(item.phaseConfigurationVersionId && config?.decisionGuards?.length);
    const firstUnmet = pinned && transition && config
      ? decisionCheckResults(item, config, item.stage, transition.right).find((result) => !result.met)
      : undefined;
    return {
      blockers,
      decision: transition?.label ?? item.nextAction,
      profile: pinned ? transition ? roleLabel(item.workspace, transition.role) : "No current decision profile" : item.owner,
      target: item.status === "complete" ? "History" : firstUnmet ? phaseSurfaceForCheck(firstUnmet.check) : blockers.length ? conditionTargetTab(item, blockers) : "Readiness",
      pinned,
    };
  };
  const visibleWork = useMemo(() => work.filter((item) => item.workspace === activeWorkspace).map((item) => ({ ...item, status: item.status === "complete" ? "complete" as const : item.status === "attention" || transitionBlockers(item, resolvePublishedPhaseConfiguration(configurationInventory, item.workspace, item.type, item as WorkRecord)).length ? "attention" as const : "moving" as const })), [work, activeWorkspace, configurationInventory]);
  const operateTimezones = useMemo(() => Object.fromEntries(visibleWork.map((item) => [item.id, resolvePublishedPhaseConfiguration(configurationInventory, item.workspace, item.type, item as WorkRecord)?.operateControls?.timezone ?? legacyOperateControlPolicy.timezone])), [visibleWork, configurationInventory]);
  const operationalWork = useMemo(() => visibleWork.map((item) => ({ ...item, blockers: transitionBlockers(item, resolvePublishedPhaseConfiguration(configurationInventory, item.workspace, item.type, item as WorkRecord)) })), [visibleWork, configurationInventory]);
  const schedulingProfiles = useMemo(() => applyAvailability(hostedPreview && authoritativeCommands ? (workforce.state?.people ?? []) : peopleProfiles[activeWorkspace], availabilityBlocks), [activeWorkspace, availabilityBlocks, hostedPreview, authoritativeCommands, workforce.state]);
  const selected = unavailableRecordId ? undefined : visibleWork.find((item) => item.id === selectedId) ?? visibleWork[0];
  useEffect(() => {
    if (!workLoaded || urlRestored) return;
    const frame = requestAnimationFrame(() => {
      const params = new URLSearchParams(window.location.search);
      const recordId = params.get("record");
      const view = params.get("view");
      const section = params.get("section");
      setTaskFocus(params.get("focus"));
      setTaskPackageId(view === "record" ? params.get("package") : null);
      setTaskRequestId(view === "record" ? params.get("request") : null);
      setTaskRevision(params.has("sourceRevision") ? Number(params.get("sourceRevision")) : null);
      if ((view === "develop" || view === "discover") && ["pricing", "proposal", "solution-prep", "solution-review", "pricing-prep", "proposal-prep", "customer-submission-prep", "design-handoff-receive", "design-handoff-correction", "pursuit-prep", "pursuit-review", "define-handoff-prep", "define-handoff-receive"].includes(params.get("focus") ?? "")) setDiscoverEntry(params.get("focus") as typeof discoverEntry);
      if (view === "define" && ["commercial", "delivery", "define-prep", "develop-handoff-prep", "develop-handoff-receive"].includes(params.get("focus") ?? "")) setDefineReviewEntry(params.get("focus") as typeof defineReviewEntry);
      if (recordId && work.some((item) => item.id === recordId && item.workspace === activeWorkspace)) { setSelectedId(recordId); setUnavailableRecordId(null); }
      else if (recordId && ["record", "discover", "define", "develop"].includes(view ?? "")) setUnavailableRecordId(recordId);
      if (view && durableScreens.has(view as Screen)) {
        const linkedReview = work.find((item) => item.id === recordId && item.workspace === activeWorkspace);
        const focus = params.get("focus");
        const review = (focus === "pricing" ? linkedReview?.discovery?.estimate.review
          : focus === "proposal" ? linkedReview?.discovery?.proposal.review
          : focus === "solution-review" ? linkedReview?.develop?.review : undefined) as
          { authorityRole?: string; submittedByActorId?: string } | undefined;
        // A reviewer may open the exact focused task even when the broader phase is absent
        // from their navigation. The typed command still enforces current authority and source.
        const eligibleFocusedReview = view === "develop" && (focus === "pricing" || focus === "proposal" || focus === "solution-review") &&
          Boolean((focus === "solution-review" ? linkedReview?.develop?.review?.approverRole : review?.authorityRole) === actorRole &&
            review?.submittedByActorId !== actorId);
        const eligiblePursuitReviewer = view === "discover" && focus === "pursuit-review" && linkedReview?.discovery?.pursuitControl?.status === "submitted" && linkedReview.discovery.pursuitControl.submission?.actorId !== actorId && ["admin", "billing_commercial_lead", "business_development_lead"].includes(actorRole ?? "");
        const eligibleDiscoverReceiver = view === "discover" && focus === "define-handoff-receive" &&
          linkedReview?.discovery?.pursuitControl?.handoff?.status === "submitted" &&
          linkedReview.discovery.pursuitControl.handoff.receiverActorId === actorId &&
          ["admin", "operations_leader", "project_manager"].includes(actorRole ?? "");
        const eligibleDevelopReceiver = view === "define" && focus === "develop-handoff-receive" &&
          linkedReview?.definition?.developHandoff?.status === "submitted" &&
          linkedReview.definition.developHandoff.submittedByActorId !== actorId &&
          ["admin", "operations_leader", "project_manager"].includes(actorRole ?? "");
        const eligibleDesignReceiver = view === "develop" && focus === "design-handoff-receive" &&
          Boolean(linkedReview?.canonicalWorkId) && actorRole === "operations_leader";
        const prepRevision = focus === "pursuit-prep" || focus === "define-handoff-prep" ? linkedReview?.discovery?.pursuitControl?.revision
          : focus === "define-prep" || focus === "develop-handoff-prep" ? linkedReview?.definition?.revision ?? (focus === "define-prep" ? 1 : undefined)
          : focus === "solution-prep" ? linkedReview?.develop?.revision ?? 0
          : focus === "pricing-prep" ? linkedReview?.discovery?.estimate.revision
          : focus === "proposal-prep" || focus === "customer-submission-prep" ? linkedReview?.discovery?.proposal.package?.revision ?? 0
          : focus === "design-handoff-correction" ? linkedReview?.discovery?.designHandoff?.revision : undefined;
        const pursuit = linkedReview?.discovery?.pursuitControl;
        const define = linkedReview?.definition;
        const solution = linkedReview?.develop;
        const prepCurrent = focus === "pursuit-prep" ? Boolean(pursuit && ["draft", "returned", "held"].includes(pursuit.status))
          : focus === "define-handoff-prep" ? Boolean(pursuit?.status === "qualified" && !["submitted", "accepted"].includes(pursuit.handoff?.status ?? ""))
          : focus === "define-prep" ? Boolean(pursuit?.handoff?.status === "accepted" && (!define || ["Draft", "Changes requested"].includes(define.status)))
          : focus === "develop-handoff-prep" ? Boolean(define?.status === "Approved" && !["submitted", "accepted"].includes(define.developHandoff?.status ?? ""))
          : focus === "solution-prep" ? Boolean(define?.developHandoff?.status === "accepted" && (!solution?.review || solution.review.status === "Returned" || solution.review.revision !== solution.revision))
          : focus === "pricing-prep" ? Boolean(solution?.review?.status === "Approved" && !["Pricing review", "Approved"].includes(linkedReview?.discovery?.estimate.status ?? ""))
          : focus === "proposal-prep" ? Boolean(linkedReview?.discovery?.estimate.status === "Approved" && !["Internal review", "Approved", "Submitted"].includes(linkedReview?.discovery?.proposal.status ?? ""))
          : focus === "customer-submission-prep" ? Boolean(linkedReview?.discovery?.proposal.status === "Approved" && linkedReview.discovery.proposal.review?.revision === linkedReview.discovery.proposal.package?.revision)
          : focus === "design-handoff-correction" ? Boolean(linkedReview?.discovery?.outcome === "Won" && linkedReview.discovery.designHandoff?.status === "returned" && actorRole === "project_manager")
          : true;
        setStalePreparationLink(["pursuit-prep", "define-handoff-prep", "define-prep", "develop-handoff-prep", "solution-prep", "pricing-prep", "proposal-prep", "customer-submission-prep", "design-handoff-correction"].includes(focus ?? "") && (prepRevision === undefined || Number(params.get("sourceRevision")) !== prepRevision || !linkedReview || !prepCurrent));
        if (canPresentSurface(presentation, view as Screen) || eligibleFocusedReview || eligiblePursuitReviewer || eligibleDiscoverReceiver || eligibleDevelopReceiver || eligibleDesignReceiver) setScreen(view as Screen);
        else { setScreen("my-work"); setNotice("This view is outside your role workspace. Choose an available task below."); }
      }
      if (section && durableRecordTabs.has(section as RecordTab)) setTab(section as RecordTab);
      setUrlRestored(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeWorkspace, work, workLoaded, urlRestored, presentation, actorId, actorRole]);
  useEffect(() => {
    if (!urlRestored) return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", screen);
    if (screen === "record" && unavailableRecordId) url.searchParams.set("record", unavailableRecordId);
    else if (selected) url.searchParams.set("record", selected.id);
    if (screen === "record") url.searchParams.set("section", tab);
    else { url.searchParams.delete("section"); if (!((screen === "discover" || screen === "develop" || screen === "define") && taskFocus)) for (const key of ["focus", "decision", "sourceRevision", "decisionRevision", "package", "release", "turnover", "documentKind", "deployRevision", "request"]) url.searchParams.delete(key); }
    window.history.replaceState(window.history.state, "", url);
  }, [screen, selected, tab, urlRestored, unavailableRecordId, taskFocus]);
  const selectedPhaseConfig = selected ? resolvePublishedPhaseConfiguration(configurationInventory, activeWorkspace, selected.type, selected as WorkRecord) : null;
  const linkedPhaseTask = (screen === "define" && ["commercial", "delivery", "develop-handoff-receive"].includes(taskFocus ?? "")) ||
    (screen === "develop" && ["pricing", "proposal", "solution-review", "design-handoff-receive"].includes(taskFocus ?? "")) ||
    (screen === "discover" && ["define-handoff-receive", "pursuit-review"].includes(taskFocus ?? ""));
  const stalePhaseTask = stalePreparationLink || linkedPhaseTask && (!selected || !Number.isInteger(taskRevision) ||
    (taskFocus === "pursuit-review" ? selected.discovery?.pursuitControl?.status !== "submitted" || selected.discovery.pursuitControl.revision !== taskRevision || selected.discovery.pursuitControl.submission?.actorId === actorId || !["admin", "billing_commercial_lead", "business_development_lead"].includes(actorRole ?? "")
      : taskFocus === "define-handoff-receive" ? selected.discovery?.pursuitControl?.status !== "qualified" ||
      selected.discovery.pursuitControl.revision !== taskRevision || selected.discovery.pursuitControl.handoff?.status !== "submitted" ||
      selected.discovery.pursuitControl.handoff.receiverActorId !== actorId
      : taskFocus === "design-handoff-receive" ? selected.discovery?.designHandoff?.status !== "submitted" ||
        selected.discovery.designHandoff.revision !== taskRevision || selected.discovery.designHandoff.submittedByActorId === actorId || actorRole !== "operations_leader"
      : taskFocus === "develop-handoff-receive" ? selected.definition?.status !== "Approved" ||
        selected.definition.revision !== taskRevision || selected.definition.developHandoff?.status !== "submitted" ||
        selected.definition.developHandoff.submittedByActorId === actorId
      : screen === "define" ? selected.definition?.status !== "In review" || selected.definition.revision !== taskRevision ||
        selected.definition.reviews?.[taskFocus as "commercial" | "delivery"] !== "Pending"
      : taskFocus === "solution-review" ? selected.develop?.review?.status !== "Submitted" ||
        selected.develop.revision !== taskRevision || selected.develop.review.revision !== taskRevision ||
        selected.develop.review.approverRole !== actorRole || selected.develop.review.submittedByActorId === actorId
      : taskFocus === "pricing" ? selected.discovery?.estimate.status !== "Pricing review" ||
        selected.discovery.estimate.revision !== taskRevision || selected.discovery.estimate.review?.revision !== taskRevision
        : selected.discovery?.proposal.status !== "Internal review" ||
          selected.discovery.proposal.package?.revision !== taskRevision || selected.discovery.proposal.review?.revision !== taskRevision));
  const myActions = visibleWork.filter((item) => item.status !== "complete").sort((a, b) => compareActionPriority(a, b) || a.title.localeCompare(b.title));

  function go(next: Screen, entry?: { myWork?: "all" | "mine" | "pricing" | "proposal" | "definition"; crew?: "coverage" | "attendance" }) {
    if (!canPresentSurface(presentation, next)) { setNotice("This view is outside your role workspace."); return; }
    if (next !== "record") { setTaskFocus(null); setTaskPackageId(null); setTaskRequestId(null); setTaskRevision(null); setStalePreparationLink(false); }
    setNotice(""); setScreen(next); setMobileMenuOpen(false);
    if (next !== "record") setUnavailableRecordId(null);
    if (next === "record" && screen !== "record") setRecordReturn(screen);
    if (next === "my-work") setMyWorkEntry(entry?.myWork ?? "all");
    if (next === "crew") { setCrewEntry(entry?.crew ?? null); setCrewFocusWorkId(null); }
    if (next === "discover" || next === "define" || next === "home" || next === "portfolio" || next === "crew" || next === "record") {
      void sharedWork.refresh().catch(() => undefined);
      void sharedSchedule.refresh().catch(() => undefined);
    }
  }
  function openRecord(item: Work) { setTaskFocus(null); setTaskPackageId(null); setTaskRequestId(null); setOperateFocus(null); setSelectedId(item.id); setTab("Overview"); go("record"); }
  function selectWorkRecord(item: Work) {
    if (item.workspace !== activeWorkspace) return;
    setWork((current) => current.some((entry) => entry.id === item.id) ? current : [hydrate(item), ...current]);
    setSelectedId(item.id);
    setOperateFocus(null);
    setDiscoverEntry(null);
    setDefineReviewEntry(null);
    if (screen === "define" && !(item.definition || item.discovery?.fit === "Qualified" || item.discovery?.fit === "Conditional" || item.discovery?.outcome === "Won")) {
      setTab("Overview"); go("record");
      setNotice(`${item.title} is not ready for Define. Its Work Record overview is open.`);
    }
  }
  function openWorkspacePhase(target: "discover" | "define", preferred?: Work) {
    const eligible = visibleWork.filter((item) => target === "discover" ? true : Boolean(item.definition || item.discovery?.fit === "Qualified" || item.discovery?.fit === "Conditional" || item.discovery?.outcome === "Won"));
    const next = eligible.find((item) => item.id === preferred?.id) ?? eligible.find((item) => item.id === selected?.id) ?? eligible[0];
    setDiscoverEntry(null);
    setDefineReviewEntry(null);
    if (next) setSelectedId(next.id);
    go(target);
    const requested = preferred ?? selected;
    if (requested && next && requested.id !== next.id) setNotice(`${requested.title} has no Define baseline to edit. The selected Work Record changed to ${next.title} from the definition queue.`);
  }
  function openJourneyPhase(item: WorkRecord, phase: WorkPhase) {
    setSelectedId(item.id);
    if (phase === "Discover" || phase === "Define") { openWorkspacePhase(phase.toLowerCase() as "discover" | "define", item as Work); return; }
    if (phase === "Develop" && item.discovery) { setDiscoverEntry(null); go("develop"); return; }
    setTab(phase);
    go("record");
  }
  function updateWork(id: string, transform: (item: Work) => Work) { setWork((all) => all.map((item) => item.id === id ? transform(hydrate(item)) : item)); }
  async function executePursuitCommand(workId: string, command: PursuitCommand): Promise<boolean> {
    if (!authoritativeCommands || !work.find((item) => item.id === workId)?.canonicalWorkId) return false;
    const expectedRevision = sharedWorkRevisionRef.current;
    if (expectedRevision === null || JSON.stringify(work) !== lastSharedWork.current) {
      setNotice("Wait for the opportunity draft to finish saving before recording a pursuit action."); return false;
    }
    if (command.kind === "request-spend" || command.kind === "decide-spend") {
      setNotice("Pursuit spend is a separate decision and is not yet connected to this authoritative command path."); return false;
    }
    const intent = command.kind === "save" ? { ...command.fields, ...command.workFields }
      : command.kind === "decide" || command.kind === "respond-handoff"
        ? { outcome: command.outcome, reason: command.reason }
        : command.kind === "submit-handoff" ? { receiver: command.receiver, brief: command.brief } : {};
    try {
      const response = await fetch(`/api/d5o-hosted/prototype-pursuit-command?workspace=${encodeURIComponent(activeWorkspace)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workId, action: command.kind === "save" ? "save-intake" : command.kind,
          intent, commandId: crypto.randomUUID(), expectedRevision,
          expectedDecisionRevision: work.find((item) => item.id === workId)?.discovery?.pursuitControl?.revision ?? 0 })
      });
      const payload = await response.json() as { state?: { revision: number; records: Work[] }; message?: string; error?: string };
      if (!response.ok || !payload.state) {
        setNotice(payload.message ?? payload.error ?? "The pursuit action was not recorded."); return false;
      }
      const next = payload.state.records.map(hydrate);
      lastSharedWork.current = JSON.stringify(next);
      sharedWorkRevisionRef.current = payload.state.revision;
      setSharedWorkRevision(payload.state.revision); setWork(next);
      setNotice(`Pursuit ${command.kind.replaceAll("-", " ")} recorded by your authenticated role.`);
      return true;
    } catch { setNotice("The pursuit service could not be reached. No decision was recorded."); return false; }
  }
  async function executeDefineCommand(command: Omit<DefineCommand, "expectedRevision" | "commandId">): Promise<boolean> {
    const expectedRevision = sharedWorkRevisionRef.current;
    if (expectedRevision === null || JSON.stringify(work) !== lastSharedWork.current) {
      setNotice("Wait for the Define draft to finish saving before recording a decision."); return false;
    }
    try {
      const endpoint = hostedPreview ? `/api/d5o-hosted/prototype-define-command?workspace=${encodeURIComponent(activeWorkspace)}` : "/api/work/define-command";
      const decisionRevision = work.find((item) => item.id === command.workId)?.definition?.authorityRevision ?? 0;
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...command, expectedRevision, expectedDecisionRevision: decisionRevision, commandId: crypto.randomUUID() }) });
      const payload = await response.json() as { state?: { revision: number; records: Work[] }; message?: string; error?: string };
      if (!response.ok || !payload.state) { setNotice(payload.message ?? (response.status === 409 ? "The Define basis changed. Refresh and retry." : "The Define decision was not saved.")); return false; }
      const next = payload.state.records.map(hydrate);
      lastSharedWork.current = JSON.stringify(next); sharedWorkRevisionRef.current = payload.state.revision;
      setSharedWorkRevision(payload.state.revision); setWork(next);
      setNotice(`Define ${command.action.replaceAll("-", " ")} saved against Work revision ${payload.state.revision}.`);
      return true;
    } catch { setNotice("The Define service could not be reached. No decision was recorded."); return false; }
  }
  async function executeCommercialCommand(command: Omit<CommercialCommand, "expectedRevision">): Promise<boolean> {
    const expectedRevision = sharedWorkRevisionRef.current;
    if (expectedRevision === null || JSON.stringify(work) !== lastSharedWork.current) {
      setNotice("Save the current Work Record changes before recording a commercial decision. Wait for the shared-save confirmation, then retry.");
      return false;
    }
    try {
      const endpoint = hostedPreview
        ? `/api/d5o-hosted/prototype-commercial-command?workspace=${encodeURIComponent(activeWorkspace)}`
        : "/api/work/commercial-command";
      const selected = work.find((item) => item.id === command.workId);
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        ...command, expectedRevision,
        ...(hostedPreview && command.action.endsWith("solution") && selected?.canonicalWorkId
          ? { commandId: crypto.randomUUID(), expectedDecisionRevision: selected.develop?.authorityRevision ?? 0 }
          : hostedPreview && selected?.canonicalWorkId &&
            ["save-detailed-estimate", "submit-pricing", "approve-pricing", "return-pricing"].includes(command.action)
            ? { commandId: crypto.randomUUID(), expectedDecisionRevision:
                (selected.discovery?.estimate as { authorityRevision?: number } | undefined)?.authorityRevision ?? 0 }
            : hostedPreview && selected?.canonicalWorkId &&
              ["save-proposal-revision", "submit-proposal", "approve-proposal", "return-proposal", "record-customer-submission", "record-customer-response"].includes(command.action)
              ? { commandId: crypto.randomUUID(), expectedDecisionRevision:
                  (selected.discovery?.proposal as { authorityRevision?: number } | undefined)?.authorityRevision ?? 0 }
            : hostedPreview && selected?.canonicalWorkId &&
              ["submit-design-handoff", "accept-design-handoff", "return-design-handoff"].includes(command.action)
              ? { commandId: crypto.randomUUID(), expectedDecisionRevision:
                  (selected.discovery?.designHandoff as { authorityRevision?: number } | undefined)?.authorityRevision ?? 0 }
            : {})
      }) });
      const payload = await response.json() as { state?: { revision: number; records: Work[] }; message?: string; error?: string };
      if (!response.ok || !payload.state) {
        setNotice(response.status === 409 && payload.error === "stale_state" ? "This Work Record changed in another browser. Refresh before recording a decision." : payload.message ?? "The commercial command was not saved. Review the current basis and retry.");
        return false;
      }
      const next = payload.state.records.map(hydrate);
      lastSharedWork.current = JSON.stringify(next);
      sharedWorkRevisionRef.current = payload.state.revision;
      setSharedWorkRevision(payload.state.revision);
      setWork(next);
      pendingDiscoverSave.current = null;
      if (command.action === "submit-pricing" || command.action === "submit-proposal") {
        setMyWorkEntry(command.action === "submit-pricing" ? "pricing" : "proposal");
        setScreen("my-work");
        setMobileMenuOpen(false);
      }
      setNotice(authoritativeCommands && selected?.canonicalWorkId
        ? `${command.action.replaceAll("-", " ")} recorded against authenticated Work revision ${payload.state.revision}.`
        : `${command.action.replaceAll("-", " ")} recorded in shared prototype revision ${payload.state.revision}. The role queue does not represent delegated business authority.`);
      return true;
    } catch {
      setNotice("The commercial command could not reach the service. No decision was recorded.");
      return false;
    }
  }
  async function executeDesignCommand(command: Omit<DesignCommand, "expectedRevision" | "commandId">): Promise<boolean> {
    const expectedRevision = sharedWorkRevisionRef.current;
    if (expectedRevision === null || JSON.stringify(work) !== lastSharedWork.current) {
      setNotice("Wait for the Work Record to finish saving before recording a Design decision.");
      return false;
    }
    try {
      const endpoint = hostedPreview ? `/api/d5o-hosted/prototype-design-command?workspace=${encodeURIComponent(activeWorkspace)}` : "/api/work/design-command";
      const selected = work.find((item) => item.id === command.workId);
      const serviceBasisAction = command.action.endsWith("service-basis");
      const serviceParent = selected?.serviceSource
        ? work.find((item) => item.id === selected.serviceSource?.parentWorkId) : undefined;
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...command, expectedRevision, commandId: crypto.randomUUID(),
        ...(authoritativeCommands && selected?.canonicalWorkId ? { expectedDecisionRevision:
          serviceBasisAction ? selected.serviceExecutionBasis?.authorityRevision ?? 0
            : (selected.design as { authorityRevision?: number } | undefined)?.authorityRevision ?? 0,
          ...(serviceBasisAction ? { expectedOperateRevision: serviceParent?.operate?.authorityRevision ?? -1 } : {}) } : {}) }) });
      const payload = await response.json() as { state?: { revision: number; records: Work[] }; message?: string; error?: string };
      if (!response.ok || !payload.state) { setNotice(payload.message ?? (response.status === 409 ? "The Design basis changed. Refresh and retry." : "Design action could not be saved.")); return false; }
      const next = payload.state.records.map(hydrate);
      lastSharedWork.current = JSON.stringify(next);
      sharedWorkRevisionRef.current = payload.state.revision;
      setSharedWorkRevision(payload.state.revision);
      setWork(next);
      setNotice(`Design ${command.action.replaceAll("-", " ")} saved${authoritativeCommands && selected?.canonicalWorkId ? ` against authenticated Work revision ${payload.state.revision}` : ` in shared prototype revision ${payload.state.revision}`}.`);
      return true;
    } catch { setNotice("The Design service could not be reached. No decision was recorded."); return false; }
  }
  async function executeDeployCommand(command: Omit<DeployCommand, "expectedRevision" | "commandId">): Promise<boolean> {
    const expectedRevision = sharedWorkRevisionRef.current;
    if (expectedRevision === null || JSON.stringify(work) !== lastSharedWork.current) {
      setNotice("Wait for the Work Record to finish saving before recording a Deploy action."); return false;
    }
    try {
      const endpoint = hostedPreview ? `/api/d5o-hosted/prototype-deploy-command?workspace=${encodeURIComponent(activeWorkspace)}` : "/api/work/deploy-command";
      const selected = work.find((item) => item.id === command.workId);
      const controlled = authoritativeCommands && !!selected?.canonicalWorkId;
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...command, expectedRevision, commandId: crypto.randomUUID(),
        ...(controlled ? { expectedDesignRevision: (selected.design as { authorityRevision?: number } | undefined)?.authorityRevision ?? 0,
          expectedScheduleRevision: sharedSchedule.schedule?.revision ?? 0,
          expectedDecisionRevision: (selected.deploy as { authorityRevision?: number } | undefined)?.authorityRevision ?? 0 } : {}) }) });
      const payload = await response.json() as { state?: { revision: number; records: Work[] }; message?: string };
      if (!response.ok || !payload.state) { setNotice(payload.message ?? (response.status === 409 ? "The Deploy basis changed. Refresh and retry." : "Deploy action could not be saved.")); return false; }
      const next = payload.state.records.map(hydrate);
      lastSharedWork.current = JSON.stringify(next);
      sharedWorkRevisionRef.current = payload.state.revision;
      setSharedWorkRevision(payload.state.revision);
      setWork(next);
      setNotice(`Deploy ${command.action.replaceAll("-", " ")} saved${controlled ? ` against authenticated Work revision ${payload.state.revision}` : ` in shared prototype revision ${payload.state.revision}`}.`);
      return true;
    } catch { setNotice("The Deploy service could not be reached. No field action was recorded."); return false; }
  }
  async function executeOperateCommand(command: Omit<OperateCommand, "expectedRevision" | "commandId">): Promise<boolean> {
    const expectedRevision = sharedWorkRevisionRef.current;
    if (expectedRevision === null || JSON.stringify(work) !== lastSharedWork.current) {
      setNotice("Wait for the Work Record to finish saving before recording an Operate action."); return false;
    }
    const fingerprint = JSON.stringify(command);
    const pending = pendingOperateCommand.current?.fingerprint === fingerprint
      ? pendingOperateCommand.current : { fingerprint, commandId: crypto.randomUUID(), expectedRevision };
    pendingOperateCommand.current = pending;
    try {
      const endpoint = hostedPreview ? `/api/d5o-hosted/prototype-operate-command?workspace=${encodeURIComponent(activeWorkspace)}` : "/api/work/operate-command";
      const selected = work.find((item) => item.id === command.workId);
      const serviceJob = selected?.operate?.jobs.find((item) => item.id === command.id)
        ?? selected?.operate?.jobs.find((item) => item.id === selected.operate?.requests.find((request) => request.id === command.requestId)?.currentCycleJobIds?.[0]);
      const serviceWork = serviceJob ? work.find((item) => item.id === serviceJob.workId) : undefined;
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...command, expectedRevision: pending.expectedRevision, commandId: pending.commandId,
        ...(authoritativeCommands && selected?.canonicalWorkId ? { expectedDeployRevision: selected.deploy?.authorityRevision ?? 0,
          expectedDecisionRevision: selected.operate?.authorityRevision ?? 0,
          expectedServiceDeployRevision: serviceWork?.deploy?.authorityRevision ?? 0 } : {}) }) });
      const payload = await response.json() as { state?: { revision: number; records: Work[] }; message?: string };
      if (!response.ok || !payload.state) {
        if (response.status === 400 || response.status === 403 || response.status === 409 || response.status === 422)
          pendingOperateCommand.current = null;
        setNotice(payload.message ?? (response.status === 409 ? "The Operate basis changed. Refresh and retry." : "Operate action could not be saved.")); return false;
      }
      pendingOperateCommand.current = null;
      const next = payload.state.records.map(hydrate);
      lastSharedWork.current = JSON.stringify(next); sharedWorkRevisionRef.current = payload.state.revision;
      setSharedWorkRevision(payload.state.revision); setWork(next);
      setNotice(`Operate ${command.action.replaceAll("-", " ")} saved${authoritativeCommands && selected?.canonicalWorkId ? ` against authenticated Work revision ${payload.state.revision}` : ` in shared prototype revision ${payload.state.revision}`}.`);
      return true;
    } catch { setNotice("The Operate service could not be reached. No action was recorded."); return false; }
  }
  async function uploadDeployEvidence(workId: string, packageId: string, data: FormData): Promise<boolean> {
    const expectedRevision = sharedWorkRevisionRef.current;
    if (expectedRevision === null || JSON.stringify(work) !== lastSharedWork.current) { setNotice("Wait for the Work Record to finish saving before uploading evidence."); return false; }
    data.set("workId", workId); data.set("packageId", packageId); data.set("expectedRevision", String(expectedRevision));
    try {
      const endpoint = hostedPreview ? `/api/d5o-hosted/prototype-deploy-command?workspace=${encodeURIComponent(activeWorkspace)}` : "/api/work/deploy-command";
      const response = await fetch(endpoint, { method: "PUT", body: data });
      const payload = await response.json() as { state?: { revision: number; records: Work[] }; message?: string };
      if (!response.ok || !payload.state) { setNotice(payload.message ?? "The field file was not saved."); return false; }
      const next = payload.state.records.map(hydrate);
      lastSharedWork.current = JSON.stringify(next); sharedWorkRevisionRef.current = payload.state.revision; setSharedWorkRevision(payload.state.revision); setWork(next);
      setNotice("Field file uploaded to private evidence custody. Independent evidence review is still required."); return true;
    } catch { setNotice("Field upload failed. Select the file again and retry."); return false; }
  }
  async function synchronizePricingRevision(): Promise<void> {
    const response = await fetch(workStateEndpoint, { cache: "no-store" });
    if (!response.ok) throw new Error("The shared Work Record revision could not be refreshed.");
    const payload = await response.json() as { state?: { revision: number; records: Work[] } };
    if (!payload.state || !Array.isArray(payload.state.records)) throw new Error("The shared Work Record state is unavailable.");
    const next = payload.state.records.map(hydrate);
    lastSharedWork.current = JSON.stringify(next);
    sharedWorkRevisionRef.current = payload.state.revision;
    setSharedWorkRevision(payload.state.revision);
    setWork(next);
  }
  function savePhaseRow(item: Work, key: string, row: Record<string, string>, index: number | null) {
    const [phaseKey, componentKey] = key.split(".");
    const component = selectedPhaseConfig?.phases.find((phase) => phase.key === phaseKey)?.components.find((entry) => entry.key === componentKey);
    const fields = component?.fields ?? [];
    if (!component || !fields.length || Object.keys(row).some((fieldKey) => !fields.some((field) => field.key === fieldKey)) || fields.some((field) => field.required && !row[field.key]?.trim())) {
      setNotice("This entry does not match the Work Record's pinned phase configuration.");
      return;
    }
    if (key === "design.verification_plan" && !(item.packages ?? []).some((entry) => entry.id === row.package)) {
      setNotice("Select a controlled Work Package on this Work Record before saving the verification plan.");
      return;
    }
    updateWork(item.id, (current) => {
      const rows = [...(current.phaseRegisters?.[key] ?? [])];
      if (index !== null && rows[index]) rows[index] = row; else rows.push(row);
      return { ...current, phaseRegisters: { ...current.phaseRegisters, [key]: rows }, history: [`${stamp()} · ${index === null ? "Added" : "Updated"} ${key.replaceAll(".", " / ")} entry`, ...current.history] };
    });
    setNotice(`${key.replaceAll(".", " / ")} entry saved on this Work Record.`);
  }
  function removePhaseRow(item: Work, key: string, index: number) {
    updateWork(item.id, (current) => ({ ...current, phaseRegisters: { ...current.phaseRegisters, [key]: (current.phaseRegisters?.[key] ?? []).filter((_, position) => position !== index) }, history: [`${stamp()} · Removed ${key.replaceAll(".", " / ")} entry`, ...current.history] }));
    setNotice(`${key.replaceAll(".", " / ")} entry removed from this Work Record.`);
  }
  function saveActionPriority(item: Work, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const due = String(form.get("nextActionDue") ?? "");
    const impact = String(form.get("nextActionImpact") ?? "");
    updateWork(item.id, (current) => ({ ...current, nextActionDue: due || null, nextActionImpact: impact === "Critical" || impact === "High" || impact === "Standard" ? impact : null }));
    setNotice("Next-action due date and impact updated for this Work Record.");
  }
  async function startWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const title = String(form.get("title") ?? "").trim(); const customer = String(form.get("customer") ?? "").trim(); const site = String(form.get("site") ?? "").trim(); const type = String(form.get("type") ?? "").trim(); const value = String(form.get("value") ?? "").trim(); const owner = String(form.get("owner") ?? "").trim(); const need = String(form.get("need") ?? "").trim();
    if (!title || !need) return;
    if (!sharedWork.canEdit) { setNotice("Sign in with workspace editing authority before starting shared work."); return; }
    const phaseConfigurationVersionId = activePhaseConfigurationVersion(configurationInventory, activeWorkspace, type);
    if (!phaseConfigurationVersionId) { setNotice("A published phase contract for this Work Type is required before starting work."); return; }
    try {
      const result = await sharedWork.mutate({ action: "create-record", title, customer, site, type, phaseConfigurationVersionId, value, owner, initialDiscovery: { source: "Direct customer", need, procurement: "To be confirmed", closeDate: "" } });
      const created = result.created as CatalogWorkRecord;
      if (authoritativeCommands) {
        if (!result.workState || !created.canonicalWorkId) throw new Error("The authoritative Work Record response is incomplete. Refresh before continuing.");
        const next = result.workState.records.map(hydrate);
        lastSharedWork.current = JSON.stringify(next);
        sharedWorkRevisionRef.current = result.workState.revision;
        setSharedWorkRevision(result.workState.revision);
        setWork(next);
      } else {
        setWork((all) => [hydrate(created), ...all.filter((item) => item.id !== created.id)]);
      }
      setSelectedId(created.id); setTab("Overview"); setScreen("my-work");
      setNotice("Work Record started in the shared workspace. Prepare the Discover intake from My Work before qualification.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Work Record could not be shared."); }
  }
  async function createDiscoverWork(record: WorkRecord): Promise<string> {
    if (!sharedWork.canEdit || !sharedWork.catalog) throw new Error("Load shared work with editing authority before capturing an opportunity.");
    const result = await sharedWork.mutate({ action: "create-record", title: record.title,
      customer: record.customer, site: record.site, type: record.type,
      phaseConfigurationVersionId: record.phaseConfigurationVersionId ?? "",
      value: record.value, owner: record.owner, initialDiscovery: record.discovery ? {
        source: record.discovery.source, need: record.discovery.need,
        procurement: record.discovery.procurement, closeDate: record.discovery.closeDate
      } : undefined });
    const created = result.created as CatalogWorkRecord;
    // The catalog owns the stable identity and initial position. Discover owns
    // the opportunity details, which are then saved on that same Work Record.
    const next = hydrate({ ...record, id: created.id, canonicalWorkId: created.canonicalWorkId, stage: created.stage,
      status: created.status, progress: created.progress,
      phaseConfigurationVersionId: created.phaseConfigurationVersionId });
    if (authoritativeCommands) {
      if (!result.workState || !created.canonicalWorkId) throw new Error("The authoritative opportunity response is incomplete. Refresh before continuing.");
      const baseline = result.workState.records.map(hydrate);
      const createdProjection = baseline.find((item) => item.id === created.id);
      if (!createdProjection) throw new Error("The new opportunity is missing from the authoritative Work Record response.");
      lastSharedWork.current = JSON.stringify(baseline);
      sharedWorkRevisionRef.current = result.workState.revision;
      setSharedWorkRevision(result.workState.revision);
      // Canonical creation already committed the Discover intake and catalog in
      // one transaction. Do not issue a second whole-work draft save for the
      // same capture: if that save fails, repeating Capture creates new work.
      setWork(baseline);
      setOwnedWorkIds((current) => current ? [...new Set([...current, created.id])] : current);
    } else setWork((all) => [next, ...all.filter((item) => item.id !== created.id)]);
    if (!authoritativeCommands) pendingDiscoverSave.current = created.id;
    setSelectedId(created.id);
    return created.id;
  }
  function resetDemo() { if (hostedPreview) return; const sample = seed.filter((record) => record.workspace === activeWorkspace).map(hydrate); setWork(sharedWork.catalog ? mergeSharedWork(sample, sharedWork.catalog) : sample); setSelectedId(activeWorkspace === "rybex" ? "rybex-1" : "rotork-1"); setScreen("my-work"); setNotice("Sample Work Record views restored. Shared Work Records, packages and crew publications were preserved."); }
  function addEvidence(item: Work, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("evidence") ?? "").trim();
    const source = String(form.get("source") ?? "").trim();
    const kind = String(form.get("kind") ?? "Supporting proof");
    const packageId = String(form.get("packageId") ?? "");
    if (!name || !source) return;
    if (packageId && !item.packages?.some((entry) => entry.id === packageId)) { setNotice("Choose a package on this Work Record before adding package proof."); return; }
    const entry: EvidenceItem = { id: `e-${Date.now()}`, name, source, kind, state: "draft", added: stamp(), packageId: packageId || undefined };
    updateWork(item.id, (current) => ({ ...current, evidence: [...(current.evidence ?? []), entry], history: [`${stamp()} · ${kind} reference added for review: ${name}`, ...current.history] }));
    event.currentTarget.reset();
    setNotice("The reference is awaiting review. It is not accepted proof for a decision yet.");
  }
  function reviewEvidence(item: Work, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const evidenceId = String(form.get("evidenceId") ?? "");
    const note = String(form.get("reviewNote") ?? "").trim();
    const confirmed = form.get("reviewConfirmed") === "on";
    const target = item.evidence?.find((entry) => entry.id === evidenceId && entry.state === "draft");
    if (!target || !target.source || !confirmed || !note) { setNotice("Open and inspect the source, then confirm the review with a note."); return; }
    updateWork(item.id, (current) => ({ ...current, proof: [...current.proof, target.name], evidence: (current.evidence ?? []).map((entry) => entry.id === evidenceId ? { ...entry, state: "verified" as const, reviewedAt: stamp(), reviewNote: note } : entry), history: [`${stamp()} · Proof reference reviewed by ${currentUserLabel}: ${target.name} · ${note}`, ...current.history] }));
    setNotice("The reference review is recorded with the reviewer and note. This local prototype does not perform a file-security scan.");
  }
  async function addPackage(item: Work, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (item.discovery?.pursuitControl && (item.discovery.outcome !== "Won" || item.discovery.designHandoff?.status !== "accepted")) { setNotice("A Design receiver must accept the awarded scope and offer before package planning begins."); return; }
    if (item.canonicalWorkId && item.serviceSource && item.serviceExecutionBasis?.status !== "accepted") { setNotice("Operations must accept the current service execution basis before package planning begins."); return; }
    const element = event.currentTarget;
    const form = new FormData(element);
    const name = String(form.get("package") ?? "").trim();
    const owner = String(form.get("owner") ?? "").trim() || item.owner;
    if (!name) return;
    if (!sharedWork.canEdit || !sharedWork.catalog) { setNotice("Sign in with workspace editing authority before adding a shared Work Package."); return; }
    try {
      if (authoritativeCommands && item.canonicalWorkId &&
        !sharedWork.catalog.records.some((record) => record.id === item.id))
        throw new Error("The canonical Work Record is missing from the shared catalog. Refresh before creating a package.");
      if (!authoritativeCommands && !seededWorkIds[activeWorkspace].includes(item.id) && !sharedWork.catalog.records.some((record) => record.id === item.id))
        await sharedWork.mutate({ action: "register-record", record: { ...item, createdAt: "", createdBy: "" } });
      const result = await sharedWork.mutate({ action: "create-package", workId: item.id, name, owner,
        ...(authoritativeCommands && item.canonicalWorkId ? {
          expectedWorkRevision: sharedWorkRevisionRef.current ?? undefined,
          expectedHandoffRevision: item.serviceSource
            ? item.serviceExecutionBasis?.revision : item.discovery?.designHandoff?.revision,
          expectedPackageCount: sharedWork.catalog.packages.filter((candidate) => candidate.workId === item.id).length
        } : {}) });
      const entry = result.created as WorkPackage;
      if (authoritativeCommands && item.canonicalWorkId) {
        if (!result.workState) throw new Error("The authoritative package response is incomplete. Refresh before continuing.");
        const next = result.workState.records.map(hydrate);
        lastSharedWork.current = JSON.stringify(next);
        sharedWorkRevisionRef.current = result.workState.revision;
        setSharedWorkRevision(result.workState.revision);
        setWork(next);
      } else {
        updateWork(item.id, (current) => ({ ...current, packages: [...(current.packages ?? []).filter((candidate) => candidate.id !== entry.id), entry], history: [`${stamp()} · Work package created: ${name}`, ...current.history] }));
      }
      element.reset();
      setNotice("The Work Package is shared. Set its required dates and shifts below to place it in the crew queue.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Work Package could not be shared."); }
  }
  async function savePackageDemand(item: Work, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (item.discovery?.pursuitControl && (item.discovery.outcome !== "Won" || item.discovery.designHandoff?.status !== "accepted")) { setNotice("Receive the awarded Develop handoff before setting controlled Work Package crew demand."); return; }
    if (!sharedSchedule.schedule || !sharedSchedule.canEdit) { setNotice("Sign in with scheduling authority to set required crew dates and shifts."); return; }
    const form = new FormData(event.currentTarget);
    const packageId = String(form.get("packageId") ?? "");
    const target = item.packages?.find((entry) => entry.id === packageId && entry.status !== "accepted");
    const existing = sharedSchedule.schedule.packageDemands.find((entry) => entry.packageId === packageId);
    if (!target || scheduleRequirement(packageId)?.crewSchedulable === false) { setNotice("This package is not schedulable crew work."); return; }
    const dates = form.getAll("requiredDate").map(String);
    const shifts = form.getAll("requiredShift").map(String);
    const requiredSlots: CrewDemandSlot[] = dates.map((date, index) => ({ date, shift: shifts[index] ?? "" }));
    const demand: PackageCrewDemand = { packageId, workId: item.id, qualification: String(form.get("qualification") ?? ""), minimumPeople: Number(form.get("minimumPeople")), estimatedPersonHours: Number(form.get("estimatedPersonHours")), priority: String(form.get("priority") ?? "Normal") as PackageCrewDemand["priority"], prerequisite: String(form.get("prerequisite") ?? "").trim(), crewSchedulable: true, requiredSlots };
    if (!requiredSlots.length || requiredSlots.some((slot) => !slot.date || !slot.shift)) { setNotice("Add at least one complete required date and shift."); return; }
    try {
      if (authoritativeCommands && item.canonicalWorkId) {
        const saved = await executeDesignCommand({ action: "save-demand", workId: item.id, demand });
        if (saved) await sharedSchedule.refresh();
        return;
      }
      await sharedSchedule.mutate({ action: "save-demand", demand });
      setNotice(`${target.name}: required crew dates and shifts saved in the shared plan. ${existing ? "Review affected bookings and save any needed correction to share it with the crew." : "The package can now enter the crew queue."}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Work Package demand could not be saved."); }
  }
  function recordPackageFacts(item: Work, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const packageId = String(form.get("packageId") ?? "");
    if (item.discovery?.pursuitControl && item.discovery.outcome === "Won" && !(item.design?.releases ?? []).some((release) => release.packageId === packageId && release.status === "Accepted" && release.packageRevision === item.design?.packages.find((entry) => entry.packageId === packageId)?.revision)) { setNotice("Deploy must accept the exact current Design release before work facts can be recorded."); return; }
    const installed = Number(form.get("installed"));
    const tested = Number(form.get("tested"));
    const target = item.packages?.find((entry) => entry.id === packageId);
    if (!target || target.status === "accepted" || !Number.isFinite(installed) || !Number.isFinite(tested) || installed < 0 || installed > 100 || tested < 0 || tested > installed || installed < target.accepted || tested < target.accepted) { setNotice("Enter valid installed and tested percentages without reducing an accepted quantity."); return; }
    updateWork(item.id, (current) => ({ ...current, packages: (current.packages ?? []).map((entry) => entry.id === packageId ? { ...entry, installed, tested, status: entry.status === "planned" && installed > 0 ? "in progress" as const : entry.status } : entry), history: [`${stamp()} · Work facts recorded for ${target.name}: ${installed}% installed, ${tested}% tested`, ...current.history] }));
    setNotice("Installed and tested facts were recorded separately from acceptance.");
  }
  function advancePackage(item: Work, packageId: string) {
    if (item.discovery?.pursuitControl && item.discovery.outcome === "Won" && !(item.design?.releases ?? []).some((release) => release.packageId === packageId && release.status === "Accepted" && release.packageRevision === item.design?.packages.find((entry) => entry.packageId === packageId)?.revision)) { setNotice("Deploy must accept the exact current Design release before this package can advance."); return; }
    const target = item.packages?.find((entry) => entry.id === packageId);
    const authorizedException = item.issues?.find((entry) => entry.status === "resolved" && entry.affectedPackageId === packageId && entry.exceptionAuthority && entry.authorityBasis && item.evidence?.some((proof) => proof.id === entry.proofId && proof.packageId === packageId && proof.kind === "Exception authorization" && proof.state === "verified"));
    if (!target || target.status === "accepted") return;
    if (target.status === "ready" && item.blockers.length) { setNotice(`Acceptance remains blocked: ${item.blockers[0]}`); return; }
    if (target.status === "ready" && (target.installed < 100 || (target.tested < 100 && !authorizedException))) { setNotice("Acceptance requires complete installed and tested quantities, or a recorded package-specific exception for the failed test."); return; }
    if (target.status === "in progress" && (target.installed < 100 || (target.tested < 100 && !authorizedException))) { setNotice("Record complete installed and tested quantities, or a package-specific authorized exception, before requesting verification."); return; }
    if (target.status !== "planned" && !(item.evidence ?? []).some((entry) => entry.packageId === packageId && (entry.state === "verified" || entry.state === "accepted"))) { setNotice("A reviewed proof reference linked to this package is required before verification or acceptance."); return; }
    updateWork(item.id, (current) => ({ ...current, packages: (current.packages ?? []).map((entry) => entry.id !== packageId ? entry : entry.status === "planned" ? { ...entry, status: "in progress" } : entry.status === "in progress" ? { ...entry, status: "ready" } : { ...entry, status: "accepted", accepted: authorizedException ? entry.installed : entry.tested, acceptanceBasis: authorizedException ? `Synthetic exception by ${authorizedException.exceptionAuthority} · ${authorizedException.authorityBasis}` : "Verified test result" }), history: [`${stamp()} · Work package ${target.status === "planned" ? "started" : target.status === "in progress" ? "submitted for verification" : "accepted"}: ${target.name}${target.status === "ready" && authorizedException ? ` · Tested ${target.tested}%, accepted against synthetic exception ${authorizedException.exceptionAuthority} (${authorizedException.authorityBasis})` : ""}`, ...current.history] }));
    setNotice(target.status === "ready" ? authorizedException ? "Package acceptance records the retained tested quantity and its synthetic exception basis separately." : "Acceptance was recorded against the tested quantity and proof context." : "Package position changed without inventing installed or tested facts.");
  }
  function createIssue(item: Work, event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const title = String(form.get("issue") ?? "").trim(); const owner = String(form.get("owner") ?? "").trim() || item.owner; const requiredProofKind = String(form.get("proofKind") ?? "Proof package"); if (!title) return; const entry: ControlledIssue = { id: `i-${Date.now()}`, title, owner, impact: "This condition must be resolved or explicitly accepted before the governed action proceeds.", status: "open", created: stamp(), blocker: title, requiredProofKind }; updateWork(item.id, (current) => ({ ...current, issues: [...(current.issues ?? []), entry], issue: title, blockers: [...current.blockers, title], history: [`${stamp()} · Issue isolated: ${title}`, ...current.history] })); event.currentTarget.reset(); setNotice("The condition is isolated, owned and now visible as a controlled blocker."); }
  function resolveIssue(item: Work, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const issueId = String(form.get("issueId") ?? "");
    const proofId = String(form.get("proofId") ?? "");
    const resolution = String(form.get("resolution") ?? "").trim();
    const target = item.issues?.find((entry) => entry.id === issueId && entry.status === "open");
    const proof = item.evidence?.find((entry) => entry.id === proofId && entry.state === "verified" && entry.added !== "Baseline" && (!target?.affectedPackageId || entry.packageId === target.affectedPackageId) && (target?.requiredProofKind === "Any reviewed proof" || entry.kind === (target?.requiredProofKind ?? "Test result")));
    if (!target || !proof || !resolution) { setNotice("A newly reviewed reference of the required type and a resolution note are needed to clear this condition. Exception authorization remains a separate decision."); return; }
    updateWork(item.id, (current) => { const remaining = (current.issues ?? []).map((entry) => entry.id === issueId ? { ...entry, status: "resolved" as const, proofId, resolution } : entry); const blockers = current.blockers.filter((entry) => entry !== (target.blocker ?? target.title)); return { ...current, issues: remaining, issue: remaining.find((entry) => entry.status === "open")?.title, blockers, history: [`${stamp()} · Controlled issue resolved with reviewed ${proof.kind.toLowerCase()} ${proof.name}: ${resolution}`, ...current.history] }; });
    setNotice("The reviewed proof and resolution remain linked to this condition. The next decision can reassess readiness.");
  }
  function recordException(item: Work, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const issueId = String(form.get("issueId") ?? "");
    const proofId = String(form.get("exceptionProofId") ?? "");
    const authority = String(form.get("authority") ?? "").trim();
    const basis = String(form.get("authorityBasis") ?? "").trim();
    const rationale = String(form.get("exceptionRationale") ?? "").trim();
    const target = item.issues?.find((entry) => entry.id === issueId && entry.status === "open" && entry.allowsException);
    const proof = item.evidence?.find((entry) => entry.id === proofId && entry.kind === "Exception authorization" && entry.state === "verified" && entry.added !== "Baseline" && (!target?.affectedPackageId || entry.packageId === target.affectedPackageId));
    if (!target || !proof || !authority || !basis || !rationale || authority.toLowerCase() === currentUserLabel.toLowerCase() || authority.toLowerCase() === target.owner.toLowerCase()) { setNotice("A reviewed exception authorization source, named independent authority, authority basis, and rationale are required. The issue owner cannot authorize their own exception."); return; }
    updateWork(item.id, (current) => { const remaining = (current.issues ?? []).map((entry) => entry.id === issueId ? { ...entry, status: "resolved" as const, proofId, resolution: rationale, exceptionAuthority: authority, authorityBasis: basis } : entry); const blockers = current.blockers.filter((entry) => entry !== (target.blocker ?? target.title)); return { ...current, issues: remaining, issue: remaining.find((entry) => entry.status === "open")?.title, blockers, history: [`${stamp()} · Synthetic exception record for ${target.title}: ${authority} (${basis}) · Source ${proof.name} · ${rationale}`, ...current.history] }; });
    setNotice("The independent synthetic exception is recorded with its source and authority basis. Owner acceptance remains a separate decision.");
  }
  function saveCommercial(item: Work, event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const amount = String(form.get("amount") ?? "").trim() || item.value; const condition = String(form.get("condition") ?? "").trim() || "Commercial terms reviewed"; const confidence = String(form.get("confidence") ?? "Under review"); updateWork(item.id, (current) => ({ ...current, value: amount, commercial: { amount, condition, confidence }, history: [`${stamp()} · Commercial commitment updated: ${amount}`, ...current.history] })); setNotice("Commercial context is now attached to the governing Work Record."); }
  function addLifecycle(item: Work, event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const action = String(form.get("action") ?? "").trim(); const owner = String(form.get("owner") ?? "").trim(); const due = String(form.get("due") ?? ""); if (!action) return; const entry: LifecycleAction = { id: `l-${Date.now()}`, action, owner: owner || "Lifecycle owner to assign", due: due || "To be scheduled", status: "planned" }; updateWork(item.id, (current) => ({ ...current, lifecycle: [...(current.lifecycle ?? []), entry], history: [`${stamp()} · Lifecycle action planned: ${action}`, ...current.history] })); event.currentTarget.reset(); setNotice("A downstream lifecycle action is now connected to the delivered outcome."); }
  async function exportSnapshot() {
    try {
      if (!workLoaded || !preferencesLoaded) throw new Error("Wait for your workspace records and settings to load before downloading a snapshot.");
      const [catalog, schedule] = await Promise.all([sharedWork.refresh(), sharedSchedule.refresh()]);
      const result = await downloadPrototypeSnapshot(activeWorkspace, mergeSharedWork(work, catalog), catalog, schedule,
        { workTypes: configuredTypes, accent, foundation: workspaceDark });
      setNotice(`Downloaded ${result.recordCount} prototype Work Records with a source checksum. This is a recovery snapshot, not accepted proof.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The prototype snapshot could not be downloaded."); }
  }

  return <main className={`d5o-full-app ${visualSystem.root}`} style={{ "--d5o-accent": accent, "--d5o-dark": workspaceDark, "--d5o-on-accent": contrastText(accent), "--d5o-on-dark": contrastText(workspaceDark), "--d5o-accent-light": contrastText(workspaceDark) === "#ffffff" ? "color-mix(in srgb, var(--d5o-accent) 54%, #fff)" : previewAccent(accent, workspaceDark) } as CSSProperties}>
    <aside className={`d5o-full-sidebar${mobileMenuOpen ? " is-menu-open" : ""}`}>
      <button className="d5o-full-brand" aria-label="Open My Work" onClick={() => go("my-work")}><PlatformWordmark /><strong>System of work<small>{palette.short} workspace</small></strong></button>
      <button className="d5o-mobile-menu-toggle" aria-controls="d5o-sidebar-menu" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}><span aria-hidden="true">☰</span>{mobileMenuOpen ? "Close menu" : "Menu"}</button>
      <div className="d5o-sidebar-menu" id="d5o-sidebar-menu">
      <p className="d5o-nav-caption">YOUR WORKSPACE</p>
      <div className="d5o-workspace-switcher"><div className="is-current"><i style={{ background: palette.color }} /><span>{palette.name}<small>{palette.story}</small></span></div></div>
      <nav className="d5o-full-nav" aria-label="Daily work">
        {presentation.primary.map((surface) => { const item = operatingNavigation.find((entry) => entry.screen === surface); return item ? <button key={surface} type="button" aria-current={screen === surface ? "page" : undefined} className={screen === surface ? "is-active" : ""} onClick={() => go(surface)}><PlatformIcon name={item.icon} /><span>{item.label}</span></button> : null; })}
      </nav>
      <details className="d5o-nav-disclosure"><summary>Browse work and context</summary>
        <WorkRecordSwitcher key={activeWorkspace} records={visibleWork} selected={selected} workspaceName={palette.name} currentUser={currentUserLabel} accent={accent} hostedWorkspace={hostedPreview ? activeWorkspace : undefined} onSelect={selectWorkRecord} onOverview={() => { setTab("Overview"); go("record"); }} />
        {presentation.phases.length ? <><p className="d5o-nav-caption">WORK PHASES</p><nav className="d5o-full-nav d5o-sidebar-phase-nav" aria-label="Relevant work phases">{presentation.phases.map((phase) => <button key={phase} type="button" onClick={() => { if (phase === "discover" || phase === "define") openWorkspacePhase(phase); else if (phase === "develop") go("develop"); else if (phase === "operate") go("operate"); else { setTab(phase === "design" ? "Design" : "Deploy"); go("record"); } }}><span>{label(phase)}</span></button>)}</nav></> : null}
        <p className="d5o-nav-caption">REFERENCE VIEWS</p><nav className="d5o-full-nav" aria-label="Reference views">{presentation.context.filter((surface) => !["operating", "configuration", "start", ...(actorRole === "admin" ? ["people"] : [])].includes(surface)).map((surface) => { const item = operatingNavigation.find((entry) => entry.screen === surface); return item ? <button key={surface} type="button" onClick={() => go(surface)}><PlatformIcon name={item.icon} /><span>{item.label}</span></button> : null; })}</nav>
      </details>
      {actorRole === "admin" || !hostedPreview ? <details className="d5o-nav-disclosure"><summary>Administration</summary><nav className="d5o-full-nav" aria-label="Administration"><button type="button" onClick={() => go("people")}><PlatformIcon name="people" /><span>People & capacity</span></button>{designNavigation.map((item) => <button key={item.screen} type="button" onClick={() => go(item.screen)}><PlatformIcon name={item.icon} /><span>{item.label}</span></button>)}</nav></details> : null}
      <div className="d5o-user-card"><span>YOUR ROLE</span><strong>{currentUserLabel}</strong><small>Actions are scoped to this workspace.</small></div>
      <div className="d5o-appearance"><button onClick={() => setAppearanceOpen((open) => !open)}>Appearance {appearanceOpen ? "−" : "+"}</button>{appearanceOpen ? <div><p>Set the workspace accent and foundation colors for this review space.</p><label>Accent<input aria-label="Workspace accent color" type="color" value={accent} onChange={(event) => setAccent(event.target.value)} /></label><label>Foundation<input aria-label="Workspace foundation color" type="color" value={workspaceDark} onChange={(event) => setWorkspaceDark(event.target.value)} /></label><button className="d5o-reset" onClick={() => { setAccent(palette.color); setWorkspaceDark(palette.dark); }}>Restore {palette.short} theme</button>{!hostedPreview ? <button className="d5o-reset" onClick={resetDemo}>Restore sample workspace</button> : null}</div> : null}</div>
      </div>
      <small className="d5o-source-id" title={sourceVersion}>Build {sourceVersion.slice(0, 12)}</small>
    </aside>
      <section className="d5o-full-content"><div className="d5o-app-topbar"><div><span>WORKSPACE</span><strong>{palette.name}</strong><i style={{ background: palette.color }} /></div><div><span>ACTIVE VIEW</span><strong>{screen === "record" ? `${selected?.title ?? "Work Record"} / ${tab}` : ({ discover: "Discover", define: "Define", develop: "Develop", operate: "Operate", home: "Work hub", "my-work": "My work", portfolio: "Portfolio", decisions: "Decision queue", crew: "Crew schedule", people: "People & capacity", execution: "Execution register", handoff: "Handoff register", library: "Evidence library", insights: "Operating insight", operating: "Operating model", configuration: "Workspace configuration", start: "Start work" } as Record<Exclude<Screen, "record">, string>)[screen]}</strong></div><div className="d5o-top-actions">{hostedPreview ? <Link href="/work">Switch workspace</Link> : null}<AccountMenu hostedPreview={hostedPreview} workspace={activeWorkspace} snapshotReady={workLoaded && preferencesLoaded} onExportSnapshot={() => { void exportSnapshot(); }} />{presentation.canStart ? <button onClick={() => go("start")}>+ Start work</button> : null}</div></div>
      {notice ? <div className="d5o-platform-notice" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div> : null}
      <div className="d5o-surface-host">
      {screen === "discover" && !stalePhaseTask && !unavailableRecordId ? <DiscoverWorkspace workspaceKey={activeWorkspace} workspaceName={palette.name} configurationInventory={configurationInventory} work={visibleWork as WorkRecord[]} commercialProfiles={commercialProfiles} actor={currentUserLabel} actorId={actorId ?? undefined} actorRole={actorRole} canEdit={canEditWork && sharedWorkRevision !== null} focusRecordId={selected?.id} reviewFocus={discoverEntry} onPhase={openJourneyPhase} onControl={(item, control) => { setSelectedId(item.id); setTab(control); go("record"); }} onBack={() => taskFocus ? go("my-work") : go("home")} onSelect={setSelectedId} onOpen={(item) => openRecord(item as Work)} onDefine={(item) => openWorkspacePhase("define", item as Work)} onPricingQueued={() => { pendingReviewQueue.current = "pricing"; setNotice("Saving the pricing review before opening its role queue."); }} onProposalQueued={() => { pendingReviewQueue.current = "proposal"; setNotice("Saving the proposal review before opening its role queue."); }} onCommercialCommand={executeCommercialCommand} onPursuitCommand={authoritativeCommands ? executePursuitCommand : undefined} onUpdate={(id, transform) => { pendingDiscoverSave.current = id; updateWork(id, (current) => transform(current as WorkRecord) as Work); }} onCreate={createDiscoverWork} onNotice={setNotice} /> : null}
      {screen === "define" && !stalePhaseTask && !unavailableRecordId ? <DefineWorkspace workspaceKey={activeWorkspace} workspaceName={palette.name} configurationInventory={configurationInventory} work={visibleWork as WorkRecord[]} focusRecordId={selected?.id} reviewFocus={defineReviewEntry} actorLabel={currentUserLabel} onReviewQueued={() => { pendingReviewQueue.current = "definition"; setNotice("Saving the definition review before opening its role queue."); }} onCommand={executeDefineCommand} onPhase={openJourneyPhase} onControl={(item, control) => { setSelectedId(item.id); setTab(control); go("record"); }} onBack={() => taskFocus ? go("my-work") : openWorkspacePhase("discover")} onSelect={setSelectedId} onOpen={(item) => openRecord(item as Work)} onUpdate={(id, transform) => updateWork(id, (current) => transform(current as WorkRecord) as Work)} onNotice={setNotice} /> : null}
      {screen === "develop" && !stalePhaseTask && !unavailableRecordId ? <DiscoverWorkspace
        mode="develop" workspaceKey={activeWorkspace} workspaceName={palette.name} hosted={hostedPreview}
        configurationInventory={configurationInventory} work={visibleWork as WorkRecord[]}
        commercialProfiles={commercialProfiles} actor={currentUserLabel}
        canEdit={canEditWork && sharedWorkRevision !== null} focusRecordId={selected?.id}
        reviewFocus={discoverEntry} onPhase={openJourneyPhase}
        onControl={(item, control) => { setSelectedId(item.id); setTab(control); go("record"); }}
        onBack={() => taskFocus ? go("my-work") : openWorkspacePhase("define", selected)} onSelect={setSelectedId}
        onOpen={(item) => openRecord(item as Work)}
        onDefine={(item) => openWorkspacePhase("define", item as Work)}
        onPolicyUpdated={synchronizePricingRevision}
        onPeople={() => go("people")}
        onPricingQueued={() => { pendingReviewQueue.current = "pricing"; setNotice("Saving the pricing review before opening its role queue."); }}
        onProposalQueued={() => { pendingReviewQueue.current = "proposal"; setNotice("Saving the proposal review before opening its role queue."); }}
        onCommercialCommand={executeCommercialCommand}
        onUpdate={(id, transform) => { pendingDiscoverSave.current = id; updateWork(id, (current) => transform(current as WorkRecord) as Work); }}
        onCreate={createDiscoverWork}
        onNotice={setNotice}
      /> : null}
      {screen === "home" ? <OperationalHome workspaceName={palette.name} currentOwner={currentUserLabel} ownedIds={ownedWorkIds ?? undefined} actions={myActions} work={visibleWork} schedule={sharedSchedule.schedule} scheduleWeek={scheduleWeek} onOpenDecision={(item) => { setSelectedId(item.id); setTab(connectedWorkPosition(item as WorkRecord) ? "Overview" : getBlockers(item).length ? conditionTargetTab(item, getBlockers(item)) : "Readiness"); go("record"); }} onPortfolio={() => { setPortfolioFilter("all"); setPortfolioSearch(""); go("portfolio"); }} onConditions={() => { setPortfolioFilter("blocked"); setPortfolioSearch(""); go("portfolio"); }} onAssignedToYou={() => go("my-work", { myWork: "mine" })} onMyWork={() => go("my-work")} onCrewCoverage={() => go("crew", { crew: "coverage" })} onCrewAttendance={() => go("crew", { crew: "attendance" })} getBlockers={getBlockers} currentPosition={(item) => connectedWorkPosition(item as WorkRecord)} /> : null}
      {screen === "operate" ? <OperateBoard workspace={activeWorkspace} workspaceName={palette.name} work={visibleWork as WorkRecord[]} timezoneByWorkId={operateTimezones} onOpen={(id, section) => { const target = visibleWork.find((item) => item.id === id); if (!target) return; setSelectedId(id); setOperateFocus({ workId: id, section }); setTab("Operate"); go("record"); }} onBrowse={() => go("portfolio")} /> : null}
      {screen === "my-work" ? <MyWorkBoard hostedWorkspace={hostedPreview ? activeWorkspace : undefined} actions={myActions} currentOwner={currentUserLabel} initialFilter={myWorkEntry} onOpen={(item) => { const record = visibleWork.find((entry) => entry.id === item.id) ?? (item as Work & { source?: Work }).source ?? item; selectWorkRecord(record); setTab(getDecisionContext(record).target); go("record"); }} onReviewPricing={(item) => { selectWorkRecord((item as Work & { source?: Work }).source ?? item); setDiscoverEntry("pricing"); go("develop"); }} onReviewProposal={(item) => { selectWorkRecord((item as Work & { source?: Work }).source ?? item); setDiscoverEntry("proposal"); go("develop"); }} onReviewDefinition={(item, role) => { selectWorkRecord((item as Work & { source?: Work }).source ?? item); setDefineReviewEntry(role); go("define"); }} getDecisionContext={getDecisionContext} /> : null}
      {screen === "portfolio" ? <PortfolioBoard hostedPreview={hostedPreview} workspaceKey={activeWorkspace} work={operationalWork} scheduleAssignments={scheduleAssignments.filter((item) => item.week === scheduleWeek).map((item) => ({ ...item, week: 0 }))} search={portfolioSearch} setSearch={setPortfolioSearch} filter={portfolioFilter} setFilter={setPortfolioFilter} onOpen={(item) => { const record = visibleWork.find((candidate) => candidate.id === item.id) ?? item as Work; selectWorkRecord(record); setTab(portfolioFilter === "blocked" ? conditionTargetTab(record) : "Overview"); go("record"); }} /> : null}
      {screen === "decisions" ? <DecisionBoard hostedWorkspace={hostedPreview ? activeWorkspace : undefined} work={visibleWork.map((item) => ({ ...item, readinessBlockers: getBlockers(item) }))} getDecisionContext={getDecisionContext} onOpen={(item) => { const record = visibleWork.find((entry) => entry.id === item.id) ?? (item as Work & { source?: Work }).source ?? item; selectWorkRecord(record); setTab(getDecisionContext(record).target); go("record"); }} /> : null}
      {screen === "crew" ? <CrewPlanningBoard workspaceKey={activeWorkspace} work={operationalWork} profiles={schedulingProfiles} shared={sharedSchedule} entryFocus={crewEntry} focusWorkId={crewFocusWorkId} onOpen={(item) => { const record = visibleWork.find((candidate) => candidate.id === item.id); if (record) { setSelectedId(record.id); setTab("Design"); go("record"); } }} onOpenDecision={(item) => { const record = visibleWork.find((candidate) => candidate.id === item.id); if (record) { setSelectedId(record.id); setTab(getBlockers(record).length ? conditionTargetTab(record, getBlockers(record)) : "Readiness"); go("record"); } }} /> : null}
      {screen === "people" ? <PeopleCapacityBoard workspaceKey={activeWorkspace} work={operationalWork} profiles={schedulingProfiles} assignments={scheduleAssignments} weekIndex={scheduleWeek} anchorDate={sharedSchedule.schedule?.anchorDate ?? ""} availabilityBlocks={availabilityBlocks} packageDemands={sharedSchedule.schedule?.packageDemands ?? []} onAvailabilityChange={(blocks) => sharedSchedule.mutate({ action: "save-availability", availabilityBlocks: blocks }).then(() => undefined)} onSchedule={() => go("crew")} /> : null}
      {screen === "people" && hostedPreview && actorRole === "admin" ? <MemberAccessPanel workspace={activeWorkspace} /> : null}
      {screen === "execution" ? <ExecutionFactsBoard workspaceName={palette.name} work={operationalWork as WorkRecord[]} schedule={sharedSchedule.schedule} onOpen={(item) => { setSelectedId(item.id); setTab("Deploy"); go("record"); }} onSchedule={() => go("crew")} /> : null}
      {screen === "handoff" ? <HandoffControlBoard workspaceName={palette.name} work={operationalWork as WorkRecord[]} onOpen={(item, section) => { setSelectedId(item.id); setTab(section); setOperateFocus(section === "Operate" ? { workId: item.id, section: "Handoff & activation" } : null); go("record"); }} /> : null}
      {screen === "library" ? <EvidenceLibrary work={visibleWork} onOpen={(item) => { setSelectedId(item.id); setTab("Evidence"); go("record"); }} /> : null}
      {screen === "insights" ? <OperatingInsights workspaceName={palette.name} work={operationalWork} scheduleAssignments={scheduleAssignments.filter((item) => item.week === scheduleWeek).map((item) => ({ ...item, week: 0 }))} onOpen={openRecord} /> : null}
      {screen === "operating" ? <OperatingModel workspaceKey={activeWorkspace} workspaceName={palette.name} /> : null}
      {screen === "configuration" ? <WorkspaceStudio workspaceKey={activeWorkspace} workspaceName={palette.name} configurationInventory={configurationInventory} canManageWorkerAccounts={hostedPreview && actorRole === "admin" && activeWorkspace === "rybex"} accent={accent} foundation={workspaceDark} workTypes={configuredTypes} commercialProfiles={commercialProfiles} onAccent={setAccent} onFoundation={setWorkspaceDark} onWorkTypes={setConfiguredTypes} onCommercialProfiles={(profiles) => { setCommercialProfiles(profiles); setCommercialPolicyInitialized(true); }} /> : null}
      {screen === "start" ? <StartWork workspaceKey={activeWorkspace} workspaceName={palette.name} workTypes={publishedStartTypes} publishedVersionId={configurationInventory.status === "ready" ? configurationInventory.activeVersionId : null} defaultOwner={currentUserLabel} onSubmit={startWork} onCancel={() => go("home")} /> : null}
      {screen === "record" && selected ? <WorkRecord key={`${selected.id}:${taskFocus ?? "full"}`} taskFocus={taskFocus} taskPackageId={taskPackageId} taskRequestId={taskRequestId} onFullRecord={() => { setTaskFocus(null); setTaskPackageId(null); setTaskRequestId(null); const url = new URL(window.location.href); for (const key of ["focus", "decision", "sourceRevision", "decisionRevision", "package", "release", "turnover", "documentKind", "deployRevision", "request"]) url.searchParams.delete(key); window.history.replaceState(window.history.state, "", url); }} profiles={schedulingProfiles} actorId={actorId ?? "unknown-user"} actorRole={actorRole} work={selected} allWork={visibleWork} configurationInventory={configurationInventory} onSelectDesignWork={(id) => { setSelectedId(id); setTab("Design"); }} tab={tab} setTab={setTab} phaseConfig={selectedPhaseConfig} phaseDemandCount={(sharedSchedule.schedule?.packageDemands ?? []).filter((item) => item.workId === selected.id).length} phaseAssignmentCount={scheduleAssignments.filter((item) => item.workId === selected.id).length} onPhaseRowSave={(key, row, index) => savePhaseRow(selected, key, row, index)} onPhaseRowRemove={(key, index) => removePhaseRow(selected, key, index)} backLabel={operatingNavigation.find((item) => item.screen === recordReturn)?.label ?? designNavigation.find((item) => item.screen === recordReturn)?.label ?? "Work hub"} onBack={() => taskFocus ? go("my-work") : go(recordReturn, { myWork: myWorkEntry, crew: crewEntry ?? undefined })} onOpenDiscovery={() => openWorkspacePhase("discover", selected)} onOpenDefinition={() => openWorkspacePhase("define", selected)} onOpenDevelop={() => { setDiscoverEntry(null); go("develop"); }} onOpenPeople={() => go("people")} onOpenCrew={() => { go("crew"); setCrewFocusWorkId(selected.id); }} onActionPriority={(event) => saveActionPriority(selected, event)} onEvidence={(event) => addEvidence(selected, event)} onReviewEvidence={(event) => reviewEvidence(selected, event)} onPackage={(event) => addPackage(selected, event)} onPackageDemand={(event) => savePackageDemand(selected, event)} packageDemands={sharedSchedule.schedule?.packageDemands ?? []} canEditDemand={sharedSchedule.canEdit} onPackageFacts={(event) => recordPackageFacts(selected, event)} onAdvancePackage={(id) => advancePackage(selected, id)} onIssue={(event) => createIssue(selected, event)} onResolveIssue={(event) => resolveIssue(selected, event)} onException={(event) => recordException(selected, event)} onCommercial={(event) => saveCommercial(selected, event)} onLifecycle={(event) => addLifecycle(selected, event)} onDesignCommand={(command) => executeDesignCommand({ ...command, workId: selected.id })} schedule={sharedSchedule.schedule ?? null} onDeployCommand={(command) => executeDeployCommand({ ...command, workId: selected.id })} onDeployUpload={(packageId, data) => uploadDeployEvidence(selected.id, packageId, data)} hosted={hostedPreview} onOperateCommand={(command) => executeOperateCommand({ ...command, workId: selected.id })} operateFocus={operateFocus?.workId === selected.id ? operateFocus.section : "Overview"} onOpenOperateWork={(id, section) => { const target = visibleWork.find((item) => item.id === id); setSelectedId(id); setOperateFocus(section && target?.operate ? { workId: id, section } : null); if (target?.discovery && !target?.serviceSource && !target?.operate) { go("discover"); return; } setTab(target?.serviceSource ? "Design" : target?.operate ? "Operate" : "Overview"); }} onDesignHandoff={(decision, note) => executeCommercialCommand({ workId: selected.id, action: decision, packageRevision: selected.discovery?.proposal.package?.revision ?? 0, handoffRevision: selected.discovery?.designHandoff?.revision, note })} /> : null}
      {stalePhaseTask && !unavailableRecordId ? <section className="d5o-panel" role="alert"><h2>This task changed or was decided</h2><p>The exact source revision is no longer available for this action. No other Work Record or revision was selected.</p><button onClick={() => go("my-work")}>Return to refreshed My Work</button></section> : null}
      {(["record", "define", "develop"] as Screen[]).includes(screen) && unavailableRecordId ? <section className="d5o-panel" role="alert"><h2>Work Record unavailable</h2><p>The requested record {unavailableRecordId} is unavailable in this workspace. Refresh the queue to find the current decision.</p><button onClick={() => go("my-work")}>Return to My Work</button></section> : null}
      </div>
    </section>
  </main>;
}


function ActionList({ actions, onOpen, expanded = false }: { actions: Work[]; onOpen: (item: Work) => void; expanded?: boolean }) { return <div className="d5o-action-list-full">{actions.length ? actions.map((item) => <button key={item.id} onClick={() => onOpen(item)}><i className={item.status} /><div><small>{item.stage} · {item.status === "attention" ? "Needs attention" : "Moving forward"}</small><strong>{item.nextAction}</strong><span>{item.title} · Accountable: {item.owner}</span>{expanded ? <><em>{item.blockers[0] || "Ready for your decision."}</em><u>Protected value: {item.value}</u></> : null}</div><b>Review →</b></button>) : <p>Your queue is clear.</p>}</div>; }
function CrewSchedule({ workspaceKey, work, onOpen }: { workspaceKey: WorkspaceKey; work: Work[]; onOpen: (item: Work) => void }) {
  const crew = workspaceKey === "rybex"
    ? [
        { name: "Fiber installation crew", lead: "Nate Walker", capacity: "6 / 6 assigned", readiness: "Ready", package: "Fiber trunks and termination", slot: "Mon 07:00–15:30", workId: "rybex-1", note: "FT-24 retest window reserved with quality witness." },
        { name: "Network cabling crew", lead: "Jules Ortiz", capacity: "4 / 5 assigned", readiness: "Ready", package: "Copper management-network cabling", slot: "Mon 07:00–15:30", workId: "rybex-1", note: "Labeling and final route verification." },
        { name: "Commissioning & turnover", lead: "Maya Chen", capacity: "3 / 4 assigned", readiness: "Controlled condition", package: "Certification and turnover package", slot: "Tue 08:00–14:00", workId: "rybex-1", note: "Owner turnover review remains contingent on FT-24." },
        { name: "Lifecycle service crew", lead: "Owen Price", capacity: "2 / 3 assigned", readiness: "Planned", package: "Generator monitoring upgrade", slot: "Wed 09:00–16:00", workId: "rybex-3", note: "Assessment follow-up and package plan confirmation." }
      ]
    : [
        { name: "Pilot delivery team", lead: "Priya Shah", capacity: "4 / 4 assigned", readiness: "Ready", package: "Paid pilot delivery", slot: "Mon 08:00–16:00", workId: "rotork-1", note: "Pilot evidence review support." },
        { name: "Service engineering", lead: "Elliot Brooks", capacity: "3 / 4 assigned", readiness: "Planned", package: "Assessment and modernization case", slot: "Tue 09:00–15:00", workId: "rotork-2", note: "Commercial condition and service baseline refinement." },
        { name: "Rollout field team", lead: "Harper Singh", capacity: "5 / 6 assigned", readiness: "Awaiting authority", package: "Rollout authorization package", slot: "Wed 07:00–15:30", workId: "rotork-3", note: "Tranche release follows the governed authorization." }
      ];
  const controlled = crew.filter((item) => item.readiness === "Controlled condition" || item.readiness === "Awaiting authority").length;
  return <section className="d5o-page d5o-crew-page"><p className="d5o-page-kicker">RESOURCE & CREW SCHEDULE</p><h1>Put the right crew on controlled work.</h1><p className="d5o-page-lead">Crew allocation follows the Work Record. This view makes capacity, work-package ownership, readiness and the condition that can stop the day visible before the crew is committed.</p><CrewScheduler workspaceKey={workspaceKey} work={work} /><section className="d5o-system-metrics"><article><span>CREWS SCHEDULED</span><strong>{crew.length}</strong><small>Delivery teams with an active work-package commitment</small></article><article><span>CAPACITY ASSIGNED</span><strong>{crew.reduce((sum, item) => sum + Number(item.capacity.split(" /")[0]), 0)}</strong><small>People allocated across the displayed schedule</small></article><article><span>CONTROLLED CONSTRAINTS</span><strong>{controlled}</strong><small>Conditions that need authority or resolution before release</small></article><article><span>WORK PACKAGES</span><strong>{new Set(crew.map((item) => item.package)).size}</strong><small>Controlled execution units receiving crew capacity</small></article></section><section className="d5o-crew-board"><header><div><p>THIS WEEK</p><h2>Crew commitments and release conditions</h2></div><span>Capacity is associated with controlled work, never a generic task list.</span></header><div className="d5o-crew-days"><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span></div><div className="d5o-crew-list">{crew.map((item) => { const record = work.find((candidate) => candidate.id === item.workId); return <button key={item.name} className={item.readiness === "Controlled condition" || item.readiness === "Awaiting authority" ? "is-constrained" : ""} onClick={() => record && onOpen(record)}><div className="d5o-crew-identity"><i>{item.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</i><span><strong>{item.name}</strong><small>Lead: {item.lead} · {item.capacity}</small></span></div><div><b>{item.slot}</b><strong>{item.package}</strong><small>{record?.title ?? "Work Record"}</small></div><div className="d5o-crew-readiness"><span>{item.readiness}</span><small>{item.note}</small></div><em>Open work →</em></button>; })}</div></section><section className="d5o-crew-callout"><div><p>OPERATING RULE</p><h2>Readiness releases a crew; it does not merely describe the work.</h2><span>When a package has a failed test, missing authority, unavailable proof or a safety constraint, the schedule exposes the condition before capacity is consumed. The Work Record remains the source of the corrective action and audit history.</span></div><div><strong>{workspaceKey === "rybex" ? "FT-24 retest is the first release condition." : "Rollout authority is the first release condition."}</strong><small>Open the linked Work Record to resolve the condition, update proof, or record the required decision.</small></div></section></section>;
}

function CrewScheduler({ workspaceKey, work }: { workspaceKey: WorkspaceKey; work: Work[] }) {
  type ScheduledCrew = { id: string; name: string; people: string[]; workTitle: string; packageName: string; shift: string; release: string };
  const availablePeople = workspaceKey === "rybex"
    ? ["Nate Walker", "Avery Reed", "Tomas Bell", "Mia Owens", "Jordan Lee", "Samira Khan", "Jules Ortiz", "Drew Myers", "Riley Grant", "Kai Patel", "Maya Chen", "Inez Flores", "Owen Price", "Quinn Hart"]
    : ["Priya Shah", "Omar Ellis", "Gabe Watts", "Zoe King", "Elliot Brooks", "Dani Ross", "Morgan Li", "Harper Singh", "Noah James", "Aisha Brown", "Cole Martin", "Eva Wilson"];
  const packageOptions = work.flatMap((item) => (item.packages ?? []).map((entry) => ({ key: item.id + "|" + entry.name, workId: item.id, workTitle: item.title, packageName: entry.name })));
  const [people, setPeople] = useState<string[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledCrew[]>([]);
  const [message, setMessage] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selected = packageOptions.find((item) => item.key === String(form.get("package")));
    const crewName = String(form.get("crew") ?? "").trim();
    const shift = String(form.get("shift") ?? "").trim();
    if (!selected || !crewName || !people.length) { setMessage("Choose controlled work and at least one named person before scheduling the crew."); return; }
    const target = work.find((item) => item.id === selected.workId);
    setScheduled((current) => [{ id: "scheduled-" + Date.now(), name: crewName, people, workTitle: selected.workTitle, packageName: selected.packageName, shift, release: target?.blockers.length ? "Controlled condition: " + target.blockers[0] : "Ready for the planned shift" }, ...current]);
    setPeople([]); event.currentTarget.reset(); setMessage(people.length + " person" + (people.length === 1 ? "" : "s") + " scheduled to " + selected.packageName + ".");
  }
  return <section className="d5o-crew-scheduler"><form onSubmit={submit}><header><p>SCHEDULE A CREW</p><h2>Build a crew assignment</h2><span>Select people, then tie their shift to one accountable package.</span></header><div className="d5o-crew-form-fields"><label>Crew name<input name="crew" placeholder="For example: Fibre remediation crew" required /></label><label>Work Record & package<select name="package" defaultValue="" required><option value="" disabled>Select controlled work</option>{packageOptions.map((item) => <option key={item.key} value={item.key}>{item.workTitle} — {item.packageName}</option>)}</select></label><label>Shift<select name="shift" defaultValue="Thu 07:00–15:30"><option>Mon 07:00–15:30</option><option>Tue 08:00–16:00</option><option>Wed 07:00–15:30</option><option>Thu 07:00–15:30</option><option>Fri 07:00–13:00</option></select></label></div><div className="d5o-person-picker"><span>SELECT PEOPLE · {people.length} chosen</span><div>{availablePeople.map((person) => <label key={person}><input type="checkbox" checked={people.includes(person)} onChange={() => setPeople((current) => current.includes(person) ? current.filter((item) => item !== person) : [...current, person])} />{person}</label>)}</div></div><button className="d5o-primary">Schedule selected people</button>{message ? <p className="d5o-schedule-message" role="status">{message}</p> : null}</form><aside><p>HOW SHAWN SCHEDULES</p><ol><li><b>1</b><span>Choose the Work Record and controlled package.</span></li><li><b>2</b><span>Select the named people who will form the crew.</span></li><li><b>3</b><span>Set the shift and create the crew assignment.</span></li><li><b>4</b><span>Resolve any release condition in the linked Work Record.</span></li></ol><strong>Scheduling does not override readiness.</strong><small>A crew can be planned against constrained work, but its release condition stays visible and is governed by the Work Record.</small></aside>{scheduled.length ? <section className="d5o-created-crews"><p>NEW CREW ASSIGNMENTS</p>{scheduled.map((assignment) => <article key={assignment.id}><strong>{assignment.name}</strong><span>{assignment.shift} · {assignment.workTitle}</span><small>{assignment.packageName} · {assignment.people.join(" · ")}</small><em>{assignment.release}</em></article>)}</section> : null}</section>;
}

function OperatingInsights({ workspaceName, work, scheduleAssignments, onOpen }: { workspaceName: string; work: Work[]; scheduleAssignments: Assignment[]; onOpen: (item: Work) => void }) {
  const attention = work.filter((item) => item.status === "attention");
  const plannedHours = scheduleAssignments.filter((item) => (item.week ?? 0) === 0).reduce((sum, item) => sum + shiftHours(item.shift) * item.people.length, 0);
  const lifecycle = work.flatMap((item) => (item.lifecycle ?? []).map((action) => ({ ...action, work: item })));
  return <section className="d5o-page d5o-system-page"><p className="d5o-page-kicker">OPERATING INSIGHT</p><h1>Operating exceptions and commitments</h1><p className="d5o-page-lead">{workspaceName}: current work, planned crew capacity, conditions requiring decisions, and lifecycle follow-through.</p><section className="d5o-system-metrics"><article><span>ACTIVE WORK</span><strong>{work.length}</strong><small>Governed Work Records in this workspace</small></article><article><span>CONTROLLED CONDITIONS</span><strong>{attention.reduce((sum, item) => sum + item.blockers.length, 0)}</strong><small>Conditions preventing a governed transition</small></article><article><span>PLANNED PERSON-HOURS</span><strong>{plannedHours}h</strong><small>Planned crew assignments this week</small></article><article><span>LIFECYCLE ACTIONS</span><strong>{lifecycle.length}</strong><small>Downstream commitments retained with work</small></article></section><section className="d5o-insight-grid"><article className="d5o-panel"><header><p>LEADERSHIP ATTENTION</p><h2>Decisions with material consequence</h2></header>{attention.length ? <ActionList actions={attention} onOpen={onOpen} expanded /> : <p className="d5o-empty-state">No controlled conditions are waiting for escalation.</p>}</article><article className="d5o-panel"><header><p>LIFECYCLE FOLLOW-THROUGH</p><h2>Outcomes that still need ownership</h2></header><div className="d5o-system-list">{lifecycle.map((action) => <button key={action.id} onClick={() => onOpen(action.work)}><span>{action.status}</span><strong>{action.action}</strong><small>{action.work.title} · {action.owner} · {action.due}</small></button>)}</div></article></section><section className="d5o-panel"><header><p>WORK POSITION</p><h2>Portfolio by current governed position</h2></header><div className="d5o-stage-distribution">{work.map((item) => <button key={item.id} onClick={() => onOpen(item)}><span>{item.stage}</span><strong>{item.title}</strong><small>{item.nextAction} · {item.value}</small><i style={{ width: `${Math.max(8, item.progress)}%` }} /></button>)}</div></section></section>;
}

function ExecutionBoard({ workspaceName, workspaceKey, work, onOpen }: { workspaceName: string; workspaceKey: WorkspaceKey; work: Work[]; onOpen: (item: Work) => void }) {
  const packages = work.flatMap((item) => (item.packages ?? []).map((entry) => ({ ...entry, work: item })));
  const average = (key: "installed" | "tested" | "accepted") => packages.length ? Math.round(packages.reduce((sum, item) => sum + item[key], 0) / packages.length) : 0;
  const constrained = packages.filter((item) => item.status !== "accepted" && item.work.blockers.length > 0);
  const labels = workspaceKey === "rybex" ? ["Installed", "Tested", "Accepted"] : ["Assessment", "Pilot proof", "Authorized"];
  return <section className="d5o-execution-board"><header className="d5o-board-hero"><div><p>EXECUTION & CONTROL · {workspaceName.toUpperCase()}</p><h1>Make delivery visible before it becomes a handoff problem.</h1><span>Work is controlled through accountable packages. Progress, proof and governed acceptance remain separate so leadership can see where delivery is actually ready to move.</span></div><aside><b>CONTROL RULE</b><strong>Planning a crew or progressing a package never overrides readiness.</strong><small>Each work package stays connected to its Work Record, evidence and release condition.</small></aside></header><section className="d5o-execution-pulse"><article><span>{labels[0].toUpperCase()}</span><strong>{average("installed")}%</strong><small>Work facts captured</small></article><article><span>{labels[1].toUpperCase()}</span><strong>{average("tested")}%</strong><small>Proof available for review</small></article><article><span>{labels[2].toUpperCase()}</span><strong>{average("accepted")}%</strong><small>Governed outcome recorded</small></article><article className={constrained.length ? "has-risk" : ""}><span>CONTROLLED CONDITIONS</span><strong>{constrained.length}</strong><small>Packages linked to a blocking condition</small></article></section><section className="d5o-execution-layout"><article className="d5o-execution-main"><header><p>PACKAGE CONTROL BOARD</p><h2>Work packages moving through delivery</h2><span>Choose a package to open the decision and evidence context in its Work Record.</span></header><div className="d5o-package-board-head"><span>WORK / PACKAGE</span><span>OWNER</span><span>PROGRESS</span><span>RELEASE</span></div>{packages.map((item) => <button key={item.id} onClick={() => onOpen(item.work)}><div><small>{item.work.title}</small><strong>{item.name}</strong><em>{item.work.site}</em></div><div><strong>{item.owner}</strong><small>{label(item.status)}</small></div><div className="d5o-package-progress"><span><i style={{ width: `${item.installed}%` }} />Installed <b>{item.installed}%</b></span><span><i style={{ width: `${item.tested}%` }} />Tested <b>{item.tested}%</b></span><span><i style={{ width: `${item.accepted}%` }} />Accepted <b>{item.accepted}%</b></span></div><div className={item.work.blockers.length ? "is-held" : ""}><b>{item.work.blockers.length ? "Condition open" : "Ready to progress"}</b><small>{item.work.blockers[0] || "Current package path is clear"}</small></div></button>)}</article><aside className="d5o-execution-side"><p>OPERATING DISCIPLINE</p><h2>What the numbers mean</h2><ol><li><b>1</b><span><strong>Installed</strong>Delivery team has recorded the work fact.</span></li><li><b>2</b><span><strong>Tested</strong>Required test or review proof is available.</span></li><li><b>3</b><span><strong>Accepted</strong>Authority has accepted the governed outcome.</span></li></ol><div><strong>{workspaceKey === "rybex" ? "Rybex control" : "Rotork control"}</strong><small>{workspaceKey === "rybex" ? "A failed fibre result stays isolated until retest or an independently authorized exception." : "Pilot evidence and commercial readiness must support rollout authority."}</small></div></aside></section></section>;
}

function HandoffBoard({ workspaceName, workspaceKey, work, onOpen }: { workspaceName: string; workspaceKey: WorkspaceKey; work: Work[]; onOpen: (item: Work) => void }) {
  const handoff = work.filter((item) => item.progress >= 65 || item.status === "complete");
  const lifecycle = work.flatMap((item) => (item.lifecycle ?? []).map((action) => ({ ...action, work: item })));
  const ready = handoff.filter((item) => !item.blockers.length).length;
  return <section className="d5o-handoff-board"><header className="d5o-board-hero d5o-handoff-hero"><div><p>HANDOFF & LIFECYCLE · {workspaceName.toUpperCase()}</p><h1>Finish the promise. Keep ownership after delivery.</h1><span>Handoff is where accepted work, proof, accountable acceptance and the next lifecycle owner meet. The outcome remains connected to future value rather than disappearing at closeout.</span></div><aside><b>OUTCOME CONTINUITY</b><strong>Acceptance is an accountable decision, not a document upload.</strong><small>The handoff package, decision history and lifecycle follow-through stay with the same Work Record.</small></aside></header><section className="d5o-handoff-stats"><article><span>HANDOFFS IN VIEW</span><strong>{handoff.length}</strong><small>Work approaching or in outcome transfer</small></article><article><span>READY FOR NEXT AUTHORITY</span><strong>{ready}</strong><small>Records without an open controlled condition</small></article><article><span>LIFECYCLE ACTIONS</span><strong>{lifecycle.length}</strong><small>Downstream commitments with named owners</small></article><article><span>VALUE IN FOLLOW-THROUGH</span><strong>{workspaceKey === "rybex" ? "$1.01m" : "$4.02m"}</strong><small>Value remains visible beyond initial delivery</small></article></section><section className="d5o-handoff-layout"><article className="d5o-handoff-queue"><header><p>HANDOFF CONTROL BOARD</p><h2>What must be complete before the outcome transfers</h2></header>{handoff.map((item) => <button key={item.id} onClick={() => onOpen(item)}><div className={`d5o-handoff-status ${item.blockers.length ? "is-held" : item.status === "complete" ? "is-complete" : ""}`}><b>{item.blockers.length ? "!" : item.status === "complete" ? "✓" : "→"}</b><span>{item.blockers.length ? "Condition open" : item.status === "complete" ? "Outcome accepted" : "Next authority"}</span></div><div><small>{item.type} · {item.customer}</small><strong>{item.title}</strong><span>{item.stage} · {item.nextAction}</span><em>{item.blockers[0] || "Evidence, decision history and next owner are available in the Work Record."}</em></div><div className="d5o-handoff-value"><b>{item.value}</b><span>{(item.lifecycle ?? [])[0]?.action || "Lifecycle action to define"}</span></div><i>Open →</i></button>)}</article><aside className="d5o-lifecycle-actions"><header><p>AFTER HANDOFF</p><h2>Lifecycle actions with an owner</h2></header>{lifecycle.map((action) => <button key={action.id} onClick={() => onOpen(action.work)}><i>↗</i><div><strong>{action.action}</strong><span>{action.work.title}</span><small>{action.owner} · {action.due}</small></div><b>{label(action.status)}</b></button>)}</aside></section><section className="d5o-handoff-principles"><article><b>01</b><strong>Verification is distinct from acceptance</strong><span>Internal proof review does not substitute for customer or configured authority acceptance.</span></article><article><b>02</b><strong>Accepted work retains its proof</strong><span>The evidence package and the authority basis remain reconstructable from the Work Record.</span></article><article><b>03</b><strong>Value has a next owner</strong><span>A lifecycle action carries downstream responsibility forward after the original outcome is handed over.</span></article></section></section>;
}

function OperatingModel({ workspaceKey, workspaceName }: { workspaceKey: WorkspaceKey; workspaceName: string }) {
  const journey = workspaceKey === "rybex" ? ["Intake & shape", "Plan controlled delivery", "Readiness and authorization", "Execute work packages", "Verify and hand over", "Protect lifecycle value"] : ["Assessment", "Paid pilot", "Pilot review", "Commercial readiness", "Rollout authorization", "Lifecycle service"];
  return <section className="d5o-page d5o-system-page"><p className="d5o-page-kicker">OPERATING MODEL</p><h1>One system of work. Configured for this organization.</h1><p className="d5o-page-lead">D5O keeps a stable Work Record while the configured lifecycle, readiness conditions, evidence, authority and outcomes change with the work type and workspace.</p><section className="d5o-operating-architecture"><article><span>WORK RECORD</span><strong>One governed unit of work</strong><small>Customer, site, work type, packages, participants, evidence, decisions, commitments and history stay connected.</small></article><i>↓</i><article><span>CONFIGURED ENGINE</span><strong>{workspaceName}</strong><small>Applies the effective lifecycle, gate, evidence and decision-authority pattern without creating a separate application.</small></article><i>↓</i><article><span>GOVERNED OUTCOME</span><strong>Accepted result and lifecycle value</strong><small>The resulting outcome, handoff owner and future action remain part of the same record.</small></article></section><section className="d5o-panel"><header><p>ACTIVE CONFIGURED JOURNEY</p><h2>{workspaceKey === "rybex" ? "Technical delivery and controlled turnover" : "Modernization, pilot and rollout"}</h2></header><div className="d5o-configured-journey">{journey.map((step, index) => <article key={step}><b>0{index + 1}</b><strong>{step}</strong><small>{index === 0 ? "Establish ownership and business purpose" : index === journey.length - 1 ? "Retain value and downstream accountability" : "Apply configured readiness, proof and authority"}</small></article>)}</div></section><section className="d5o-system-grid"><article><p>DECISION AUTHORITY</p><strong>Configured rights and separation of duty</strong><span>Who can verify, authorize an exception, accept, or release the next lifecycle position is explicit and retained in history.</span></article><article><p>EVIDENCE AND READINESS</p><strong>Proof supports a specific governed action</strong><span>Evidence is evaluated in context. It does not become a generic document pile or a substitute for authority.</span></article><article><p>FINANCIAL AND VALUE CONTEXT</p><strong>Commercial consequence travels with work</strong><span>Value commitments and commercial conditions remain visible when decisions are made and outcomes are handed over.</span></article></section></section>;
}
function WorkspaceConfiguration({ workspaceKey, workspaceName, accent, foundation }: { workspaceKey: WorkspaceKey; workspaceName: string; accent: string; foundation: string }) {
  const workTypes = workspaceKey === "rybex" ? ["Technical delivery", "Retrofit", "Controlled work package", "Lifecycle service"] : ["Assessment", "Modernization service", "Paid pilot", "Rollout tranche", "Lifecycle service"];
  return <section className="d5o-page d5o-system-page"><p className="d5o-page-kicker">WORKSPACE CONFIGURATION</p><h1>Configure how governed work moves.</h1><p className="d5o-page-lead">This surface makes the operating contract visible for {workspaceName}: the workspace boundary, effective work types, lifecycle, authority and evidence patterns that govern new Work Records.</p><section className="d5o-configuration-grid"><article><span>WORKSPACE BOUNDARY</span><strong>{workspaceName}</strong><small>All work, roles, authority and proof remain inside this workspace scope.</small><div><i style={{ background: accent }} /> Accent {accent}<i style={{ background: foundation }} /> Foundation {foundation}</div></article><article><span>WORK TYPES</span><strong>{workTypes.length} configured types</strong><ul>{workTypes.map((type) => <li key={type}>{type}</li>)}</ul></article><article><span>AUTHORITY MODEL</span><strong>Role, assignment and separation of duty</strong><small>Decision rights are resolved in the workspace and captured with each authoritative outcome.</small></article><article><span>EVIDENCE MODEL</span><strong>Requirement-specific proof</strong><small>Proof is connected to a work condition, verified in context and retained with its decision history.</small></article><article><span>LIFECYCLE MODEL</span><strong>Pinned effective configuration</strong><small>In-flight work keeps its governing lifecycle, gate and acceptance requirement until an explicit governed migration exists.</small></article><article><span>VALUE MODEL</span><strong>Commercial and lifecycle commitments</strong><small>Value, condition and future ownership remain available beyond the initial delivery or rollout decision.</small></article></section></section>;
}
function Portfolio({ work, search, setSearch, filter, setFilter, onOpen }: { work: Work[]; search: string; setSearch: (value: string) => void; filter: "all" | "attention" | "moving" | "complete"; setFilter: (value: "all" | "attention" | "moving" | "complete") => void; onOpen: (item: Work) => void }) {
  const filtered = work.filter((item) => (filter === "all" || item.status === filter) && `${item.title} ${item.customer} ${item.owner} ${item.stage}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="d5o-page d5o-portfolio-page"><header className="d5o-portfolio-heading"><div><p className="d5o-page-kicker">PORTFOLIO</p><h1>See the whole flow of work.</h1><p className="d5o-page-lead">Find each Work Record by lifecycle position, health, accountable owner, next action and protected value.</p></div><div className="d5o-portfolio-controls"><label>Find work<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search work, customer or owner" /></label><label>Health<select value={filter} onChange={(event) => setFilter(event.target.value as "all" | "attention" | "moving" | "complete")}><option value="all">All work</option><option value="attention">Needs attention</option><option value="moving">Moving</option><option value="complete">Complete</option></select></label></div></header><section className="d5o-portfolio-table"><header><span>WORK RECORD</span><span>POSITION</span><span>NEXT ACTION</span><span>VALUE</span><span /></header>{filtered.map((item) => <button key={item.id} onClick={() => onOpen(item)}><div><small>{item.type}</small><strong>{item.title}</strong><span>{item.customer} · {item.site}</span></div><div><b className={item.status}>{label(item.status)}</b><span>{item.stage}</span></div><div><strong>{item.nextAction}</strong><span>{item.owner}</span></div><div><strong>{item.value}</strong><span>{item.progress}% through current path</span></div><i>→</i></button>)}{!filtered.length ? <p className="d5o-empty-copy">No Work Record matches this view.</p> : null}</section></section>;
}
function Journey({ work, onOpen, wide = false }: { work: Work[]; onOpen: (item: Work) => void; wide?: boolean }) { const stages = [...new Set(work.map((item) => item.stage))]; return <div className={`d5o-journey${wide ? " is-wide" : ""}`}>{stages.map((stage) => <section key={stage}><header><span>{stage}</span><b>{work.filter((item) => item.stage === stage).length}</b></header>{work.filter((item) => item.stage === stage).map((item) => <button key={item.id} onClick={() => onOpen(item)}><strong>{item.title}</strong><small>{item.type}</small><em>{item.nextAction}</em></button>)}</section>)}</div>; }
function ResolutionGuide({ work, unmet, configuredChecks, evidence, nextOwner, nextOwnerLabel, currentTab, onTab }: { work: Work; unmet: string[]; configuredChecks: DecisionCheck[]; evidence: EvidenceItem[]; nextOwner: string; nextOwnerLabel: string; currentTab: RecordTab; onTab: (tab: RecordTab) => void }) {
  const openIssue = work.issues?.find((issue) => issue.status === "open");
  const requiredIssueProof = openIssue?.requiredProofKind ?? "Any reviewed proof";
  const issueProofLabel = requiredIssueProof === "Any reviewed proof" ? "proof" : requiredIssueProof.toLowerCase();
  const hasIssueProof = evidence.some((item) => item.added !== "Baseline" && item.state === "verified" && (requiredIssueProof === "Any reviewed proof" || item.kind === requiredIssueProof));
  const steps: { title: string; detail: string; tab: RecordTab; action: string }[] = [];
  if (openIssue && !hasIssueProof) steps.push({ title: `Add reviewed ${issueProofLabel} for the open issue`, detail: "Add the resolution source, then review its reference before using it to clear the issue.", tab: "Evidence", action: "Open evidence" });
  if (openIssue) steps.push({ title: "Resolve the controlled issue", detail: openIssue.title, tab: "Issues & changes", action: "Open issue" });
  for (const check of configuredChecks) { const surface = phaseSurfaceForCheck(check); steps.push({ title: check.message, detail: "Required by this Work Record's pinned phase decision contract.", tab: surface, action: `Open ${surface.toLowerCase()}` }); }
  if (!configuredChecks.length && unmet.some((item) => item.toLowerCase().includes("package"))) steps.push({ title: "Record package verification and acceptance", detail: "Review the installed and tested facts, then record each required package acceptance.", tab: "Deploy", action: "Open Deploy" });
  if (!configuredChecks.length && unmet.some((item) => /evidence|proof|reviewed|acceptance record/i.test(item)) && !steps.some((step) => step.tab === "Evidence")) steps.push({ title: "Complete the required proof", detail: unmet.find((item) => /evidence|proof|reviewed|acceptance record/i.test(item)) ?? "A reviewed proof reference is required.", tab: "Evidence", action: "Open evidence" });
  if (unmet.some((item) => item.toLowerCase().includes("commercial"))) steps.push({ title: "Confirm the commercial condition", detail: unmet.find((item) => item.toLowerCase().includes("commercial")) ?? "Commercial readiness is required.", tab: "Commercial", action: "Open commercial" });
  if (!steps.length) steps.push({ title: "Review the governing requirement", detail: unmet[0], tab: "Readiness", action: "Open readiness" });
  if (currentTab !== "Overview" && currentTab !== "Readiness") return <section className="d5o-resolution-strip" aria-label="Open decision conditions"><div><span>DECISION WAITING ON CONTROL</span><strong>{unmet.length} open requirement{unmet.length === 1 ? "" : "s"} before the next action: {work.nextAction}</strong></div>{steps[0].tab !== currentTab ? <button type="button" onClick={() => onTab(steps[0].tab)}>Next: {steps[0].action} →</button> : null}<details><summary>View full resolution path</summary><ol>{steps.map((step, index) => <li key={`${step.tab}-${index}`}><b>{index + 1}. {step.title}</b><button type="button" onClick={() => onTab(step.tab)}>{step.action} →</button></li>)}</ol></details></section>;
  return <section className="d5o-resolution-guide" aria-label="Steps to clear this decision">
    <div className="d5o-resolution-heading"><div><span>DECISION WAITING ON CONTROL</span><h2>Before you can {work.nextAction.toLowerCase()}, clear these conditions.</h2><p>The decision remains unavailable until the requirements below are satisfied. Open each owning surface to record the missing work.</p></div><div className="d5o-resolution-count"><strong>{unmet.length}</strong><small>open requirement{unmet.length === 1 ? "" : "s"}</small></div></div>
    <ol>{steps.map((step, index) => <li key={`${step.tab}-${index}`}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{step.title}</strong><p>{step.detail}</p></div><button type="button" onClick={() => onTab(step.tab)}>{step.action} →</button></li>)}</ol>
    <footer><span><b>{nextOwnerLabel}</b>{nextOwner}</span><span><b>Due</b>{actionDueLabel(work.nextActionDue)}</span><span><b>Impact</b>{actionImpactLabel(work.nextActionImpact)}</span><span><b>Value protected</b>{work.value}</span></footer>
  </section>;
}
function StartWork({ workspaceKey, workspaceName, workTypes, publishedVersionId, defaultOwner, onSubmit, onCancel }: { workspaceKey: WorkspaceKey; workspaceName: string; workTypes: string[]; publishedVersionId: string | null; defaultOwner: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) {
  const [selectedType, setSelectedType] = useState(workTypes[0] ?? "");
  const profile = lifecycleProfiles[workspaceKey];
  const profileAvailable = selectedType === profile.workType;
  return <section className="d5o-page d5o-start-page"><p className="d5o-page-kicker">START WORK</p><h1>Start one governed unit of work.</h1><p className="d5o-page-lead">Create a stable Work Record in {workspaceName}. Its exact published phase-contract version is pinned when work starts.</p><form onSubmit={onSubmit}><label>Work name<input name="title" placeholder="For example: Compressor reliability pilot" required /></label><label>Customer or account<input name="customer" placeholder="Customer name" /></label><label>Site, asset or operating location<input name="site" placeholder="For example: Platform Delta" /></label><label>Work type<select name="type" value={selectedType} onChange={(event) => setSelectedType(event.target.value)} disabled={!workTypes.length}>{workTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label>Accountable owner<input name="owner" defaultValue={defaultOwner} required /></label><label>Customer need<textarea name="need" rows={3} placeholder="What outcome is the customer asking for?" required /></label><label>Initial value commitment<input name="value" placeholder="For example: $420k annual service value" /></label><div className={`d5o-path-card ${publishedVersionId ? "is-configured" : "is-unconfigured"}`}><span>{publishedVersionId ? "PUBLISHED CONFIGURATION" : "CONFIGURATION UNAVAILABLE"}</span><strong>{selectedType || workspaceName}</strong><small>{publishedVersionId ? `Exact version: ${publishedVersionId}` : "A published phase contract is required before new work can be created."}</small>{profileAvailable ? <small>Prototype lifecycle reference: {profile.name} · v{profile.version}. Governing business authority remains on the server command contract.</small> : <small>The detailed lifecycle path for this Work Type is not yet implemented in the prototype.</small>}</div><div><button className="d5o-primary" type="submit" disabled={!publishedVersionId || !selectedType}>Create Work Record</button><button className="d5o-quiet" type="button" onClick={onCancel}>Cancel</button></div></form></section>;
}
function WorkRecord({ taskFocus, taskPackageId, taskRequestId, onFullRecord, profiles, actorId, actorRole, work, allWork, configurationInventory, onSelectDesignWork, tab, setTab, phaseConfig, phaseDemandCount, phaseAssignmentCount, onPhaseRowSave, onPhaseRowRemove, backLabel, onBack, onOpenDiscovery, onOpenDefinition, onOpenDevelop, onOpenPeople, onOpenCrew, onActionPriority, onEvidence, onReviewEvidence, onPackage, onPackageDemand, packageDemands, canEditDemand, onPackageFacts, onAdvancePackage, onIssue, onResolveIssue, onException, onCommercial, onLifecycle, onDesignCommand, onDeployCommand, onDeployUpload, onOperateCommand, operateFocus, onOpenOperateWork, schedule, onDesignHandoff, hosted }: {
  taskFocus: string | null; taskPackageId: string | null; taskRequestId: string | null; onFullRecord: () => void;
  profiles: PersonProfile[]; actorId: string; actorRole?: string; work: Work; allWork: Work[]; configurationInventory: ConfigurationInventory; onSelectDesignWork: (id: string) => void; tab: RecordTab; setTab: (tab: RecordTab) => void;
  phaseConfig: WorkTypeConfiguration | null; phaseDemandCount: number; phaseAssignmentCount: number;
  onPhaseRowSave: (key: string, row: Record<string, string>, index: number | null) => void;
  onPhaseRowRemove: (key: string, index: number) => void;
  backLabel: string; onBack: () => void; onOpenDiscovery: () => void; onOpenDefinition: () => void; onOpenDevelop: () => void; onOpenPeople: () => void; onOpenCrew: () => void;
  onActionPriority: (event: FormEvent<HTMLFormElement>) => void;
  onEvidence: (event: FormEvent<HTMLFormElement>) => void; onReviewEvidence: (event: FormEvent<HTMLFormElement>) => void;
  onPackage: (event: FormEvent<HTMLFormElement>) => void; onPackageDemand: (event: FormEvent<HTMLFormElement>) => void;
  packageDemands: PackageCrewDemand[]; canEditDemand: boolean;
  onPackageFacts: (event: FormEvent<HTMLFormElement>) => void; onAdvancePackage: (id: string) => void;
  onIssue: (event: FormEvent<HTMLFormElement>) => void; onResolveIssue: (event: FormEvent<HTMLFormElement>) => void;
  onException: (event: FormEvent<HTMLFormElement>) => void; onCommercial: (event: FormEvent<HTMLFormElement>) => void;
  onLifecycle: (event: FormEvent<HTMLFormElement>) => void;
  onDesignCommand: (command: Omit<DesignCommand, "workId" | "expectedRevision" | "commandId">) => Promise<boolean>;
  onDeployCommand: (command: Omit<DeployCommand, "workId" | "expectedRevision" | "commandId">) => Promise<boolean>;
  onOperateCommand: (command: Omit<OperateCommand, "workId" | "expectedRevision" | "commandId">) => Promise<boolean>; operateFocus: OperateTab; onOpenOperateWork: (id: string, section?: OperateTab) => void;
  onDeployUpload: (packageId: string, data: FormData) => Promise<boolean>;
  hosted: boolean;
  schedule: SharedSchedule | null;
  onDesignHandoff: (decision: "accept-design-handoff" | "return-design-handoff", note: string) => Promise<boolean>;
}) {
  const pendingTransition = currentPrototypeTransition(work);
  const hasPinnedDecision = Boolean(work.phaseConfigurationVersionId && phaseConfig?.decisionGuards?.length && pendingTransition);
  const nextOwner = hasPinnedDecision && pendingTransition ? roleLabel(work.workspace, pendingTransition.role) : work.stage === "Customer acceptance" ? "Owner representative · customer acceptance" : work.owner;
  const nextOwnerLabel = hasPinnedDecision ? "Decision profile" : "Decision owner";
  const openIssues = (work.issues ?? []).filter((item) => item.status === "open");
  const packages = work.packages ?? [];
  const evidence = work.evidence ?? [];
  const lifecycle = work.lifecycle ?? [];
  const unmet = transitionBlockers(work, phaseConfig);
  const currentCheckResults = phaseConfig && pendingTransition ? decisionCheckResults(work, phaseConfig, work.stage, pendingTransition.right) : [];
  const configuredChecks = currentCheckResults.filter((item) => !item.met).map((item) => item.check);
  const activeTab: RecordTab = tab === "Plan" ? currentCheckResults.some(({ check, met }) => !met && decisionCheckPhase(check) === "develop") ? "Develop" : "Design" : tab === "Execution" ? "Deploy" : tab === "Handoff" ? "Operate" : tab;
  const connectedPosition = connectedWorkPosition(work);
  const blockedTransition = !connectedPosition && unmet.length > 0;
  const [evidenceFocusId, setEvidenceFocusId] = useState("");
  const openPackageProof = (packageId: string) => { setEvidenceFocusId(packageId); setTab("Evidence"); };
  const openPhaseTarget = (target: "Plan" | "Readiness" | "Execution" | "Evidence" | "Commercial" | "Handoff" | "Lifecycle Value", source: PhaseKey) => {
    setTab(target === "Plan" ? source === "develop" ? "Develop" : "Design" : target === "Execution" ? "Deploy" : target === "Handoff" ? "Operate" : target);
  };
  const phasePanel = (key: PhaseKey, currentTab: "Plan" | "Execution" | "Handoff") => {
    const phase = phaseConfig?.phases.find((entry) => entry.key === key);
    return phase && phaseConfig ? <WorkPhaseActions config={phaseConfig} phase={phase} work={work} currentTab={currentTab} currentDecision={pendingTransition ? { label: pendingTransition.label, profile: roleLabel(work.workspace, pendingTransition.role), checks: currentCheckResults } : null} demandCount={phaseDemandCount} assignmentCount={phaseAssignmentCount} onTab={(target) => openPhaseTarget(target, key)} onSave={onPhaseRowSave} onRemove={onPhaseRowRemove} />
      : work.phaseConfigurationVersionId ? <p className="d5o-execution-blocker" role="status">Pinned phase configuration is unavailable. This phase form cannot be used until its exact published version is restored.</p> : null;
  };
  return <section className="d5o-record-full">{taskFocus ? <header className="d5o-focused-record-header"><div><small>CURRENT TASK · {activeTab}</small><h1>{taskFocus.replaceAll("-", " ")}</h1><p>{work.title} · {work.customer} · {work.site}</p>{taskPackageId ? <p>Package: {work.packages?.find((item) => item.id === taskPackageId)?.name ?? "Unavailable package"}</p> : null}{taskRequestId ? <p>Request: {work.operate?.requests?.find((item) => item.id === taskRequestId)?.title ?? "Unavailable request"}</p> : null}</div><div><a href={`/work?workspace=${encodeURIComponent(work.workspace)}&view=my-work`}>Back to tasks</a><button type="button" onClick={onFullRecord}>View full record</button></div></header> : <WorkPhaseJourney visiblePhases={presentationForRole(actorRole, hosted).phases.map((phase) => (phase[0].toUpperCase() + phase.slice(1)) as WorkPhase)} active={(["Develop", "Design", "Deploy", "Operate"] as RecordTab[]).includes(activeTab) ? activeTab as WorkPhase : undefined} record={work} backLabel={backLabel} onBack={onBack} onChoose={(phase) => { if (phase === "Discover") onOpenDiscovery(); else if (phase === "Define") onOpenDefinition(); else if (phase === "Develop" && work.discovery) onOpenDevelop(); else setTab(phase); }} onControl={(control) => { if (control === "Evidence") setEvidenceFocusId(""); setTab(control); }} activeControl={tabs.includes(activeTab) ? activeTab as WorkControl : undefined} />}
    <section className={!taskFocus && blockedTransition ? "d5o-record-workspace is-blocked" : "d5o-record-workspace is-ready"}>
      {!taskFocus && !connectedPosition && !blockedTransition && activeTab !== "Design" ? <aside className="d5o-decision-rail"><section className="d5o-next-card">
        <div className="d5o-ready-decision-heading"><p>CONFIGURED TRANSITION CHECKS MET</p><h2>{work.nextAction}</h2><span>This lifecycle transition has no open configured checks. Phase approvals, release, execution and acceptance remain separate decisions.</span><small>{nextOwnerLabel} · {nextOwner}</small></div>
        <div className="d5o-decision-composer"><small>PHASE DECISION</small><strong>Use the phase workspace to record this decision</strong><p>The configured checks are advisory here. Qualification, scope approval, offer, release, field completion, and support activation each have their own reviewed action and history.</p></div>
        <details className="d5o-ready-decision-context"><summary>View decision context</summary><div><span><b>Action due</b>{actionDueLabel(work.nextActionDue)}</span><span><b>Action impact</b>{actionImpactLabel(work.nextActionImpact)}</span><span><b>Proof context</b>{evidence.length} connected proof item{evidence.length === 1 ? "" : "s"}</span><span><b>Value protected</b>{work.value}</span></div></details>
      </section></aside> : null}
      <div className="d5o-record-primary">
        {!taskFocus && blockedTransition && activeTab !== "Design" ? <ResolutionGuide work={work} unmet={unmet} configuredChecks={configuredChecks} evidence={evidence} nextOwner={nextOwner} nextOwnerLabel={nextOwnerLabel} currentTab={activeTab} onTab={setTab} /> : null}
        {!taskFocus && (activeTab === "Overview" || activeTab === "Readiness") ? <section className="d5o-record-summary"><article><span>{connectedPosition ? "Current committed position" : "Configured transition"}</span><strong>{connectedPosition?.label ?? (unmet.length ? `${unmet.length} open condition${unmet.length === 1 ? "" : "s"}` : "Checks met; decision pending")}</strong></article><article><span>{connectedPosition ? "Legacy proof references" : "Proof references"}</span><strong>{work.proof.length} recorded</strong></article><article><span>Value context</span><strong>{connectedPosition?.value ?? work.value}</strong></article><article><span>Legacy progress observation</span><strong>{work.progress}% · not measured completion</strong></article></section> : null}
    <section className="d5o-record-body">
      {activeTab === "Develop" ? <div className="d5o-detail-stack">{phasePanel("develop", "Plan")}<Panel title="Definition baseline" lead="Develop the approach against the customer outcome and scope carried by this Work Record."><Facts work={work} />{work.definition ? <div className="d5o-definition-snapshot"><span><b>STATUS</b>{work.definition.status}</span><span><b>REVISION</b>{work.definition.revision}</span><span><b>CUSTOMER OUTCOME</b>{work.definition.outcome || "Not defined"}</span><span><b>ACCEPTANCE BASIS</b>{work.definition.acceptance || "Not defined"}</span></div> : null}<button className="d5o-outline" type="button" onClick={onOpenDefinition}>Open Define baseline →</button></Panel><PhaseResourceBridge phase="Develop" demandCount={phaseDemandCount} assignmentCount={phaseAssignmentCount} onPeople={onOpenPeople} onCrew={onOpenCrew} /></div> : null}
      {activeTab === "Develop" && hosted && work.canonicalWorkId && work.serviceSource ? work.packages?.filter((pkg) => currentAcceptedRelease(work, pkg.id)).map((pkg) => <FieldChangeControl key={pkg.id} mode="commercial" workspace={work.workspace} workId={work.id} packageId={pkg.id} releaseId={currentAcceptedRelease(work, pkg.id)?.id} reports={[]} evidence={[]} />) : null}
      {activeTab === "Develop" && work.discovery?.designHandoff?.status === "submitted" ? <Panel title="Design handoff awaiting a receiver" lead={`Revision ${work.discovery.designHandoff.revision} carries the awarded offer and approved Define basis to Design.`}><p>A different authorized workspace actor must accept or return the exact revision. Package planning stays held.</p><button className="d5o-primary" type="button" onClick={onOpenDevelop}>Open receiving decision in Develop →</button></Panel> : null}
      {activeTab === "Design" ? <DesignWorkspace key={work.id} taskFocus={taskFocus} onFullRecord={onFullRecord} work={work} allWork={allWork} configurationInventory={configurationInventory} onSelectWork={onSelectDesignWork} actorRole={actorRole} packages={packages} packageDemands={packageDemands} policy={phaseConfig?.designControls} onCommand={onDesignCommand} onHandoff={onDesignHandoff} onCreatePackage={onPackage} demand={<PackageDemandList work={work} profiles={profiles} demands={packageDemands} canEdit={canEditDemand} onSave={onPackageDemand} />} resources={<PhaseResourceBridge phase="Design" demandCount={phaseDemandCount} assignmentCount={phaseAssignmentCount} onPeople={onOpenPeople} onCrew={onOpenCrew} />} /> : null}
      {activeTab === "Overview" ? connectedPosition ? <div className="d5o-gate-overview"><section className="d5o-gate-progress"><div><p>CONNECTED WORK · CURRENT COMMITTED FACTS</p><h2>{connectedPosition.label}</h2><span>{connectedPosition.nextAction}</span></div></section><section className="d5o-gate-grid"><article className="d5o-gate-requirements"><header><p>CURRENT POSITION</p><h2>Separate phase decisions</h2></header><button type="button" onClick={() => setTab("Develop")}><div><strong>Commercial basis</strong><span>{work.discovery?.estimate.status === "Approved" ? `Estimate revision ${work.discovery.estimate.revision} approved` : "Approved estimate not recorded"}</span></div><b>Open Develop →</b></button><button type="button" onClick={() => setTab("Design")}><div><strong>Design and package releases</strong><span>{work.packages?.length ?? 0} current package identities</span></div><b>Open Design →</b></button><button type="button" onClick={() => setTab("Deploy")}><div><strong>Delivery and acceptance</strong><span>{work.deploy?.workAcceptance?.receipt === "Accepted" ? "Whole-work Operations receipt retained" : "Whole-work Operations receipt not recorded"}</span></div><b>Open Deploy →</b></button><button type="button" onClick={() => setTab("Operate")}><div><strong>Support responsibility</strong><span>{work.operate?.activation?.status ?? "Support not activated"}</span></div><b>Open Operate →</b></button></article><aside className="d5o-gate-proof"><header><p>EXACT SCOPE</p><h2>What needs action</h2></header><p>{connectedPosition.warning ?? connectedPosition.nextAction}</p><p>Historical prototype stage and percentages do not grant a phase approval.</p></aside></section></div> : phaseConfig?.decisionGuards?.length && work.phaseConfigurationVersionId ? <ConfiguredDecisionOverview work={work} config={phaseConfig} blockers={unmet} onTab={setTab} /> : <Overview work={work} blockers={unmet} onTab={setTab} /> : null}
      {activeTab === "Lifecycle" ? <Lifecycle work={work} phaseConfig={phaseConfig} onTab={setTab} /> : null}
      {activeTab === "Readiness" ? <div className="d5o-detail-stack">{connectedPosition ? <Panel title="Current connected position" lead={connectedPosition.label}><p>{connectedPosition.warning ?? connectedPosition.nextAction}</p><p>Open the owning phase or My Work for its exact decision.</p></Panel> : !blockedTransition ? <Panel title="Requirements satisfied" lead="The current gate requirements are satisfied. Review the decision and its authority before moving work forward."><Checklist items={["Current requirements are satisfied for the next prototype action."]} good /></Panel> : null}<Panel title="Action commitment" lead="Set when the next action is due and its impact. This orders the Work hub; it does not clear a requirement."><form className="d5o-inline-form d5o-action-priority-form" key={`${work.id}-${work.nextAction}`} onSubmit={onActionPriority}><label>Due date<input name="nextActionDue" type="date" defaultValue={work.nextActionDue ?? ""} /></label><label>Impact<select name="nextActionImpact" defaultValue={work.nextActionImpact ?? ""}><option value="">Not set</option><option value="Critical">Critical</option><option value="High">High</option><option value="Standard">Standard</option></select></label><button className="d5o-primary" type="submit">Save action priority</button></form></Panel></div> : null}
      {activeTab === "Deploy" ? <DeployWorkspace work={work} schedule={schedule} policy={phaseConfig?.deployControls} actorId={actorId ?? "unknown-user"} onCommand={onDeployCommand} onUpload={onDeployUpload} onDesignCommand={onDesignCommand} onCrew={onOpenCrew} hosted={hosted} /> : null}
      {activeTab === "Issues & changes" ? <div className="d5o-detail-stack"><Panel title={openIssues.length ? "Resolve current condition" : "Issues and changes"} lead={openIssues.length ? "Review the required proof, record the resolution, and return to the governing decision. A permitted exception uses a separate authority path." : "No open issue is preventing this step. Resolved conditions remain in Work Record history."}><IssueList issues={work.issues ?? []} evidence={evidence} currentOwner={work.owner} onResolve={onResolveIssue} onException={onException} onOpenEvidence={() => setTab("Evidence")} /></Panel><details className="d5o-task-disclosure"><summary>Capture another controlled condition</summary><p>Create a new issue only when another condition needs its own owner and resolution proof.</p><form className="d5o-inline-form" onSubmit={onIssue}><label>Condition or change<input name="issue" placeholder="Describe the condition that needs control" required /></label><label>Accountable owner<input name="owner" placeholder={work.owner} /></label><label>Resolution proof<select name="proofKind"><option>Test result</option><option>Proof package</option><option>Acceptance record</option><option>Work fact</option></select></label><button className="d5o-primary">Isolate issue</button></form></details></div> : null}
      {activeTab === "Evidence" ? <EvidenceWorkspace work={work} evidence={evidence} focusedPackageId={evidenceFocusId} onEvidence={onEvidence} onReview={onReviewEvidence} /> : null}
      {activeTab === "Commercial" ? <div className="d5o-detail-stack"><Panel title="Commercial context" lead="Commercial conditions and value commitments remain visible where decisions are made."><div className="d5o-commercial-guard"><span>DECISION CONSEQUENCE</span><strong>{work.nextAction}</strong><p>The commercial position is reviewed alongside readiness and authority, so the Work Record carries the reason value is being protected.</p></div>{work.discovery ? <><div className="d5o-commercial-summary"><strong>{work.discovery.estimate.sellPrice ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(work.discovery.estimate.sellPrice) : "Unpriced"}</strong><span>Estimate revision {work.discovery.estimate.revision} · {work.discovery.estimate.status}</span><em>Proposal revision {work.discovery.proposal.package?.revision ?? "not prepared"} · {work.discovery.proposal.status}</em></div><p>Develop owns the estimate, offer and pricing review. The Work Record shows that source here without creating another editable price.</p><button type="button" className="d5o-outline" onClick={onOpenDevelop}>Open commercial work in Develop →</button></> : <><form className="d5o-inline-form d5o-commercial-form" onSubmit={onCommercial}><label>Value commitment<input name="amount" defaultValue={work.commercial?.amount ?? work.value} required /></label><label>Commercial condition<input name="condition" defaultValue={work.commercial?.condition ?? ""} required /></label><label>Confidence<select name="confidence" defaultValue={work.commercial?.confidence ?? "Under review"}><option>Under review</option><option>Conditionally confirmed</option><option>Committed</option></select></label><button className="d5o-primary">Save commercial context</button></form><div className="d5o-commercial-summary"><strong>{work.commercial?.amount ?? work.value}</strong><span>{work.commercial?.condition}</span><em>{work.commercial?.confidence}</em></div></>}</Panel></div> : null}
      {activeTab === "Operate" ? <OperateWorkspace key={work.id} taskFocus={taskFocus} work={work} allWork={allWork} policy={phaseConfig?.operateControls} hosted={hosted} actorRole={actorRole} initialTab={operateFocus} onCommand={onOperateCommand} onDeployCommand={onDeployCommand} onOpenWork={onOpenOperateWork} /> : null}
      {activeTab === "Lifecycle Value" ? <Panel title="Lifecycle value" lead="The work is connected to the value it creates and protects."><div className="d5o-value-card"><span>VALUE COMMITMENT</span><strong>{work.value}</strong><p>{work.commercial?.condition ?? "Value remains visible through decisions, handoff and future lifecycle action."}</p></div><LifecycleList actions={lifecycle} /></Panel> : null}
      {activeTab === "History" ? <Panel title="History" lead="The Work Record keeps its decisions, proof context and resulting outcomes."><ol className="d5o-history">{work.history.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ol></Panel> : null}
    </section></div></section>
  </section>;
}
function ConfiguredDecisionOverview({ work, config, blockers, onTab }: { work: Work; config: WorkTypeConfiguration; blockers: string[]; onTab: (tab: RecordTab) => void }) {
  const transition = currentPrototypeTransition(work);
  const results = transition ? decisionCheckResults(work, config, work.stage, transition.right) : [];
  const checkedMessages = new Set(results.map(({ check }) => check.message));
  const otherConditions = blockers.filter((message) => !checkedMessages.has(message));
  const met = results.filter((item) => item.met).length;
  const firstOpenCheck = results.find((item) => !item.met)?.check;
  const nextSurface = firstOpenCheck ? phaseSurfaceForCheck(firstOpenCheck) : blockers.length ? conditionTargetTab(work, blockers) : "Readiness";
  const proof = work.evidence ?? [];
  return <div className="d5o-gate-overview"><section className="d5o-gate-progress"><div><p>PINNED DECISION · {config.workTypeLabel}</p><h2>{work.stage}</h2><span>{transition ? `${transition.label} · ${transition.right}` : work.status === "complete" ? "Completed work" : "No current transition available"}</span></div><strong>{met} / {results.length}<small>configured checks satisfied</small></strong></section><section className="d5o-gate-grid"><article className="d5o-gate-requirements"><header><p>CURRENT DECISION</p><h2>{transition ? "What this action requires" : "Decision position"}</h2></header>{results.map(({ check, met: satisfied }, index) => <button key={`${check.op}-${check.key ?? check.field ?? check.evidenceKind ?? index}`} type="button" onClick={() => onTab(phaseSurfaceForCheck(check))}><i className={satisfied ? "is-met" : ""}>{satisfied ? "✓" : "!"}</i><div><strong>{check.message}</strong><span>{satisfied ? "Requirement satisfied for this Work Record." : `Complete this on ${phaseSurfaceForCheck(check)}.`}</span></div><b>{satisfied ? "View" : "Open"} {phaseSurfaceForCheck(check)} →</b></button>)}{transition && !results.length ? <p className="d5o-configured-empty">No additional phase input is configured for this decision. Other current conditions, if any, still apply.</p> : null}{!transition ? <p className="d5o-configured-empty">{work.status === "complete" ? "This Work Record has reached its configured outcome. Review the retained decision history." : "This position has no available configured transition; reconcile the pinned lifecycle before another decision."}</p> : null}{otherConditions.map((message, index) => <button key={`condition-${index}`} type="button" onClick={() => onTab(conditionTargetTab(work, [message]))}><i>!</i><div><strong>{message}</strong><span>Another current condition must be resolved before the decision.</span></div><b>Open condition →</b></button>)}</article><aside className="d5o-gate-proof"><header><p>DECISION CONTEXT</p><h2>Proof, version and next action</h2></header><div className="d5o-gate-proof-count"><strong>{proof.length}</strong><span>proof references</span><small>{proof.filter((item) => item.state === "draft").length} awaiting review</small></div><div className={`d5o-gate-issue${blockers.length ? "" : " is-neutral"}`}><strong>{blockers.length ? "ACTION REQUIRED" : "CURRENT POSITION"}</strong><span>{blockers[0] ?? (work.status === "complete" ? "No further decision is due for this Work Record." : "Current requirements are met. Record the decision basis when the responsible actor is ready.")}</span><button type="button" onClick={() => onTab(blockers.length ? nextSurface : work.status === "complete" ? "History" : "Readiness")}>{blockers.length ? `Open ${nextSurface} →` : work.status === "complete" ? "View decision history →" : "Review decision →"}</button></div><div className="d5o-gate-issue is-neutral"><strong>EFFECTIVE CONFIGURATION</strong><span>{config.workTypeLabel} · {config.version}</span><span>Existing work remains on its pinned version when a new default is published.</span></div></aside></section><section className="d5o-gate-bottom"><article><b>ACCOUNTABLE OWNER</b><strong>{work.owner}</strong><span>{work.customer} · {work.site}</span></article><article><b>VALUE PROTECTED</b><strong>{work.value}</strong><span>{work.commercial?.condition}</span></article><article><b>NEXT ACTION</b><strong>{work.nextAction}</strong><span>Canonical decisions are recorded through authenticated commands; historical prototype records retain their provenance.</span></article></section></div>;
}
function Overview({ work, blockers, onTab }: { work: Work; blockers: string[]; onTab: (tab: RecordTab) => void }) {
  const evidence = work.evidence ?? [];
  const packages = work.packages ?? [];
  const exceptedPackages = packages.filter((entry) => work.issues?.some((issue) => issue.status === "resolved" && issue.affectedPackageId === entry.id && issue.exceptionAuthority && issue.authorityBasis && evidence.some((proof) => proof.id === issue.proofId && proof.kind === "Exception authorization" && proof.state === "verified")));
  const average = (key: "installed" | "tested" | "accepted") => packages.length ? Math.round(packages.reduce((sum, item) => sum + item[key], 0) / packages.length) : 0;
  const requirements: { name: string; detail: string; met: boolean; tab: RecordTab }[] = work.workspace === "rybex" ? [
    { name: "Installation facts recorded", detail: `${average("installed")}% installed across controlled packages`, met: average("installed") === 100, tab: "Execution" },
    { name: "Certification and test proof", detail: `${average("tested")}% tested; ${exceptedPackages.length} package exception${exceptedPackages.length === 1 ? "" : "s"} retained`, met: packages.every((entry) => entry.tested === 100 || exceptedPackages.some((excepted) => excepted.id === entry.id)) && evidence.some((item) => item.name.toLowerCase().includes("certification") && item.state !== "draft"), tab: "Evidence" },
    { name: "Failed result controlled", detail: work.blockers[0] || "No failed result remains open", met: !work.blockers.length, tab: "Issues & changes" },
    { name: "Internal quality verification", detail: work.stage === "Quality verification" ? "Quality decision remains in progress" : "Quality outcome recorded in Work Record history", met: work.stage !== "Quality verification" && work.progress >= 88, tab: "Readiness" },
    { name: "Owner or customer acceptance", detail: "Requires a distinct acceptance decision after internal verification", met: work.status === "complete", tab: "Handoff" }
  ] : [
    { name: "Assessment and pilot facts", detail: "Assessment and paid-pilot work remain connected", met: evidence.some((item) => item.name.toLowerCase().includes("assessment")), tab: "Plan" },
    { name: "Pilot outcome proof", detail: `${evidence.length} proof references attached to the Work Record`, met: evidence.some((item) => item.name.toLowerCase().includes("pilot") && item.state !== "draft"), tab: "Evidence" },
    { name: "Pilot review", detail: work.stage === "Pilot review" ? "Pilot reviewer must record an outcome" : "Pilot review outcome recorded", met: work.stage !== "Pilot review" && work.progress >= 68, tab: "Readiness" },
    { name: "Commercial conditions", detail: work.commercial?.condition || "Commercial position must be established", met: work.stage !== "Commercial readiness" && work.progress >= 78, tab: "Commercial" },
    { name: "Rollout authorization", detail: "Distinct rollout authority decides the governed outcome", met: work.status === "complete", tab: "Handoff" }
  ];
  const met = requirements.filter((item) => item.met).length;
  const currentRequirement = work.workspace === "rybex"
    ? work.stage === "Quality verification" ? "Internal quality verification" : work.stage === "Customer acceptance" ? "Owner or customer acceptance" : ""
    : work.stage === "Pilot review" ? "Pilot review" : work.stage === "Commercial readiness" ? "Commercial conditions" : work.stage.includes("Rollout") ? "Rollout authorization" : "";
  return <div className="d5o-gate-overview"><section className="d5o-gate-progress"><div><p>CURRENT GOVERNED GATE</p><h2>{work.stage}</h2><span>{work.nextAction}</span></div><strong>{met} / {requirements.length}<small>lifecycle checkpoints complete</small></strong></section><section className="d5o-gate-grid"><article className="d5o-gate-requirements"><header><p>JOURNEY CONTROL</p><h2>Completed, current and later decisions</h2></header>{requirements.map((item) => <button key={item.name} onClick={() => onTab(item.tab)}><i className={item.met ? "is-met" : item.name === currentRequirement ? "" : "is-later"}>{item.met ? "✓" : "!"}</i><div><strong>{item.name}</strong><span>{item.detail}</span></div><b>{item.met ? "Complete" : item.name === currentRequirement ? "Now" : "Later"} →</b></button>)}</article><aside className="d5o-gate-proof"><header><p>PROOF & CONTROL</p><h2>Evidence in decision context</h2></header><div className="d5o-gate-proof-count"><strong>{evidence.length}</strong><span>proof references</span><small>{evidence.filter((item) => item.state === "draft").length} awaiting review</small></div>{evidence.slice(0,4).map((item) => <button key={item.id} onClick={() => onTab("Evidence")}><b>{item.state === "draft" ? "!" : "✓"}</b><span><strong>{item.name}</strong><small>{item.kind} · {item.state}</small></span></button>)}<div className="d5o-gate-issue"><strong>{blockers.length ? "GATE CONDITION" : "CURRENT CONDITION"}</strong><span>{blockers[0] || "No open blocker is preventing the next configured decision."}</span><button onClick={() => onTab(work.issues?.some((issue) => issue.status === "open") ? "Issues & changes" : blockers[0]?.includes("package") ? "Execution" : blockers[0]?.includes("evidence") ? "Evidence" : "Readiness")}>{blockers.length ? "Review condition →" : "View control history →"}</button></div></aside></section><section className="d5o-gate-bottom"><article><b>ACCOUNTABLE OWNER</b><strong>{work.owner}</strong><span>{work.customer} · {work.site}</span></article><article><b>VALUE PROTECTED</b><strong>{work.value}</strong><span>{work.commercial?.condition}</span></article><article><b>CURRENT DECISION</b><strong>{work.nextAction}</strong><span>The resulting decision remains with this Work Record.</span></article></section></div>;
}
function Lifecycle({ work, phaseConfig, onTab }: { work: Work; phaseConfig: WorkTypeConfiguration | null; onTab: (tab: RecordTab) => void }) {
  const profile = lifecycleProfiles[work.workspace];
  const aliases: Record<string, string> = work.workspace === "rotork" ? { "Rollout authorized": "Rollout tranche", "Lifecycle service": "Closed" } : {};
  const activeState = profile.states.includes(work.stage) ? work.stage : aliases[work.stage] ?? work.stage;
  const matchedIndex = profile.states.indexOf(activeState);
  const position = matchedIndex >= 0 ? matchedIndex : Math.min(profile.states.length - 1, Math.max(0, Math.round(work.progress / 20) - 1));
  const currentStage = profile.states[position];
  const nextTransitions = transitionsAt(work.workspace, currentStage);
  const pending = currentPrototypeTransition(work);
  const destinationTab = (right: string): RecordTab => ({
    "confirm-plan": "Develop", "authorize-readiness": "Readiness", "record-execution": "Deploy", "authorize-exception": "Issues & changes", "verify-quality": "Evidence", "accept-turnover": "Operate", "close-work": "Operate",
    "complete-assessment": "Develop", "authorize-pilot": "Commercial", "record-pilot-complete": "Deploy", "review-pilot": "Evidence", "confirm-commercial": "Commercial", "authorize-rollout": "Operate", "close-service": "Lifecycle Value"
  } as Record<string, RecordTab>)[right] ?? "Readiness";
  return <Panel title="Configured lifecycle" lead="This Work Record keeps one identity as its configured lifecycle, decision rights and proof requirements change.">
    <div className="d5o-lifecycle-profile-note"><strong>{profile.name} · v{profile.version}</strong><span>{profile.workType} configuration · Synthetic prototype profile</span></div>
    <div className="d5o-lifecycle-map">{profile.states.map((stage, index) => <article key={stage} className={index < position ? "complete" : index === position ? "current" : ""}><b>{index < position ? "✓" : `0${index + 1}`}</b><div><strong>{stage}</strong><span>{index === position ? `Current governed position · ${work.stage}` : index < position ? "Prior position in this Work Record" : "Next configured position"}</span></div></article>)}</div>
    <section className="d5o-lifecycle-next-actions"><header><small>NEXT GOVERNED ACTION{nextTransitions.length === 1 ? "" : "S"}</small><strong>{nextTransitions.length ? "Available decision path" : "No transition configured from this position"}</strong></header>{nextTransitions.map((transition) => {
      const recorded = (work.prototypeDecisionRights ?? []).includes(transition.right);
      const isCurrent = pending?.right === transition.right;
      const pinnedChecks = isCurrent && phaseConfig?.decisionGuards?.length ? decisionCheckResults(work, phaseConfig, work.stage, transition.right) : null;
      const firstOpenCheck = pinnedChecks?.find((item) => !item.met);
      const linkedSurface = firstOpenCheck ? phaseSurfaceForCheck(firstOpenCheck.check) : destinationTab(transition.right);
      return <article key={transition.right}><div><b>{transition.label}</b><span>{roleLabel(work.workspace, transition.role)} · {recorded ? "Decision recorded on this Work Record" : transition.to ? `moves work to ${transition.to}` : "records an outcome without changing lifecycle position"}</span></div>{recorded ? <p className="d5o-transition-no-prerequisites">This right has already been recorded. View the Work Record history for its prototype decision basis.</p> : pinnedChecks ? pinnedChecks.length ? <ul aria-label="Pinned decision checks">{pinnedChecks.map(({ check, met }, index) => <li key={`${transition.right}-${index}`}>{met ? "✓ Met: " : "Open: "}{check.message} · {phaseSurfaceForCheck(check)}</li>)}</ul> : <p className="d5o-transition-no-prerequisites">No additional phase input is configured for this right. Other current conditions still apply.</p> : transition.requirements.length ? <ul aria-label="Lifecycle reference prerequisites">{transition.requirements.map((requirement, index) => <li key={`${transition.right}-${index}`}>{requirementLabel(requirement)}</li>)}</ul> : <p className="d5o-transition-no-prerequisites">No additional configured prerequisite.</p>}<button type="button" onClick={() => onTab(recorded ? "History" : linkedSurface)}>{recorded ? "Open decision history →" : `Open ${linkedSurface} →`}</button></article>;
    })}<p>Canonical record decisions use authenticated commands; historical prototype records retain their provenance. Current pinned checks are shown for the next right; future positions are lifecycle reference context, not a readiness verdict.</p></section>
  </Panel>;
}
function Facts({ work }: { work: Work }) { return <dl className="d5o-facts"><div><dt>Customer</dt><dd>{work.customer}</dd></div><div><dt>Site</dt><dd>{work.site}</dd></div><div><dt>Accountable owner</dt><dd>{work.owner}</dd></div><div><dt>Work type</dt><dd>{work.type}</dd></div></dl>; }
function Panel({ title, lead, children }: { title: string; lead: string; children: ReactNode }) { return <article className="d5o-detail-panel"><p>{title.toUpperCase()}</p><h2>{title}</h2><span>{lead}</span><div>{children}</div></article>; }
function Checklist({ items, good }: { items: string[]; good: boolean }) { return <ul className={`d5o-checklist ${good ? "is-good" : ""}`}>{items.map((item) => <li key={item}><i>{good ? "✓" : "!"}</i>{item}</li>)}</ul>; }
function ExecutionSummary({ packages }: { packages: WorkPackage[] }) { const average = (key: "installed" | "tested" | "accepted") => packages.length ? Math.round(packages.reduce((sum, item) => sum + item[key], 0) / packages.length) : 0; return <div className="d5o-execution-summary"><article><span>INSTALLED</span><strong>{average("installed")}%</strong><small>Work facts recorded</small></article><article><span>TESTED</span><strong>{average("tested")}%</strong><small>Verification evidence available</small></article><article><span>ACCEPTED</span><strong>{average("accepted")}%</strong><small>Governed acceptance recorded</small></article></div>; }
function ProofSummary({ evidence }: { evidence: EvidenceItem[] }) { const accepted = evidence.filter((item) => item.state === "accepted").length; const verified = evidence.filter((item) => item.state === "verified").length; return <div className="d5o-proof-summary"><article><strong>{evidence.length}</strong><span>Connected proof</span></article><article><strong>{verified}</strong><span>Verified</span></article><article><strong>{accepted}</strong><span>Accepted</span></article><article><strong>{Math.max(0, evidence.length - accepted - verified)}</strong><span>Requires attention</span></article></div>; }
function EvidenceWorkspace({ work, evidence, focusedPackageId, onEvidence, onReview }: { work: Work; evidence: EvidenceItem[]; focusedPackageId: string; onEvidence: (event: FormEvent<HTMLFormElement>) => void; onReview: (event: FormEvent<HTMLFormElement>) => void }) {
  const openIssue = work.issues?.find((issue) => issue.status === "open");
  const focusedPackage = work.packages?.find((item) => item.id === focusedPackageId);
  const packageNeedsProof = Boolean(!openIssue && focusedPackage && !evidence.some((item) => item.packageId === focusedPackageId && item.state !== "draft"));
  const gateKind = transitionPolicies[work.workspace][work.stage]?.reviewedEvidenceKind;
  const requiredKind = openIssue?.requiredProofKind ?? gateKind;
  const proofLabel = packageNeedsProof ? "package proof" : requiredKind === "Any reviewed proof" ? "proof" : requiredKind?.toLowerCase();
  const usable = openIssue
    ? evidence.some((item) => item.added !== "Baseline" && item.state === "verified" && (!openIssue.affectedPackageId || item.packageId === openIssue.affectedPackageId) && (requiredKind === "Any reviewed proof" || item.kind === requiredKind))
    : evidence.some((item) => item.state !== "draft" && item.kind === requiredKind && (requiredKind !== "Acceptance record" || !item.packageId));
  const needsProof = packageNeedsProof || Boolean(requiredKind && !usable);
  const relevantDrafts = evidence.filter((item) => item.state === "draft" && (packageNeedsProof ? item.packageId === focusedPackageId : (!openIssue?.affectedPackageId || item.packageId === openIssue.affectedPackageId) && (requiredKind === "Any reviewed proof" || item.kind === requiredKind) && (Boolean(openIssue) || requiredKind !== "Acceptance record" || !item.packageId)));
  const otherDrafts = evidence.filter((item) => item.state === "draft" && !relevantDrafts.includes(item));
  const reviewed = evidence.filter((item) => item.state !== "draft");
  const selectedPackageId = openIssue?.affectedPackageId ?? focusedPackageId;
  const addForm = <form className="d5o-inline-form d5o-proof-add-form" key={`${requiredKind ?? "general"}-${selectedPackageId || "record"}`} onSubmit={onEvidence}><label>Evidence name<input name="evidence" placeholder={requiredKind === "Test result" ? "For example: FT-24 retest result" : "Name the source being reviewed"} required /></label><label>Evidence source or identifier<input name="source" placeholder="Document URL, custody ID or test-result ID" required /></label><label>Evidence purpose<select name="kind" defaultValue={packageNeedsProof ? "Proof package" : requiredKind && requiredKind !== "Any reviewed proof" ? requiredKind : "Work fact"}><option>Work fact</option><option>Test result</option><option>Proof package</option><option>Exception authorization</option><option>Acceptance record</option></select></label>{work.packages?.length ? <label>Applies to package<select name="packageId" defaultValue={selectedPackageId}><option value="">Whole Work Record</option>{work.packages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}<button className="d5o-primary">Add draft reference</button></form>;
  return <div className="d5o-detail-stack d5o-evidence-workspace">
    {needsProof ? <section className="d5o-record-task-card"><header><small>REQUIRED PROOF · {packageNeedsProof ? focusedPackage?.name.toUpperCase() : requiredKind?.toUpperCase()}</small><h2>{relevantDrafts.length ? "Review the draft source" : `Add the required ${proofLabel} source`}</h2><p>{packageNeedsProof ? `Link the reviewed source to ${focusedPackage?.name} before this package can be verified or accepted.` : openIssue ? `This source must support resolution of ${openIssue.title}` : `The ${work.stage.toLowerCase()} gate requires this reviewed source before the decision.`}</p></header>{relevantDrafts.length ? <><EvidenceList evidence={relevantDrafts} packages={work.packages} onReview={onReview} /><details className="d5o-task-disclosure"><summary>Add another source</summary>{addForm}</details></> : addForm}<p className="d5o-task-safety-note">A reference begins as a draft. Review requires inspecting its identified source; local review does not perform a file-security scan.</p></section> : <Panel title={requiredKind ? "Required proof present" : "Connected proof"} lead={requiredKind ? "The required reference is present for this step. Reviewed sources remain available below for inspection." : "Existing references remain available below. Add another source only when this work needs it."}><ProofSummary evidence={evidence} /></Panel>}
    {!needsProof && evidence.some((item) => item.state === "draft") ? <Panel title="Draft references awaiting review" lead="These references are not yet usable for a governed decision."><EvidenceList evidence={evidence.filter((item) => item.state === "draft")} packages={work.packages} onReview={onReview} /></Panel> : null}
    {needsProof && otherDrafts.length ? <details className="d5o-task-disclosure"><summary>Review other draft references ({otherDrafts.length})</summary><EvidenceList evidence={otherDrafts} packages={work.packages} onReview={onReview} /></details> : null}
    <details className="d5o-task-disclosure"><summary>View reviewed and accepted references ({reviewed.length})</summary><EvidenceList evidence={reviewed} packages={work.packages} onReview={onReview} /></details>
    {!needsProof ? <details className="d5o-task-disclosure"><summary>Add another evidence reference</summary>{addForm}<p className="d5o-task-safety-note">New references remain drafts until an explicit review.</p></details> : null}
  </div>;
}
function PackageDemandList({ work, profiles, demands, canEdit, onSave }: { work: Work; profiles: PersonProfile[]; demands: PackageCrewDemand[]; canEdit: boolean; onSave: (event: FormEvent<HTMLFormElement>) => void }) {
  const qualifications = [...new Set(profiles.filter((person) => person.active).flatMap((person) => person.qualifications))];
  return <div className="d5o-package-demand-list">{(work.packages ?? []).map((item) => {
    const demand = demands.find((entry) => entry.packageId === item.id);
    return <PackageDemandCard key={`${item.id}:${JSON.stringify(demand?.requiredSlots)}`} item={item} demand={demand} qualifications={qualifications} canEdit={canEdit} onSave={onSave} />;
  })}</div>;
}
function PackageDemandCard({ item, demand, qualifications, canEdit, onSave }: { item: WorkPackage; demand?: PackageCrewDemand; qualifications: string[]; canEdit: boolean; onSave: (event: FormEvent<HTMLFormElement>) => void }) {
  const [slots, setSlots] = useState<CrewDemandSlot[]>(() => demand?.requiredSlots.length ? demand.requiredSlots.map((slot) => ({ ...slot })) : [{ date: "", shift: "07:00–15:30" }]);
  const shiftOptions = ["07:00–15:30", "08:00–16:00", "09:00–16:00"];
  const decisionOnly = scheduleRequirement(item.id)?.crewSchedulable === false;
  if (decisionOnly || item.status === "accepted") return <article className="d5o-package-demand-card"><div><strong>{item.name}</strong><span>{decisionOnly ? "Decision package · no crew demand" : "Accepted package · schedule retained as history"}</span></div></article>;
  return <article className="d5o-package-demand-card">
    <div className="d5o-package-demand-heading"><div><small>{demand ? "CREW REQUIREMENT" : "CREW REQUIREMENT NEEDED"}</small><strong>{item.name}</strong><span>{demand ? `${demand.requiredSlots.length} required date/shift ${demand.requiredSlots.length === 1 ? "slot" : "slots"}` : "Set a required date and shift before scheduling."}</span></div><b>{demand ? "Schedulable" : "Not configured"}</b></div>
    <form onSubmit={onSave}><input type="hidden" name="packageId" value={item.id} />
      <div className="d5o-package-demand-slots"><div><b>WHEN A CREW IS NEEDED</b><span>Each row is one date and shift that needs a crew booking.</span></div>{slots.map((slot, index) => <div className="d5o-package-demand-slot" key={index}><label>Required date {index + 1}<input type="date" name="requiredDate" value={slot.date} onChange={(event) => setSlots((current) => current.map((entry, i) => i === index ? { ...entry, date: event.target.value } : entry))} required /></label><label>Required shift {index + 1}<select name="requiredShift" value={slot.shift} onChange={(event) => setSlots((current) => current.map((entry, i) => i === index ? { ...entry, shift: event.target.value } : entry))}>{shiftOptions.map((shift) => <option key={shift}>{shift}</option>)}</select></label><button type="button" disabled={slots.length === 1} onClick={() => setSlots((current) => current.filter((_, i) => i !== index))}>Remove</button></div>)}<button type="button" className="d5o-package-demand-add" onClick={() => setSlots((current) => [...current, { date: "", shift: "07:00–15:30" }])}>+ Add date and shift</button></div>
      <div className="d5o-package-demand-fields"><label>Qualified skill<select name="qualification" defaultValue={demand?.qualification ?? qualifications[0]}>{qualifications.map((skill) => <option key={skill}>{skill}</option>)}</select></label><label>People per slot<input type="number" name="minimumPeople" min="1" max="20" defaultValue={demand?.minimumPeople ?? 2} required /></label><label>Package effort estimate · person-hours<input type="number" name="estimatedPersonHours" min="0" max="10000" step="0.5" defaultValue={demand?.estimatedPersonHours ?? 16} required /></label><label>Priority<select name="priority" defaultValue={demand?.priority ?? "Normal"}><option>Critical</option><option>High</option><option>Normal</option></select></label></div>
      <label className="d5o-package-demand-prerequisite">Release or planning condition<input name="prerequisite" defaultValue={demand?.prerequisite ?? "Work Record release"} placeholder="Decision or readiness condition" /></label>
      <footer><span>Changes update package demand. Existing worker bookings remain visible; correct any booking that no longer matches the requirement.</span><button type="submit" disabled={!canEdit}>{demand ? "Save crew requirement" : "Make schedulable"}</button></footer>
    </form>
  </article>;
}
function PackageList({ packages, onAdvance, onFacts, onOpenEvidence, work, focus = false }: { packages: WorkPackage[]; onAdvance: (id: string) => void; onFacts: (event: FormEvent<HTMLFormElement>) => void; onOpenEvidence: (id: string) => void; work?: Work; focus?: boolean }) {
  const active = packages.filter((item) => item.status !== "accepted");
  const accepted = packages.filter((item) => item.status === "accepted");
  const card = (item: WorkPackage) => {
    const exception = work?.issues?.some((issue) => issue.status === "resolved" && issue.affectedPackageId === item.id && issue.exceptionAuthority && issue.authorityBasis && work.evidence?.some((proof) => proof.id === issue.proofId && proof.packageId === item.id && proof.kind === "Exception authorization" && proof.state === "verified"));
    const incompleteFacts = item.installed < 100 || (item.tested < 100 && !exception);
    const missingPackageProof = item.status !== "planned" && item.status !== "accepted" && !work?.evidence?.some((proof) => proof.packageId === item.id && proof.state !== "draft");
    const nextBlock = item.status === "ready" && work?.blockers.length ? work.blockers[0] : item.status !== "planned" && item.status !== "accepted" && incompleteFacts ? "Record complete installed and tested facts, or a permitted package exception." : missingPackageProof ? "Review proof linked to this package before requesting verification or acceptance." : null;
    const facts = <form className="d5o-package-facts" key={`${item.id}-${item.installed}-${item.tested}`} onSubmit={onFacts}><input type="hidden" name="packageId" value={item.id} /><label>Installed %<input name="installed" type="number" min="0" max="100" defaultValue={item.installed} required /></label><label>Tested %<input name="tested" type="number" min="0" max="100" defaultValue={item.tested} required /></label><button type="submit">Save actual quantities</button></form>;
    return <article key={item.id} className={nextBlock ? "is-blocked" : ""}><div><small>{label(item.status)}</small><strong>{item.name}</strong><span>{item.owner}</span>{item.acceptanceBasis ? <small>Acceptance basis: {item.acceptanceBasis}</small> : null}</div><div className="d5o-package-quantities"><span><b>{item.installed}%</b> installed</span><span><b>{item.tested}%</b> tested</span><span><b>{item.accepted}%</b> accepted</span></div><button disabled={item.status === "accepted" || Boolean(nextBlock)} onClick={() => onAdvance(item.id)}>{item.status === "planned" ? "Start package" : item.status === "in progress" ? "Request verification" : item.status === "ready" ? "Record acceptance" : "Accepted"}</button>{nextBlock ? <p className="d5o-package-next-block">{nextBlock}</p> : null}{missingPackageProof ? <button className="d5o-package-proof-action" type="button" onClick={() => onOpenEvidence(item.id)}>Add proof for this package →</button> : null}{item.status !== "planned" && item.status !== "accepted" ? incompleteFacts ? facts : <details className="d5o-package-adjust"><summary>Adjust actual quantities</summary>{facts}</details> : null}</article>;
  };
  return <div className="d5o-package-list">{(focus ? active : packages).map(card)}{focus && accepted.length ? <details className="d5o-task-disclosure"><summary>View accepted packages ({accepted.length})</summary><div className="d5o-package-list">{accepted.map(card)}</div></details> : null}{focus && !active.length ? <p className="d5o-good-copy">{packages.length ? "All current packages have recorded acceptance." : "No controlled packages have been created. Add a Work Package in Design before recording execution."}</p> : null}</div>;
}
function EvidenceList({ evidence, packages, onReview }: { evidence: EvidenceItem[]; packages?: WorkPackage[]; onReview: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="d5o-evidence-list">{evidence.map((item) => <article key={item.id}><i className={item.state}>{item.state === "draft" ? "!" : "✓"}</i><div><strong>{item.name}</strong><span>{item.kind} · {item.added}</span><small>Applies to: {item.packageId ? packages?.find((entry) => entry.id === item.packageId)?.name ?? "Unknown package" : "Whole Work Record"}</small>{item.source ? <small>Source: {item.source}</small> : null}{item.reviewNote ? <small>Review: {item.reviewNote} · {item.reviewedAt}</small> : null}</div><b>{label(item.state)}</b>{item.state === "draft" ? <form className="d5o-evidence-review" onSubmit={onReview}><input type="hidden" name="evidenceId" value={item.id} /><label>Review note<input name="reviewNote" placeholder="What was inspected and what did it establish?" required /></label><label className="d5o-review-confirm"><input type="checkbox" name="reviewConfirmed" required /> I inspected the identified source.</label><button type="submit">Record reference review</button></form> : null}</article>)}{!evidence.length ? <p className="d5o-empty-state">No evidence is connected yet.</p> : null}</div>;
}
function IssueList({ issues, evidence, currentOwner, onResolve, onException, onOpenEvidence }: { issues: ControlledIssue[]; evidence: EvidenceItem[]; currentOwner: string; onResolve: (event: FormEvent<HTMLFormElement>) => void; onException: (event: FormEvent<HTMLFormElement>) => void; onOpenEvidence: () => void }) {
  const active = issues.filter((item) => item.status === "open");
  return <div className="d5o-issue-list">{active.length ? active.map((item) => {
    const requiredKind = item.requiredProofKind ?? "Test result";
    const eligible = evidence.filter((entry) => entry.state === "verified" && entry.added !== "Baseline" && (!item.affectedPackageId || entry.packageId === item.affectedPackageId) && (requiredKind === "Any reviewed proof" || entry.kind === requiredKind));
    const exceptionProof = evidence.filter((entry) => entry.kind === "Exception authorization" && entry.state === "verified" && entry.added !== "Baseline" && (!item.affectedPackageId || entry.packageId === item.affectedPackageId));
    return <article key={item.id}>
      <div><small>OPEN CONDITION · {item.created}</small><strong>{item.title}</strong><p>{item.impact}</p><span>Owner: {item.owner} · Required proof: {requiredKind}</span></div>
      {eligible.length ? <form className="d5o-issue-resolution" onSubmit={onResolve}><input type="hidden" name="issueId" value={item.id} /><label>Reviewed resolution proof<select name="proofId" defaultValue="" required><option value="" disabled>Choose reviewed proof</option>{eligible.map((proof) => <option key={proof.id} value={proof.id}>{proof.name}</option>)}</select></label><label>Resolution note<input name="resolution" placeholder="Describe how the condition was cleared" required /></label><button>Record resolution</button></form> : <div className="d5o-issue-action"><small>REQUIRED FIRST</small><strong>Review the required {requiredKind === "Any reviewed proof" ? "proof" : requiredKind.toLowerCase()} before resolving this issue.</strong><p>The current baseline references do not establish the new resolution. Add and review the actual retest or resolution source.</p><button type="button" onClick={onOpenEvidence}>Add and review required proof →</button></div>}
      {item.allowsException ? <details className="d5o-issue-exception"><summary>Use an authorized exception instead</summary><form className="d5o-exception-resolution" onSubmit={onException}><input type="hidden" name="issueId" value={item.id} /><div><strong>Governed exception</strong><span>Only when remediation cannot clear the condition and the configured authority permits an exception. This synthetic prototype records the basis; it does not grant real authority.</span></div><label>Reviewed exception source<select name="exceptionProofId" defaultValue="" required><option value="" disabled>Choose reviewed authorization source</option>{exceptionProof.map((proof) => <option key={proof.id} value={proof.id}>{proof.name}</option>)}</select></label><label>Independent authority<input name="authority" placeholder={`Named authority other than ${currentOwner}`} required /></label><label>Authority basis<input name="authorityBasis" placeholder="Decision right or delegation reference" required /></label><label>Rationale<input name="exceptionRationale" placeholder="Why an exception is permissible" required /></label><button disabled={!exceptionProof.length}>Record synthetic exception</button>{!exceptionProof.length ? <button type="button" onClick={onOpenEvidence}>Add and review exception source →</button> : null}</form></details> : null}
    </article>;
  }) : <p className="d5o-good-copy">No uncontrolled issue is open on this Work Record.</p>}</div>;
}
function LifecycleList({ actions }: { actions: LifecycleAction[] }) { return <div className="d5o-lifecycle-list">{actions.map((item) => <article key={item.id}><i>↗</i><div><strong>{item.action}</strong><span>{item.owner} · {item.due}</span></div><b>{label(item.status)}</b></article>)}{!actions.length ? <p className="d5o-empty-state">No lifecycle action has been planned yet.</p> : null}</div>; }
