import { NextRequest, NextResponse } from "next/server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { customerWorkScope, type CustomerRpcError } from "@/lib/d5o/hosted/customer-work-scope";
import { HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { defineTasks, type CustomerWorkTask } from "@/lib/d5o/hosted/customer-work-tasks";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body,
  { status, headers: { "Cache-Control": "no-store" } });
type WorkRow = { id: string; canonicalWorkId?: string; title: string;
  phaseConfigurationVersionId?: string; customer?: string; site?: string; owner?: string;
  type?: string; workspace?: string; definition?: { status?: string; authorityRevision?: number;
    reviews?: { commercial?: string; delivery?: string };
    decisions?: Array<{ action?: string; actorId?: string; reviewRole?: string }>;
    developHandoff?: { status?: string; submittedByActorId?: string } } };
const permittedArguments = new Set([
  "p_action", "p_input", "p_expected_source_revision",
  "p_expected_deploy_revision", "p_expected_operate_revision",
]);
function errorStatus(error: CustomerRpcError) {
  return error.code === "42501" ? 403 : error.code === "23505" ? 409
    : error.code === "23514" || error.code === "22023" ? 422 : 503;
}

export async function GET(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  const workId = request.nextUrl.searchParams.get("workId");
  try {
    const { context, call } = await customerWorkScope(workspace);
    const loaded = await context.read("work");
    const records = Array.isArray(loaded.state?.records) ? loaded.state.records as WorkRow[] : [];
    if (!workId) {
      const visible = records.filter((work) => work.workspace === workspace && work.canonicalWorkId);
      const queued = await call("d5o_hosted_role_actions_v1", { p_workspace_key: workspace });
      if (queued.error || !Array.isArray(queued.data))
        return reply({ error: queued.error?.message ?? "task_queue_unavailable" }, 503);
      const visibleIds = new Set(visible.map((item) => item.id));
      const roleTasks = (queued.data as Array<Record<string, unknown>>)
        .filter((item) => typeof item.workId === "string" && visibleIds.has(item.workId))
        .map((item): CustomerWorkTask => ({ id: `role:${item.workId}:${item.kind}:${item.packageId ?? ""}:${item.revision}`,
          workId: item.workId as string, title: String(item.title ?? item.kind ?? "Review Work"),
          phase: String(item.phase ?? "Work"), status: "view_only",
          revision: Number(item.revision) || 0,
          dueDate: typeof item.dueDate === "string" ? item.dueDate : undefined,
          packageId: typeof item.packageId === "string" ? item.packageId : undefined }));
      return reply({ workspace, workspaceName: context.actor.workspaceName ?? workspace,
      role: context.actor.role, revision: loaded.revision,
      tasks: [...defineTasks(visible, context.actor.role, context.actor.id), ...roleTasks],
      records: visible
        .map(({ id, title, customer, site, owner, type, phaseConfigurationVersionId }) =>
          ({ id, title, customer, site, owner, type, phaseConfigurationVersionId })) });
    }
    const record = records.find((work) => work.id === workId && work.workspace === workspace
      && work.canonicalWorkId);
    if (!record) return reply({ error: "work_unavailable" }, 404);
    const status = await call("d5o_hosted_phase_status_read_v1",
      { p_workspace_key: workspace, p_presentation_id: workId });
    if (status.error) return reply({ error: status.error.message }, errorStatus(status.error));
    return reply({ workspace, workspaceName: context.actor.workspaceName ?? workspace,
      role: context.actor.role, canEdit: context.canEdit, revision: loaded.revision,
      record, defineActions: defineTasks([record], context.actor.role, context.actor.id),
      phaseStatus: status.data });
  } catch (error) {
    if (error instanceof HostedStateError) return reply({ error: error.code }, error.status);
    return reply({ error: "customer_work_unavailable" }, 503);
  }
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  let body: { workId?: string; command?: string; commandId?: string;
    arguments?: Record<string, unknown> };
  try { const raw = await request.text(); if (raw.length > 30000) return reply({ error: "command_too_large" }, 413);
    body = JSON.parse(raw) as typeof body; } catch { return reply({ error: "invalid_command" }, 400); }
  if (!["operate", "define"].includes(body.command ?? "") || !body.workId || !/^[0-9a-f-]{36}$/i.test(body.commandId ?? "")
    || !body.arguments || typeof body.arguments !== "object" || Array.isArray(body.arguments))
    return reply({ error: "invalid_command" }, 400);
  const allowedArguments = body.command === "define"
    ? new Set(["p_action", "p_review_role", "p_reason", "p_expected_source_revision", "p_expected_decision_revision"])
    : permittedArguments;
  if (Object.keys(body.arguments).some((key) => !allowedArguments.has(key)))
    return reply({ error: "invalid_command_argument" }, 400);
  if (body.command === "operate" && ((body.arguments.p_action !== "receive-handoff" && body.arguments.p_action !== "activate")
    || typeof body.arguments.p_input !== "object" || body.arguments.p_input === null
    || Array.isArray(body.arguments.p_input)
    || !Number.isInteger(body.arguments.p_expected_source_revision)
    || !Number.isInteger(body.arguments.p_expected_deploy_revision)
    || !Number.isInteger(body.arguments.p_expected_operate_revision)))
    return reply({ error: "invalid_command_argument" }, 400);
  if (body.command === "define" && (
    !["approve-review", "return-review", "submit-handoff", "accept-handoff", "return-handoff"].includes(String(body.arguments.p_action))
    || !Number.isInteger(body.arguments.p_expected_source_revision)
    || !Number.isInteger(body.arguments.p_expected_decision_revision)
    || typeof body.arguments.p_reason !== "string" || !body.arguments.p_reason.trim()
    || (["approve-review", "return-review"].includes(String(body.arguments.p_action))
      ? !["commercial", "delivery"].includes(String(body.arguments.p_review_role))
      : body.arguments.p_review_role != null)))
    return reply({ error: "invalid_command_argument" }, 400);
  try {
    const { context, call } = await customerWorkScope(workspace);
    if (body.command === "operate" && context.actor.role !== "operations_leader") return reply({ error: "role_forbidden" }, 403);
    if (body.command === "define" && !["admin", "project_manager", "operations_leader", "billing_commercial_lead"].includes(context.actor.role))
      return reply({ error: "role_forbidden" }, 403);
    const loaded = await context.read("work");
    const records = Array.isArray(loaded.state?.records) ? loaded.state.records as WorkRow[] : [];
    if (!records.some((work) => work.id === body.workId && work.workspace === workspace
      && work.canonicalWorkId)) return reply({ error: "work_unavailable" }, 404);
    const args = { ...body.arguments, p_workspace_key: workspace,
      p_presentation_id: body.workId,
      p_command_id: body.commandId };
    const result = await call(body.command === "define" ? "d5o_hosted_define_command_v1" : "d5o_hosted_operate_command_v1", args);
    if (result.error) return reply({ error: result.error.message }, errorStatus(result.error));
    const refreshed = await call("d5o_hosted_phase_status_read_v1",
      { p_workspace_key: workspace, p_presentation_id: body.workId });
    return reply({ result: result.data, phaseStatus: refreshed.error ? null : refreshed.data });
  } catch (error) {
    if (error instanceof HostedStateError) return reply({ error: error.code }, error.status);
    return reply({ error: "customer_work_unavailable" }, 503);
  }
}
