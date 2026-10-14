import type { WorkRecord } from "@/components/d5o/platform/work-types";
import { currentWorkAcceptanceScope } from "@/components/d5o/platform/deploy-model";

export type ServiceReturnAction = {
  kind: "Link reviewed service execution" | "Complete service job" | "Review request resolution" | "Close reviewed request";
  workId: string;
  workTitle: string;
  customer: string;
  site: string;
  requestId: string;
  requestTitle: string;
  requestCycleAt: string;
  jobId: string;
  childWorkId: string;
  acceptanceId: string;
  operateRevision: number;
  childDeployRevision: number;
  responsibleRole: "Operations leader" | "Project manager";
  blocker: string | null;
  dueDate: string | null;
  impact: "Critical" | "High" | "Standard";
};

/** Routing only. The typed command rechecks membership, exact sources and independence. */
export function serviceReturnActions(records: WorkRecord[], actorId: string, role: string): ServiceReturnAction[] {
  if (role !== "operations_leader" && role !== "project_manager") return [];
  const byId = new Map(records.map((work) => [work.id, work]));
  const actions: ServiceReturnAction[] = [];
  for (const work of records) {
    if (!work.canonicalWorkId || !work.operate) continue;
    for (const request of work.operate.requests) {
      const cycle = request.reopenedAt ?? request.reportedAt;
      const cycleJobs = request.currentCycleJobIds ?? request.jobIds;
      if (cycleJobs.length !== 1) continue;
      const job = work.operate.jobs.find((item) => item.id === cycleJobs[0] && item.requestId === request.id);
      const child = job && byId.get(job.workId);
      if (!job || !child?.canonicalWorkId || child.serviceSource?.parentWorkId !== work.id ||
        child.serviceSource.requestId !== request.id || child.serviceSource.requestCycleAt !== cycle ||
        !job.assetIds.includes(request.assetId) || !child.deploy?.authorityRevision) continue;
      const base = { workId: work.id, workTitle: work.title, customer: work.customer, site: work.site,
        requestId: request.id, requestTitle: request.title, requestCycleAt: cycle, jobId: job.id,
        childWorkId: child.id, acceptanceId: child.deploy.workAcceptance?.id ?? "",
        operateRevision: work.operate.authorityRevision ?? 0,
        childDeployRevision: child.deploy.authorityRevision,
        dueDate: request.resolutionDueAt ?? null, impact: request.impact };
      if (role === "operations_leader" && job.status === "Generated" && request.status === "In progress" &&
        ["Covered", "Partially covered"].includes(request.coverage) &&
        child.deploy.workAcceptance?.receipt === "Accepted" && currentWorkAcceptanceScope(child))
        actions.push({ ...base, kind: "Link reviewed service execution", responsibleRole: "Operations leader",
          blocker: null });
      if (role === "operations_leader" && job.status === "Execution linked" &&
        job.linkedByActorId !== actorId && child.deploy.workAcceptance?.receipt === "Accepted" &&
        job.completionRefs?.length)
        actions.push({ ...base, kind: "Complete service job", responsibleRole: "Operations leader",
          blocker: "A different Operations leader must review the linked execution and record a completion reason." });
      if (role === "project_manager" && job.status === "Completed" && request.status === "In progress" && !request.activePause)
        actions.push({ ...base, kind: "Review request resolution", responsibleRole: "Project manager",
          blocker: "Record the reviewed resolution and its source; completing the job alone does not resolve the request." });
      if (role === "operations_leader" && job.status === "Completed" && request.status === "Resolved" &&
        request.reviewedBy !== actorId)
        actions.push({ ...base, kind: "Close reviewed request", responsibleRole: "Operations leader",
          blocker: "Independently check the current-cycle resolution before closing the request." });
    }
  }
  return actions;
}
