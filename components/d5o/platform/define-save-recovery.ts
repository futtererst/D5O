const projectionFields = new Set(["history", "reviews", "status", "revision", "developHandoff", "decisions", "approvedBaselines", "authorityRevision", "sourceEstimateRevision", "sourceProposalRevision", "configurationVersion", "configurationWorkTypeKey"]);

/** Compare only what the user changed; a protected save may reproject other fields. */
export function retainedEditsPresent(before: unknown, draft: unknown, current: unknown, topLevel = false): boolean {
  if (JSON.stringify(before) === JSON.stringify(draft)) return true;
  if (draft && typeof draft === "object" && !Array.isArray(draft) && current && typeof current === "object" && !Array.isArray(current)) {
    const prior = before && typeof before === "object" && !Array.isArray(before) ? before as Record<string, unknown> : {};
    const proposed = draft as Record<string, unknown>;
    const shared = current as Record<string, unknown>;
    return Object.keys(proposed).every((key) => topLevel && projectionFields.has(key) || retainedEditsPresent(prior[key], proposed[key], shared[key]));
  }
  // The editor represents an absent optional text field as an empty input.
  const normalized = (value: unknown) => value === undefined || value === null ? "" : value;
  return JSON.stringify(normalized(draft)) === JSON.stringify(normalized(current));
}
