/** The tenant-neutral Design surface delegates decisions to existing hosted commands. */
export const designActions = [
  "submit-handoff", "accept-handoff",
  "create-package", "save-document", "save-package", "save-demand",
  "submit-document", "return-document", "approve-document", "issue-document",
  "request-review", "decide-review", "release-package", "respond-receipt",
  "record-change", "acknowledge-hold", "resolve-change"
] as const;
export type CustomerDesignAction = typeof designActions[number];

export function isCustomerDesignAction(value: unknown): value is CustomerDesignAction {
  return typeof value === "string" && (designActions as readonly string[]).includes(value);
}

export function designCommandFor(action: CustomerDesignAction) {
  if (action === "submit-handoff" || action === "accept-handoff") return "d5o_hosted_design_handoff_command_v1";
  if (action === "create-package") return "d5o_hosted_create_connected_package_v2";
  if (action === "save-document" || action === "save-package") return "d5o_hosted_design_draft_command_v1";
  if (action === "save-demand") return "d5o_hosted_design_demand_command_v1";
  if (action === "release-package" || action === "respond-receipt") return "d5o_hosted_design_release_command_v1";
  if (action === "record-change" || action === "acknowledge-hold" || action === "resolve-change")
    return "d5o_hosted_design_field_change_command_v1";
  return "d5o_hosted_design_review_command_v1";
}

export function designActionRole(action: CustomerDesignAction, role: string) {
  if (action === "accept-handoff") return role === "operations_leader";
  if (action === "acknowledge-hold") return role === "operations_leader" || role === "field_supervisor" || role === "admin";
  if (action === "record-change" || action === "resolve-change")
    return role === "project_manager" || role === "operations_leader" || role === "admin";
  if (action === "submit-handoff") return role === "admin" || role === "project_manager";
  if (action === "approve-document" || action === "return-document" || action === "decide-review")
    return role === "operations_leader";
  if (action === "submit-document" || action === "issue-document" || action === "request-review"
    || action === "save-document" || action === "save-package" || action === "save-demand"
    || action === "create-package" || action === "release-package")
    return role === "admin" || role === "project_manager";
  return ["admin", "project_manager", "operations_leader"].includes(role);
}
