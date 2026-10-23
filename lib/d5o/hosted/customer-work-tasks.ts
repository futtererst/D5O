export type CustomerWorkTask = { id: string; workId: string; title: string; phase: string;
  status: "available" | "view_only"; revision: number; packageId?: string;
  dueDate?: string; action?: string; reviewRole?: string };

export type CustomerTaskWork = { id: string; definition?: { status?: string; authorityRevision?: number;
  reviews?: { commercial?: string; delivery?: string };
  decisions?: Array<{ action?: string; actorId?: string; reviewRole?: string }>;
  developHandoff?: { status?: string; submittedByActorId?: string } } };

export function defineTasks(records: CustomerTaskWork[], role: string, actorId: string): CustomerWorkTask[] {
  return records.flatMap((record) => {
    const definition = record.definition;
    if (!definition) return [];
    const revision = definition.authorityRevision ?? 0;
    const decisions = definition.decisions ?? [];
    const submitter = [...decisions].reverse().find((item) => item.action === "submit")?.actorId;
    const reviewedBy = (reviewRole: string) => decisions.find((item) =>
      item.action === "approve-review" && item.reviewRole === reviewRole)?.actorId;
    const task = (action: string, title: string, reviewRole?: string): CustomerWorkTask => ({
      id: `define:${record.id}:${action}:${reviewRole ?? ""}:${revision}`, workId: record.id, title,
      phase: "Define", status: "available", revision, action, reviewRole
    });
    if (definition.status === "In review") {
      const tasks: CustomerWorkTask[] = [];
      if (submitter !== actorId && definition.reviews?.commercial === "Pending" &&
        reviewedBy("delivery") !== actorId && ["admin", "billing_commercial_lead"].includes(role))
        tasks.push(task("approve-review", "Review commercial scope", "commercial"));
      if (submitter !== actorId && definition.reviews?.delivery === "Pending" &&
        reviewedBy("commercial") !== actorId && ["admin", "operations_leader", "project_manager"].includes(role))
        tasks.push(task("approve-review", "Review delivery scope", "delivery"));
      return tasks;
    }
    if (definition.status === "Approved" && ["admin", "project_manager", "operations_leader"].includes(role)) {
      if (definition.developHandoff?.status === "accepted") return [];
      if (definition.developHandoff?.status === "submitted")
        return definition.developHandoff.submittedByActorId === actorId ? [] :
          [task("accept-handoff", "Receive approved scope")];
      return [task("submit-handoff", "Send approved scope")];
    }
    return [];
  });
}
