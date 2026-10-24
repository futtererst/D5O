export type CustomerWorkTask = { id: string; workId: string; title: string; phase: string;
  status: "available" | "view_only"; revision: number; packageId?: string; releaseId?: string;
  dueDate?: string; action?: string; reviewRole?: string };

export type CustomerTaskWork = { id: string;
  discovery?: { pursuitControl?: { handoff?: { status?: string } }; outcome?: string;
    designHandoff?: { status?: string; submittedByActorId?: string } };
  design?: { authorityRevision?: number;
    packages?: Array<{ packageId: string; revision?: number }>;
    documents?: Array<{ id: string; status: string; submittedByActorId?: string }>;
    reviews?: Array<{ id: string; packageId: string; revision?: number; discipline: string; status: string;
      requestedByActorId?: string }>;
    releases?: Array<{
    id: string; packageId: string; status: string; issuedByActorId?: string }> };
  definition?: { status?: string; authorityRevision?: number;
  reviews?: { commercial?: string; delivery?: string };
  decisions?: Array<{ action?: string; actorId?: string; reviewRole?: string }>;
  developHandoff?: { status?: string; submittedByActorId?: string } };
  deploy?: { permits?: Array<{ packageId?: string; status?: string }> } };

type DevelopSchedule = { assignments?: Array<{ id?: string; workId?: string; packageId?: string }>;
  publications?: Array<{ id?: string; assignments?: Array<{ id?: string }> }>;
  receipts?: Array<{ assignmentId?: string; publicationId?: string; response?: string }> };

export function developTasks(records: CustomerTaskWork[], role: string,
  schedule: DevelopSchedule | null): CustomerWorkTask[] {
  if (!["admin", "project_manager", "operations_leader"].includes(role)) return [];
  return records.flatMap((record) => (record.design?.releases ?? [])
    .filter((release) => release.status === "Accepted" && release.packageId)
    .flatMap((release) => {
      const packageId = release.packageId;
      if (record.deploy?.permits?.some((item) => item.packageId === packageId
        && item.status === "Authorized")) return [];
      const booking = (schedule?.assignments ?? []).find((item) => item.workId === record.id
        && item.packageId === packageId);
      const publication = (schedule?.publications ?? []).findLast((item) =>
        (item.assignments ?? []).some((assignment) => assignment.id === booking?.id));
      const acknowledged = (schedule?.receipts ?? []).some((item) =>
        item.assignmentId === booking?.id && item.publicationId === publication?.id
          && item.response === "acknowledged");
      const action = !booking ? "save-booking" : !publication ? "publish-week"
        : !acknowledged ? "await-acknowledgment" : "authorize-start";
      if (action === "authorize-start" && role !== "operations_leader") return [];
      return [{ id: `develop:${record.id}:${packageId}:${action}`,
        workId: record.id, packageId, phase: "Develop", action,
        title: ({ "save-booking": "Assign qualified crew", "publish-week": "Publish crew assignment",
          "await-acknowledgment": "Await employee assignment response",
          "authorize-start": "Authorize field start" } as Record<string, string>)[action],
        status: action === "await-acknowledgment" ? "view_only" as const : "available" as const,
        revision: record.design?.authorityRevision ?? 0 }];
    }));
}

export function defineTasks(records: CustomerTaskWork[], role: string, actorId: string): CustomerWorkTask[] {
  return records.flatMap((record) => {
    const definition = record.definition;
    if (!definition || definition.status === "Draft") {
      if (record.discovery?.pursuitControl?.handoff?.status !== "accepted") return [];
      return ["admin", "project_manager", "operations_leader"].includes(role)
        ? [{ id: `define:${record.id}:submit:${definition?.authorityRevision ?? 0}`,
          workId: record.id, title: "Prepare and submit Define scope", phase: "Define",
          status: "available", revision: definition?.authorityRevision ?? 0, action: "submit" }]
        : [];
    }
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

export function designReceiptTasks(records: CustomerTaskWork[], role: string,
  actorId: string): CustomerWorkTask[] {
  if (!["admin", "operations_leader", "project_manager"].includes(role)) return [];
  return records.flatMap((record) => (record.design?.releases ?? [])
    .filter((release) => release.status === "Awaiting receipt" && release.issuedByActorId !== actorId)
    .map((release) => ({
      id: `design:${record.id}:${release.id}:${record.design?.authorityRevision ?? 0}`,
      workId: record.id, packageId: release.packageId,
      releaseId: release.id,
      title: "Receive released Design package", phase: "Design", status: "available" as const,
      revision: record.design?.authorityRevision ?? 0, action: "respond-receipt"
    })));
}

export function designTasks(records: CustomerTaskWork[], role: string,
  actorId: string, connectedPackages: Array<{ id?: string; workId?: string }> = []): CustomerWorkTask[] {
  return records.flatMap((record) => {
    if (record.discovery?.designHandoff?.status !== "accepted") {
      if (record.discovery?.outcome !== "Won") return [];
      if (role === "operations_leader" && record.discovery?.designHandoff?.status === "submitted"
        && record.discovery.designHandoff.submittedByActorId !== actorId)
        return [{ id: `design:${record.id}:handoff-receipt`, workId: record.id,
          title: "Receive awarded Design handoff", phase: "Design", status: "available" as const,
          revision: 0, action: "accept-handoff" }];
      if (["admin", "project_manager"].includes(role)
        && record.discovery?.designHandoff?.status !== "submitted")
        return [{ id: `design:${record.id}:handoff-submit`, workId: record.id,
          title: "Send awarded Design handoff", phase: "Design", status: "available" as const,
          revision: 0, action: "submit-handoff" }];
      return [];
    }
    const revision = record.design?.authorityRevision ?? 0;
    const task = (id: string, title: string, action: string): CustomerWorkTask => ({
      id: `design:${record.id}:${id}:${revision}`, workId: record.id,
      title, phase: "Design", status: "available", revision, action
    });
    if (role === "operations_leader") return [
      ...(record.design?.documents ?? []).filter((item) => item.status === "In review"
        && item.submittedByActorId !== actorId)
        .map((item) => task(`document:${item.id}`, "Independently review Design document", "approve-document")),
      ...(record.design?.reviews ?? []).filter((item) => item.status === "Requested"
        && (record.design?.packages ?? []).some((pkg) => pkg.packageId === item.packageId
          && pkg.revision === item.revision)
        && item.requestedByActorId !== actorId)
        .map((item) => task(`review:${item.id}`, `Review ${item.discipline} package basis`, "decide-review"))
    ];
    if (!["admin", "project_manager"].includes(role)) return [];
    if (!(record.design?.packages ?? []).length && !connectedPackages.some((item) => item.workId === record.id))
      return [task("prepare", "Prepare Design package", "create-package")];
    if ((record.design?.releases ?? []).some((item) =>
      item.status === "Awaiting receipt" || item.status === "Accepted")) return [];
    const documents = record.design?.documents ?? [];
    if (!documents.length) return [task("document", "Prepare Design document", "save-document")];
    if (documents.some((item) => item.status === "In review")) return [];
    const pending = documents.find((item) => item.status === "Draft" || item.status === "Approved");
    if (pending) return [task(`document:${pending.id}`, pending.status === "Draft"
      ? "Retain and submit Design PDF" : "Issue approved Design document",
      pending.status === "Draft" ? "submit-document" : "issue-document")];
    return [task("release", "Complete and release Design package", "release-package")];
  });
}
