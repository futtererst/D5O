const labels: Record<string, string> = {
  assigned: "Workspace access assigned", suspended: "Workspace access suspended",
  restored: "Workspace access restored", "membership.succession": "Administrator added",
  "workforce.save-person": "Roster profile changed", "workforce.set-active": "Roster status changed",
  "workforce.bind-person": "Account binding requested", "binding.bound": "Account bound to roster person",
  "binding.corrected": "Account binding corrected", "identity.invite": "Invitation requested",
  "identity.recovery": "Account recovery requested", "delegation.add": "Decision delegate added",
  "delegation.revoke": "Decision delegate revoked", "configuration.activate": "Configuration activated",
  "configuration.validate-publish": "Configuration published", "configuration.create-draft": "Configuration draft created",
};

export function adminActionLabel(action: string) {
  return labels[action] ?? action.replaceAll(/[._-]/g, " ");
}
