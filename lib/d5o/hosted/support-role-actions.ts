import type { WorkRecord } from "@/components/d5o/platform/work-types";
import { currentWorkAcceptanceScope } from "@/components/d5o/platform/deploy-model";
import { supportDocumentationPositions } from "@/components/d5o/platform/support-documentation";

export type SupportAction = {
  kind: "receive-handoff" | "add-asset" | "accept-support" | "activate" | "supply-document" | "review-document";
  workId: string; title: string; customer: string; site?: string; decisionId: string; turnoverId?: string; documentKind?: "as-built" | "inspection"; packageId?: string; packageName?: string;
  decisionRevision: number; sourceRevision: number; deployRevision: number;
  position: "available" | "preparation" | "waiting";
  responsibleRole: string; blocker: string | null;
};

/** Read-only routing. The authenticated typed command owns every decision. */
export function supportRoleActions(records: WorkRecord[], actorId: string, role: string): SupportAction[] {
  if (!["project_manager", "operations_leader"].includes(role)) return [];
  const actions: SupportAction[] = [];
  for (const work of records) {
    if (!work.canonicalWorkId || !work.deploy?.workAcceptance || !currentWorkAcceptanceScope(work)) continue;
    const receipt = work.deploy.workAcceptance, state = work.operate;
    if (receipt.receipt !== "Accepted") continue;
    const base = { workId: work.id, title: work.title, customer: work.customer,
      decisionId: receipt.id, decisionRevision: receipt.revision,
      sourceRevision: state?.authorityRevision ?? 0, deployRevision: work.deploy.authorityRevision ?? 0 };
    const add = (kind: SupportAction["kind"], responsibleRole: string, eligible: boolean, blocker: string | null = null) =>
      actions.push({ ...base, kind, responsibleRole, blocker,
        position: blocker ? eligible ? "preparation" : "waiting" : eligible ? "available" : "waiting" });
    if (!state?.source) add("receive-handoff", "Operations leader who accepted the exact delivery receipt",
      role === "operations_leader" && receipt.receivedByActorId === actorId);
    else if (!state.assets.length) add("add-asset", "Project manager or Operations leader", true,
      "Identify at least one supported asset or infrastructure system from the accepted scope.");
    else if (!state.support) add("accept-support", "Operations leader", role === "operations_leader",
      "Review contact, escalation, intake, coverage dispositions, documents and residual obligations.");
    else if (!state.activation) add("activate", "Operations leader", role === "operations_leader",
      "Review operational readiness and resolve any outstanding prerequisites before authorization.");
    if (state?.source && state.support) {
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
