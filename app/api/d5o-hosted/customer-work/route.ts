import { NextRequest, NextResponse } from "next/server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { customerWorkScope, type CustomerRpcError } from "@/lib/d5o/hosted/customer-work-scope";
import { HostedStateError } from "@/lib/d5o/hosted/prototype-context";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body,
  { status, headers: { "Cache-Control": "no-store" } });
type WorkRow = { id: string; canonicalWorkId?: string; title: string;
  phaseConfigurationVersionId?: string; customer?: string; site?: string; owner?: string;
  type?: string; workspace?: string };
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
    if (!workId) return reply({ workspace, workspaceName: context.actor.workspaceName ?? workspace,
      role: context.actor.role, revision: loaded.revision,
      records: records.filter((work) => work.workspace === workspace && work.canonicalWorkId)
        .map(({ id, title, customer, site, owner, type, phaseConfigurationVersionId }) =>
          ({ id, title, customer, site, owner, type, phaseConfigurationVersionId })) });
    const record = records.find((work) => work.id === workId && work.workspace === workspace
      && work.canonicalWorkId);
    if (!record) return reply({ error: "work_unavailable" }, 404);
    const status = await call("d5o_hosted_phase_status_read_v1",
      { p_workspace_key: workspace, p_presentation_id: workId });
    if (status.error) return reply({ error: status.error.message }, errorStatus(status.error));
    return reply({ workspace, workspaceName: context.actor.workspaceName ?? workspace,
      role: context.actor.role, canEdit: context.canEdit, revision: loaded.revision,
      record, phaseStatus: status.data });
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
  if (body.command !== "operate" || !body.workId || !/^[0-9a-f-]{36}$/i.test(body.commandId ?? "")
    || !body.arguments || typeof body.arguments !== "object" || Array.isArray(body.arguments))
    return reply({ error: "invalid_command" }, 400);
  if (Object.keys(body.arguments).some((key) => !permittedArguments.has(key)))
    return reply({ error: "invalid_command_argument" }, 400);
  if ((body.arguments.p_action !== "receive-handoff" && body.arguments.p_action !== "activate")
    || typeof body.arguments.p_input !== "object" || body.arguments.p_input === null
    || Array.isArray(body.arguments.p_input)
    || !Number.isInteger(body.arguments.p_expected_source_revision)
    || !Number.isInteger(body.arguments.p_expected_deploy_revision)
    || !Number.isInteger(body.arguments.p_expected_operate_revision))
    return reply({ error: "invalid_command_argument" }, 400);
  try {
    const { context, call } = await customerWorkScope(workspace);
    if (context.actor.role !== "operations_leader") return reply({ error: "role_forbidden" }, 403);
    const loaded = await context.read("work");
    const records = Array.isArray(loaded.state?.records) ? loaded.state.records as WorkRow[] : [];
    if (!records.some((work) => work.id === body.workId && work.workspace === workspace
      && work.canonicalWorkId)) return reply({ error: "work_unavailable" }, 404);
    const args = { ...body.arguments, p_workspace_key: workspace,
      p_presentation_id: body.workId,
      p_command_id: body.commandId };
    const result = await call("d5o_hosted_operate_command_v1", args);
    if (result.error) return reply({ error: result.error.message }, errorStatus(result.error));
    const refreshed = await call("d5o_hosted_phase_status_read_v1",
      { p_workspace_key: workspace, p_presentation_id: body.workId });
    return reply({ result: result.data, phaseStatus: refreshed.error ? null : refreshed.data });
  } catch (error) {
    if (error instanceof HostedStateError) return reply({ error: error.code }, error.status);
    return reply({ error: "customer_work_unavailable" }, 503);
  }
}
