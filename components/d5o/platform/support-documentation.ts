import type { WorkRecord } from "./work-types";
import type { SupportDocumentation } from "./operate-model";

export type DocumentationPosition = {
  turnoverId: string; turnoverRevision: number; packageId: string; releaseId: string;
  kind: "as-built" | "inspection"; current?: SupportDocumentation;
  status: "Outstanding" | "Submitted" | "Reviewed" | "Returned";
};

/** The latest exact retained version controls the obligation; prior reviews remain history. */
export function supportDocumentationPositions(work: WorkRecord): DocumentationPosition[] {
  const accepted = work.deploy?.workAcceptance, source = work.operate?.source;
  if (!accepted || accepted.receipt !== "Accepted" || !source ||
    source.workAcceptanceId !== accepted.id || source.revision !== accepted.revision) return [];
  const docs = work.operate?.documentationObligations ?? [];
  return (work.deploy?.turnovers ?? []).filter((turnover) =>
    accepted.turnoverIds.includes(turnover.id) && source.turnoverIds.includes(turnover.id) &&
    turnover.status === "Client accepted" && turnover.receipt === "Accepted")
    .flatMap((turnover) => (["as-built", "inspection"] as const)
      .filter((kind) => turnover.obligations.toLowerCase().includes(kind))
      .flatMap((kind) => {
        const release = work.design?.releases.find((item) =>
          turnover.releaseIds.includes(item.id) && item.status === "Accepted");
        if (!release) return [];
        const history = docs.filter((item) => item.turnoverId === turnover.id &&
          item.kind === kind && item.basis.packageId === release.packageId &&
          item.basis.releaseId === release.id &&
          item.basis.releaseRevision === release.packageRevision &&
          item.basis.turnoverRevision === turnover.revision &&
          item.basis.workAcceptanceId === accepted.id &&
          item.basis.workAcceptanceRevision === accepted.revision);
        const current = history.at(-1);
        return [{ turnoverId: turnover.id, turnoverRevision: turnover.revision,
          packageId: release.packageId, releaseId: release.id, kind, current,
          status: current?.status ?? "Outstanding" } as DocumentationPosition];
      }));
}
