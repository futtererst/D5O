export type ServiceAction = {
  kind: string;
  workId: string;
  workTitle: string;
  requestId: string;
  requestTitle: string;
  customer: string | null;
  site?: string | null;
  childWorkId: string | null;
  requestCycleAt: string;
  coverage: "Chargeable" | "Partially covered";
  requestStatus: string;
  revision: number;
  status: string;
  blocker: string;
  responsibleRole: string | null;
  actionable: boolean;
  ownership: "Available to your role" | "Waiting on another role" | "Information only";
  dueDate: string | null;
  impact?: "Critical" | "High" | "Standard" | null;
  serviceResolutionDueAt: string | null;
  panel: "pricing" | "finance";
};

export function serviceActionHref(workspace: string, action: Pick<ServiceAction, "workId" | "requestId" | "panel" | "kind" | "revision" | "requestCycleAt">): string {
  const params = new URLSearchParams({ workspace, view: "record", record: action.workId,
    section: "Operate", request: action.requestId, focus: action.panel, taskKind: action.kind,
    taskRevision: String(action.revision), requestCycle: action.requestCycleAt });
  return `/work?${params}`;
}

export function serviceRoleLabel(role: string | null): string {
  return ({ project_manager: "Project manager", billing_commercial_lead: "Finance / commercial reviewer",
    operations_leader: "Operations leader" } as Record<string, string>)[role ?? ""] ?? "Assigned authority";
}
