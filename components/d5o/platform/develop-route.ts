export const developTaskFocuses = [
  "pricing", "proposal", "solution-prep", "solution-review", "pricing-prep", "proposal-prep",
  "customer-submission-prep", "rom-budget-ack", "rom-design-authorization",
  "design-spend-authority-prep", "design-spend-authority-review",
  "design-spend-commitment-prep", "design-spend-commitment-review",
  "design-handoff-receive", "design-handoff-correction",
] as const;

export type DevelopTaskFocus = (typeof developTaskFocuses)[number];
export type DevelopRoute =
  | { destination: "pipeline" }
  | { destination: "workspace"; recordId: string }
  | { destination: "task"; recordId: string; focus: DevelopTaskFocus; revision: number }
  | { destination: "invalid-task" };

export function isDevelopTaskFocus(value: string | null): value is DevelopTaskFocus {
  return developTaskFocuses.some((focus) => focus === value);
}

// Older task links omit developPanel, so focus still identifies an exact task.
// An explicit pipeline wins over stale record/focus parameters left in a URL.
export function parseDevelopRoute(params: URLSearchParams): DevelopRoute {
  if (params.get("developPanel") === "pipeline") return { destination: "pipeline" };
  const recordId = params.get("record")?.trim();
  const focus = params.get("focus");
  if (params.get("developPanel") === "task" || focus) {
    const rawRevision = params.get("sourceRevision");
    if (!recordId || !isDevelopTaskFocus(focus) || rawRevision === null || !/^\d+$/.test(rawRevision)) return { destination: "invalid-task" };
    const revision = Number(rawRevision);
    return Number.isSafeInteger(revision) ? { destination: "task", recordId, focus, revision } : { destination: "invalid-task" };
  }
  if (params.get("developPanel") === "workspace" && !recordId) return { destination: "invalid-task" };
  return recordId ? { destination: "workspace", recordId } : { destination: "pipeline" };
}

export function writeDevelopRoute(params: URLSearchParams, route: Exclude<DevelopRoute, { destination: "invalid-task" }>) {
  params.set("view", "develop");
  params.set("developPanel", route.destination);
  if (route.destination === "pipeline") {
    params.delete("record"); params.delete("focus"); params.delete("sourceRevision");
  } else {
    params.set("record", route.recordId);
    if (route.destination === "task") {
      params.set("focus", route.focus);
      params.set("sourceRevision", String(route.revision));
    } else {
      params.delete("focus"); params.delete("sourceRevision");
    }
  }
}
