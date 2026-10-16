import type { WorkRecord, WorkspaceKey } from "./work-types";
import { coverageFor, operateState, type ServiceRequest } from "./operate-model";
import { supportDocumentationPositions } from "./support-documentation";

export type SupportQueueItem = {
  key: string; workId: string; requestId?: string; section: "Handoff & activation" | "Assets" | "Coverage" | "Requests & jobs" | "Maintenance";
  severity: "Overdue" | "Action" | "Upcoming"; label: string; detail: string; owner: string; dueAt?: string;
};

function localDay(at: string, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at));
    const part = (kind: string) => parts.find((item) => item.type === kind)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch { return at.slice(0, 10); }
}
const addDays = (day: string, count: number) => new Date(Date.parse(`${day}T12:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
const open = (request: ServiceRequest) => !["Resolved", "Closed"].includes(request.status);

export function buildSupportQueue(records: WorkRecord[], workspace: WorkspaceKey, now: string, timezone: string | ((work: WorkRecord) => string), includeCommercial = true): SupportQueueItem[] {
  const soon = Date.parse(now) + 24 * 3_600_000;
  const items: SupportQueueItem[] = [];
  for (const work of records) {
    if (work.workspace !== workspace) continue;
    const today = localDay(now, typeof timezone === "string" ? timezone : timezone(work)), next30 = addDays(today, 30);
    const state = operateState(work), push = (item: Omit<SupportQueueItem, "workId">) => items.push({ ...item, workId: work.id });
    if (!state.source && (work.deploy?.workAcceptance?.receipt === "Accepted" || work.deploy?.turnovers?.some((item) => item.status === "Client accepted" && item.receipt === "Accepted"))) {
      push({ key: `${work.id}:handoff`, section: "Handoff & activation", severity: "Action", label: "Accept Deploy handoff", detail: "Exact accepted turnover awaits an independent Operate receipt.", owner: "Operations leader" });
    }
    if (state.activation?.status === "Active" && state.support && !state.support.residualOwner && work.deploy?.turnovers?.some((item) => item.obligations.trim())) {
      push({ key: `${work.id}:residual`, section: "Handoff & activation", severity: "Action", label: "Assign residual obligation", detail: "Accepted turnover names continuing work without an accountable owner.", owner: "Operations leader" });
    }
    for (const doc of supportDocumentationPositions(work).filter((entry) => entry.status !== "Reviewed")) {
      const packageName = work.packages?.find((entry) => entry.id === doc.packageId)?.name ?? "Package name unavailable";
      push({ key: work.id + ":document:" + doc.turnoverId + ":" + doc.kind,
        section: "Handoff & activation", severity: "Action",
        label: (doc.kind === "as-built" ? "As-built record" : "Inspection record") + ": " + doc.status,
        detail: packageName + " · " + (doc.status === "Submitted" ? "independent document review due" :
            "retained document supply or correction due"),
        owner: doc.status === "Submitted" ? "Operations leader" :
          state.support?.residualOwner || "Project manager" });
    }
    for (const asset of state.assets) {
      if (state.activation?.status !== "Active") continue;
      const coverage = coverageFor(state, asset.id, today);
      if (coverage.decision === "Expired" || coverage.conflict) push({ key: `${work.id}:asset:${asset.id}:coverage`, section: "Coverage", severity: "Action", label: `${asset.name}: review coverage`, detail: coverage.basis, owner: state.support?.owner ?? "Operations lead" });
    }
    for (const request of state.requests.filter(open)) {
      const prefix = `${work.id}:request:${request.id}`, owner = request.owner || "Unassigned";
      if (["New", "Reopened"].includes(request.status)) {
        push({ key: `${prefix}:triage`, section: "Requests & jobs", severity: "Action", label: `${request.title}: triage`, detail: "Assess impact, coverage and accountable response.", owner });
        continue;
      }
      if (request.coverage === "Awaiting" || request.coverage === "Expired") {
        push({ key: `${prefix}:coverage`, section: "Coverage", severity: "Action", label: `${request.title}: decide coverage`, detail: request.coverageBasis ?? "Review applicable terms and record a source-backed disposition.", owner });
      }
      if (request.activePause) {
        push({ key: `${prefix}:pause`, section: "Requests & jobs", severity: "Action", label: `${request.title}: SLA paused`, detail: `${request.activePause.reason}; review whether the permitted pause still applies.`, owner });
      } else {
        const next = ([
          ["response", request.responseDueAt, request.respondedAt],
          ["restoration", request.restorationDueAt, request.restoredAt],
          ["resolution", request.resolutionDueAt, request.resolvedAt],
        ] as const).filter(([, due, met]) => due && !met).sort((a, b) => a[1]!.localeCompare(b[1]!))[0];
        if (next && Date.parse(next[1]!) <= soon) push({ key: `${prefix}:sla:${next[0]}`, section: "Requests & jobs", severity: Date.parse(next[1]!) < Date.parse(now) ? "Overdue" : "Upcoming", label: `${request.title}: ${next[0]} deadline`, detail: `Due ${next[1]}; clock from recorded agreement and policy.`, owner, dueAt: next[1] });
      }
      if (includeCommercial && ["Chargeable", "Partially covered"].includes(request.coverage)) {
        const estimate = request.serviceEstimate;
        const current = estimate?.requestCycleAt === (request.reopenedAt ?? request.reportedAt);
        if (!current || estimate?.status !== "Approved") push({ key: `${prefix}:pricing`, requestId: request.id, section: "Requests & jobs", severity: "Action", label: `${request.title}: price service work`, detail: estimate?.status === "Pricing review" ? "Independent pricing decision is pending." : "Prepare or correct a current-cycle estimate before a commercial commitment.", owner });
        else if (request.serviceAuthorization?.estimateRevision !== estimate.revision) push({ key: `${prefix}:authorization`, requestId: request.id, section: "Requests & jobs", severity: "Action", label: `${request.title}: customer authorization`, detail: `Approved estimate revision ${estimate.revision} still needs a recorded external customer decision.`, owner });
      }
    }
    for (const plan of state.maintenance.filter((item) => item.status === "Active" && item.nextDue <= next30)) {
      push({ key: `${work.id}:plan:${plan.id}`, section: "Maintenance", severity: plan.nextDue < today ? "Overdue" : "Upcoming", label: `${plan.title}: maintenance ${plan.nextDue < today ? "overdue" : "due"}`, detail: `Next obligation ${plan.nextDue}; generating a job does not schedule or complete it.`, owner: plan.owner, dueAt: plan.nextDue });
    }
    for (const agreement of state.agreements.filter((item) => item.status === "Active" && item.effectiveTo <= next30)) {
      push({ key: `${work.id}:agreement:${agreement.id}`, section: "Coverage", severity: agreement.effectiveTo < today ? "Overdue" : "Upcoming", label: `${agreement.name}: coverage ${agreement.effectiveTo < today ? "expired" : "expiring"}`, detail: `Recorded end date ${agreement.effectiveTo}; review entitlement or renewal with the customer.`, owner: state.support?.owner ?? "Operations lead", dueAt: agreement.effectiveTo });
    }
    const cutoff = Date.parse(now) - 90 * 86_400_000;
    for (const asset of state.assets) {
      const recent = state.requests.filter((item) => item.assetId === asset.id && Date.parse(item.reportedAt) >= cutoff);
      if (recent.length >= 3) push({ key: `${work.id}:asset:${asset.id}:repeat`, section: "Assets", severity: "Action", label: `${asset.name}: repeated requests`, detail: `${recent.length} requests recorded within 90 days; review causes and history before recommending a remedy or opportunity.`, owner: asset.owner });
    }
  }
  const order = { Overdue: 0, Action: 1, Upcoming: 2 };
  return items.sort((a, b) => order[a.severity] - order[b.severity] || (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") || a.label.localeCompare(b.label));
}
