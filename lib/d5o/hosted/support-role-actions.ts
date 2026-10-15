import type { WorkRecord } from "@/components/d5o/platform/work-types";
import { currentWorkAcceptanceScope } from "@/components/d5o/platform/deploy-model";
import { supportDocumentationPositions } from "@/components/d5o/platform/support-documentation";
import { externalAssetIdentityCounts } from "./asset-identity";

export type SupportAction = {
  kind: "receive-handoff" | "add-asset" | "accept-support" | "activate" | "supply-document" | "review-document";
  workId: string; title: string; customer: string; site?: string; decisionId: string; turnoverId?: string; documentKind?: "as-built" | "inspection"; packageId?: string; packageName?: string;
  decisionRevision: number; sourceRevision: number; deployRevision: number;
  position: "available" | "preparation" | "waiting";
  responsibleRole: string; blocker: string | null;
};

/** A returned service visit belongs to its parent request and supported asset, not a second support-onboarding queue. */
export function serviceVisitReturnedToAsset(records: WorkRecord[], work: WorkRecord): boolean {
  const source = work.serviceSource;
  if (!source?.parentWorkId || !source.requestId || !source.assetIds.length) return false;
  const parent = records.find((item) => item.id === source.parentWorkId && item.workspace === work.workspace);
  const completedJob = parent?.operate?.jobs.some((item) => item.workId === work.id &&
    item.requestId === source.requestId && item.status === "Completed");
  return !!completedJob && source.assetIds.every((id) => parent?.operate?.assets.some((asset) =>
    asset.id === id && asset.history.some((event) =>
      event.action === "Reviewed service execution linked" && event.source === work.id)));
}

/** Read-only routing. The authenticated typed command owns every decision. */
export function supportRoleActions(records: WorkRecord[], actorId: string, role: string): SupportAction[] {
  if (!["project_manager", "operations_leader"].includes(role)) return [];
  const actions: SupportAction[] = [];
  const identityCounts = new Map<string, Map<string, number>>();
  for (const work of records) {
    if (!work.canonicalWorkId || !work.deploy?.workAcceptance) continue;
    if (serviceVisitReturnedToAsset(records, work)) continue;
    const receipt = work.deploy.workAcceptance, state = work.operate;
    if (receipt.receipt !== "Accepted") continue;
    const base = { workId: work.id, title: work.title, customer: work.customer,
      decisionId: receipt.id, decisionRevision: receipt.revision,
      sourceRevision: state?.authorityRevision ?? 0, deployRevision: work.deploy.authorityRevision ?? 0 };
    const add = (kind: SupportAction["kind"], responsibleRole: string, eligible: boolean, blocker: string | null = null) =>
      actions.push({ ...base, kind, responsibleRole, blocker,
        position: blocker ? eligible ? "preparation" : "waiting" : eligible ? "available" : "waiting" });
    if (currentWorkAcceptanceScope(work)) {
    if (!state?.source) add("receive-handoff", "Operations leader who accepted the exact delivery receipt",
      role === "operations_leader" && receipt.receivedByActorId === actorId);
    else if (!state.assets.length && !state.assetLinks?.some((item) => item.status === "Accepted")) {
      let counts = identityCounts.get(work.workspace);
      if (!counts) {
        counts = externalAssetIdentityCounts(records, work.workspace);
        identityCounts.set(work.workspace, counts);
      }
      const conflicting = records.filter((record) => record.id !== work.id && record.workspace === work.workspace &&
        record.customer.trim().toLowerCase() === work.customer.trim().toLowerCase() &&
        record.site.trim().toLowerCase() === work.site.trim().toLowerCase())
        .flatMap((record) => record.operate?.assets ?? [])
        .filter((asset) => asset.externalId && (counts.get(asset.externalId.trim().toLowerCase()) ?? 0) > 1);
      const identities = [...new Set(conflicting.map((asset) => asset.externalId?.trim()).filter((id): id is string => !!id))];
      add("add-asset", identities.length
        ? "Project manager to resolve identity; current Operations support owner for a later contribution decision"
        : "Project manager or Operations leader", !identities.length || role === "project_manager",
        identities.length
          ? `Asset identity conflict: ${identities.join(", ")} is recorded on multiple assets. Project manager: obtain retained identity evidence. Operations: wait for a supported identity before accepting a contribution. No asset contribution has been accepted.`
          : "Identify at least one supported asset or infrastructure system from the accepted scope.");
    }
    else if (!state.support && !state.assetLinks?.some((item) => item.status === "Accepted")) add("accept-support", "Operations leader", role === "operations_leader",
      "Review contact, escalation, intake, coverage dispositions, documents and residual obligations.");
    else if (!state.activation && !state.assetLinks?.some((item) => item.status === "Accepted")) add("activate", "Operations leader", role === "operations_leader",
      "Review operational readiness and resolve any outstanding prerequisites before authorization.");
    }
    if (state?.source && (state.support || state.assetLinks?.some((item) => item.status === "Accepted"))) {
      for (const doc of supportDocumentationPositions(work).filter((item) => item.status !== "Reviewed")) {
        const review = doc.status === "Submitted";
        actions.push({ ...base, kind: review ? "review-document" : "supply-document",
          turnoverId: doc.turnoverId, documentKind: doc.kind, packageId: doc.packageId,
          packageName: work.packages?.find((item) => item.id === doc.packageId)?.name,
          decisionId: review ? doc.current!.id : doc.turnoverId,
          decisionRevision: doc.turnoverRevision,
          responsibleRole: review ? "Operations leader" : "Project manager",
          blocker: review ? null : "Supply a retained PDF for the exact accepted package and release.",
          position: review ? role === "operations_leader" ? "available" : "waiting"
            : role === "project_manager" ? "preparation" : "waiting" });
      }
    }
  }
  return actions;
}
