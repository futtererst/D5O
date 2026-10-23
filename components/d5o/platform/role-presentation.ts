/** Presentation only. Commands and reads still enforce membership and authority on the server. */
export type WorkSurface = "discover" | "define" | "develop" | "operate" | "home" | "my-work" | "portfolio" | "design-queue" | "decisions" | "crew" | "people" | "execution" | "handoff" | "library" | "insights" | "operating" | "configuration" | "start" | "record";

type RolePresentation = {
  primary: readonly WorkSurface[];
  phases: readonly ("discover" | "define" | "develop" | "design" | "deploy" | "operate")[];
  context: readonly WorkSurface[];
  canStart: boolean;
};

/** These are the existing membership roles. Assignment does not add rights to a command. */
export const assignableWorkspaceRoles = [
  ["project_manager", "Project manager"],
  ["operations_leader", "Operations leader"],
  ["billing_commercial_lead", "Finance / commercial lead"],
  ["field_supervisor", "Field supervisor"],
  ["business_development_lead", "Business development · Discover"],
  ["closeout_lead", "Closeout lead · read-only hosted view"],
  ["executive", "Executive · read-only"],
  ["read_only_auditor", "Read-only auditor"],
] as const;

const roles: Record<string, RolePresentation> = {
  admin: { primary: ["my-work", "home", "portfolio"], phases: ["discover", "define", "develop", "design", "deploy", "operate"], context: ["decisions", "crew", "people", "execution", "handoff", "library", "insights", "operating", "configuration", "start"], canStart: true },
  project_manager: { primary: ["my-work", "home", "portfolio"], phases: ["discover", "define", "develop", "design", "deploy", "operate"], context: ["decisions", "crew", "people", "execution", "handoff", "library", "insights", "start"], canStart: true },
  business_development_lead: { primary: ["my-work", "home"], phases: ["discover"], context: ["portfolio", "decisions", "library"], canStart: false },
  closeout_lead: { primary: ["my-work", "home"], phases: [], context: ["portfolio", "handoff", "library"], canStart: false },
  billing_commercial_lead: { primary: ["my-work", "home"], phases: ["discover", "define", "develop", "operate"], context: ["portfolio", "decisions", "library", "insights"], canStart: false },
  operations_leader: { primary: ["my-work", "home", "crew"], phases: ["define", "design", "deploy", "operate"], context: ["portfolio", "decisions", "people", "execution", "handoff", "library", "insights"], canStart: false },
  field_supervisor: { primary: ["my-work", "crew", "execution"], phases: ["design", "deploy"], context: ["home", "portfolio", "people", "handoff", "library"], canStart: false },
  read_only_auditor: { primary: ["my-work", "portfolio"], phases: [], context: ["home", "decisions", "handoff", "library", "insights"], canStart: false },
  executive: { primary: ["my-work", "portfolio"], phases: [], context: ["home", "decisions", "handoff", "library", "insights"], canStart: false }
};

const restricted: RolePresentation = { primary: ["my-work"], phases: [], context: [], canStart: false };

export function presentationForRole(role: string | undefined, hosted: boolean): RolePresentation {
  // The local sample has no authenticated role. Hosted unknown roles stay restricted.
  return hosted ? roles[role ?? ""] ?? restricted : roles.admin;
}

export function canPresentSurface(presentation: RolePresentation, surface: WorkSurface): boolean {
  if (surface === "record") return presentation !== restricted;
  if (surface === "design-queue") return presentation.phases.includes("design");
  return presentation.primary.includes(surface) || presentation.context.includes(surface) ||
    presentation.phases.includes(surface as RolePresentation["phases"][number]);
}
