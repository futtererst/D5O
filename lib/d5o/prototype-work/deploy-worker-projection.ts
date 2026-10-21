import "server-only";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import { assessPackageCompletion } from "@/components/d5o/platform/deploy-model";

export type WorkerPackageProgress = {
  releaseId: string | null;
  plannedQuantity: number | null;
  reviewedQuantity: number | null;
  remainingQuantity: number | null;
  unit: string | null;
};
export type WorkerProjectedWork = WorkRecord & { workerProgress: WorkerPackageProgress };

/** Server-derived aggregate only. Other workers' reports and evidence never enter the worker projection. */
export function workerPackageProgress(work: WorkRecord, packageId: string): WorkerPackageProgress {
  const assessed = assessPackageCompletion(work, packageId);
  return { releaseId: assessed.release?.id ?? null,
    plannedQuantity: assessed.basis?.kind === "Measured" ? assessed.basis.plannedQuantity : null,
    reviewedQuantity: assessed.reviewedQuantity, remainingQuantity: assessed.remainingQuantity,
    unit: assessed.basis?.kind === "Measured" ? assessed.basis.unit : null };
}

/** A worker receives only their assignment's instructions and own reports, never the commercial Work Record. */
export function deployWorkerProjection(work: WorkRecord, packageId: string, bookingId: string, actorId: string): WorkerProjectedWork {
  return { workerProgress: workerPackageProgress(work, packageId), id: work.id, canonicalWorkId: work.canonicalWorkId, workspace: work.workspace, title: work.title, type: work.type, customer: work.customer, site: work.site, stage: work.stage, owner: work.owner,
    nextAction: work.nextAction, progress: work.progress, value: "", status: work.status, proof: [], blockers: [], history: [],
    design: { authorityRevision: work.design?.authorityRevision, documents: [], packages: [], reviews: [], releases: (work.design?.releases ?? []).filter((item) => item.packageId === packageId).map((item) => ({ ...item, sourceSnapshot: null })), history: [] },
    deploy: { authorityRevision: work.deploy?.authorityRevision, permits: (work.deploy?.permits ?? []).filter((item) => item.packageId === packageId), reports: (work.deploy?.reports ?? []).filter((item) => item.bookingId === bookingId && item.authorId === actorId), inspections: (work.deploy?.inspections ?? []).filter((item) => item.packageId === packageId && item.actorId === actorId), issues: (work.deploy?.issues ?? []).filter((item) => item.packageId === packageId && item.raisedBy === actorId), evidence: (work.deploy?.evidence ?? []).filter((item) => item.packageId === packageId && item.uploaderId === actorId), signoffs: (work.deploy?.signoffs ?? []).filter((item) => item.kind === "Customer report acknowledgment" && (work.deploy?.reports ?? []).some((report) => report.id === item.recordId && report.bookingId === bookingId && report.authorId === actorId)), turnovers: [], events: [] } };
}
