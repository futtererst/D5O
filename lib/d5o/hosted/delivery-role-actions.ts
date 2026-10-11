import type { WorkRecord } from "@/components/d5o/platform/work-types";
import { assessPackageCompletion, currentAcceptedRelease, currentReviewedCompletion, currentWorkAcceptanceScope, deployState } from "@/components/d5o/platform/deploy-model";

export type DeliveryAction = {
  kind: string; workId: string; packageId: string | null; decisionId: string; releaseId: string | null;
  revision: number; sourceRevision: number; title: string; customer: string; site?: string; packageName?: string; phase: "Deploy";
  focus: string; position: "available" | "preparation" | "waiting"; responsibleRole: string;
  blocker: string | null; dueDate: null;
};

/** Read-only projection. Each typed command independently rechecks current authority and sources. */
export function deliveryRoleActions(records: WorkRecord[], actorId: string, role: string): DeliveryAction[] {
  // Field workers use their assignment-scoped view; this cross-work decision
  // projection must not disclose unrelated customer or package information.
  if (!["project_manager", "field_supervisor", "operations_leader"].includes(role)) return [];
  const actions: DeliveryAction[] = [];
  for (const work of records) {
    if (!work.canonicalWorkId || !work.packages?.length) continue;
    const state = deployState(work);
    const sourceRevision = state.authorityRevision ?? 0;
    const add = (kind: string, packageId: string | null, decisionId: string, releaseId: string | null,
      revision: number, focus: string, responsibleRole: string, allowed: boolean, blocker: string | null = null) => {
      actions.push({ kind, workId: work.id, packageId, decisionId, releaseId, revision, sourceRevision,
        title: work.title, customer: work.customer, site: work.site, packageName: packageId ? work.packages?.find((item) => item.id === packageId)?.name : undefined, phase: "Deploy", focus, responsibleRole,
        position: blocker ? allowed ? "preparation" : "waiting" : allowed ? "available" : "waiting", blocker,
        dueDate: null });
    };
    for (const pkg of work.packages) {
      const release = currentAcceptedRelease(work, pkg.id);
      if (!release || work.design?.packages.find((p) => p.packageId === pkg.id)?.revision !== release.packageRevision) continue;
      const reports = state.reports.filter((r) => r.packageId === pkg.id && r.releaseId === release.id);
      for (const report of reports.filter((r) => r.status === "Submitted"))
        add("Field report review", pkg.id, report.id, release.id, report.revision, "report-review", "Field supervisor or Operations leader",
          ["field_supervisor", "operations_leader"].includes(role) && report.authorId !== actorId);
      for (const evidence of state.evidence.filter((e) => e.packageId === pkg.id && e.releaseId === release.id && e.state === "Uploaded"))
        add("Evidence review", pkg.id, evidence.id, release.id, 1, "evidence-review", "Field supervisor or Operations leader",
          ["field_supervisor", "operations_leader"].includes(role) && evidence.uploaderId !== actorId);
      for (const inspection of state.inspections.filter((i) => i.packageId === pkg.id && i.releaseId === release.id && i.status === "Submitted"))
        add(inspection.supersedesId ? "Retest verification" : "Inspection verification", pkg.id, inspection.id, release.id, 1,
          "inspection-review", "Operations leader (Quality reviewer)", role === "operations_leader" && inspection.actorId !== actorId);
      const completion = currentReviewedCompletion(work, pkg.id);
      const issuedTurnover = state.turnovers.some((t) => t.releaseIds.includes(release.id));
      if (!completion && !issuedTurnover && !state.workAcceptance) {
        const assessment = assessPackageCompletion(work, pkg.id);
        const blocker = assessment.blockers[0] ?? null;
        add("Package completion review", pkg.id, release.id, release.id, release.packageRevision, "completion-review",
          "Operations leader (independent of field reports)", role === "operations_leader", blocker);
      }
      // A conditional customer decision still occupies this release's turnover.
      // The typed command will reject a second assembly for the same release.
      const turnover = state.turnovers.find((t) => t.releaseIds.includes(release.id));
      if (completion && !turnover)
        add("Prepare package turnover", pkg.id, release.id, release.id, release.packageRevision, "turnover",
          "Project manager or field supervisor", ["project_manager", "field_supervisor"].includes(role));
      if (turnover?.status === "Draft")
        add("Record scoped customer acceptance", pkg.id, turnover.id, release.id, turnover.revision, "package-acceptance",
          "Project manager or Operations leader; independent of assembler",
          ["project_manager", "operations_leader"].includes(role) && turnover.assembledByActorId !== actorId,
          "A retained customer-signed document for this exact turnover is required at decision time.");
      if (turnover?.status === "Client accepted" && turnover.receipt === "Awaiting")
        add("Operations package receipt", pkg.id, turnover.id, release.id, turnover.revision, "package-receipt",
          "Operations leader; independent of assembler and acceptance recorder",
          role === "operations_leader" && turnover.assembledByActorId !== actorId &&
            (turnover as typeof turnover & { recordedByActorId?: string }).recordedByActorId !== actorId);
    }
    const accepted = state.workAcceptance;
    const currentScope = currentWorkAcceptanceScope(work);
    const allPackagesAccepted = work.packages.every((pkg) => {
      const release = currentAcceptedRelease(work, pkg.id);
      return release && currentReviewedCompletion(work, pkg.id) &&
        state.turnovers.some((t) => t.status === "Client accepted" && t.releaseIds.includes(release.id));
    });
    if (!accepted && allPackagesAccepted)
      add("Record whole-work customer acceptance", null, work.id, null, state.authorityRevision ?? 0,
        "work-acceptance", "Project manager or Operations leader; independent of turnover assemblers",
        ["project_manager", "operations_leader"].includes(role) &&
          state.turnovers.every((t) => t.assembledByActorId !== actorId),
        "A retained customer-signed document for the exact current package set is required at decision time.");
    if (accepted?.receipt === "Awaiting")
      add("Operations whole-work receipt", null, accepted.id, null, accepted.revision, "work-receipt",
        "Operations leader; independent of acceptance recorder",
        role === "operations_leader" && accepted.recordedByActorId !== actorId,
        currentScope ? state.turnovers.some((t) => accepted.turnoverIds.includes(t.id) && t.receipt !== "Accepted")
          ? "Every accepted package needs an independent Operations receipt first." : null
          : "The accepted package and release set no longer matches current scope.");
  }
  return actions;
}
