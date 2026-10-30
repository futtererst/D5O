import { NextRequest, NextResponse } from "next/server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { customerWorkScope, customerWorkspaceKey, type CustomerRpcError } from "@/lib/d5o/hosted/customer-work-scope";
import { hostedWorkerContext } from "@/lib/d5o/hosted/worker-context";
import { HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { currentAcceptedRelease } from "@/components/d5o/platform/deploy-model";
import type { WorkRecord } from "@/components/d5o/platform/work-types";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body,
  { status, headers: { "Cache-Control": "no-store" } });
const statusFor = (error: CustomerRpcError) => error.code === "42501" ? 403
  : error.code === "23505" ? 409 : ["23514", "22023"].includes(error.code ?? "") ? 422 : 503;
type Work = { id: string; workspace?: string; canonicalWorkId?: string;
  title?: string; design?: { authorityRevision?: number; releases?: Array<{
    packageId?: string; status?: string }> }; deploy?: { authorityRevision?: number } };
type Input = { workId?: string; packageId?: string; action?: string; commandId?: string;
  expectedRevision?: number; sourceRevision?: number; designRevision?: number;
  scheduleRevision?: number; deployRevision?: number; assignment?: Record<string, unknown>;
  week?: number; publicationId?: string; assignmentId?: string; reason?: string };

async function workerScope(workspace: string) {
  if (!customerWorkspaceKey.test(workspace) || workspace === "rybex" || workspace === "rotork")
    throw new HostedStateError("invalid_workspace", 400);
  const worker = await hostedWorkerContext(workspace);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) =>
    Promise<{ data: unknown; error: CustomerRpcError | null }>;
  const feature = await call("d5o_hosted_capability_read_v1", { p_workspace_key: workspace });
  if (feature.error || (feature.data as { connectedWork?: boolean } | null)?.connectedWork !== true)
    throw new HostedStateError("connected_work_unavailable", 403);
  return { worker, call };
}

export async function GET(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  const workId = request.nextUrl.searchParams.get("workId") ?? "";
  try {
    if (request.nextUrl.searchParams.get("worker") === "1") {
      const { worker } = await workerScope(workspace);
      const schedule = await worker.read("schedule");
      const publications = Array.isArray(schedule.state?.publications)
        ? schedule.state.publications as Array<{ id?: string; assignments?: Array<{
          id?: string; workId?: string; packageId?: string }> }> : [];
      const assigned = publications.some((publication) => (publication.assignments ?? [])
        .some((assignment) => assignment.workId === workId));
      if (workId && !assigned) return reply({ error: "assignment_unavailable" }, 404);
      const workState = await worker.read("work");
      const assignedIds = new Set(publications.flatMap((publication) => (publication.assignments ?? [])
        .map((assignment) => assignment.workId)));
      const works = (Array.isArray(workState.state?.records) ? workState.state.records as Work[] : [])
        .filter((item) => item.workspace === workspace && assignedIds.has(item.id))
        .map((item) => ({ id: item.id, title: item.title ?? "Assigned Work",
          permits: (item.deploy as { permits?: Array<{ packageId?: string; releaseId?: string; status?: string }> } | undefined)
            ?.permits?.filter((permit) => permit.status === "Authorized" && !!permit.packageId &&
              currentAcceptedRelease(item as WorkRecord, permit.packageId)?.id === permit.releaseId) ?? [] }));
      return reply({ role: "field_worker", person: worker.person, workspaceName: worker.workspaceName, schedule,
        works,
        publications: publications.map((publication) => ({ ...publication,
          assignments: (publication.assignments ?? []).filter((assignment) => !workId || assignment.workId === workId) })) });
    }
    const { context, call } = await customerWorkScope(workspace);
    if (!["admin", "project_manager", "operations_leader", "field_supervisor"].includes(context.actor.role))
      return reply({ error: "develop_role_denied" }, 403);
    const source = await context.read("work");
    const records = Array.isArray(source.state?.records) ? source.state.records as Work[] : [];
    const work = records.find((item) => item.id === workId && item.workspace === workspace
      && item.canonicalWorkId);
    if (!work) return reply({ error: "work_unavailable" }, 404);
    const [schedule, workforce] = await Promise.all([
      context.read("schedule"), call("d5o_hosted_workforce_read_v1", { p_workspace_key: workspace })
    ]);
    if (workforce.error) return reply({ error: workforce.error.message }, statusFor(workforce.error));
    return reply({ role: context.actor.role, sourceRevision: source.revision, work,
      schedule, workforce: workforce.data });
  } catch (error) {
    if (error instanceof HostedStateError) return reply({ error: error.code }, error.status);
    return reply({ error: "develop_unavailable" }, 503);
  }
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  let body: Input;
  try { const raw = await request.text();
    if (raw.length > 20000) return reply({ error: "command_too_large" }, 413);
    body = JSON.parse(raw) as Input;
  } catch { return reply({ error: "invalid_command" }, 400); }
  if (body && (Object.hasOwn(body, "configurationVersionId")
    || Object.hasOwn(body, "policyVersionId")))
    return reply({ error: "client_configuration_override_forbidden" }, 400);
  if (!body || !body.workId || !/^[0-9a-f-]{36}$/i.test(body.commandId ?? "")
    || !Number.isInteger(body.expectedRevision)
    || !["save-booking", "publish-week", "cancel-draft-booking", "respond-booking", "authorize-start"].includes(body.action ?? ""))
    return reply({ error: "invalid_command" }, 400);
  try {
    if (body.action === "respond-booking") {
      if (!body.publicationId || !body.assignmentId) return reply({ error: "invalid_assignment" }, 400);
      const { worker, call } = await workerScope(workspace);
      const schedule = await worker.read("schedule");
      const publications = Array.isArray(schedule.state?.publications)
        ? schedule.state.publications as Array<{ id?: string; assignments?: Array<{
          id?: string; workId?: string }> }> : [];
      if (!publications.some((item) => item.id === body.publicationId
        && (item.assignments ?? []).some((assignment) => assignment.id === body.assignmentId
          && assignment.workId === body.workId))) return reply({ error: "assignment_unavailable" }, 404);
      const result = await call("d5o_hosted_crew_command_v1", {
        p_workspace_key: workspace, p_action: "respond-booking",
        p_input: { publicationId: body.publicationId, assignmentId: body.assignmentId,
          response: "acknowledged" }, p_command_id: body.commandId,
        p_expected_revision: body.expectedRevision });
      if (result.error) return reply({ error: result.error.message }, statusFor(result.error));
      return reply({ action: body.action, result: result.data });
    }
    const { context, call } = await customerWorkScope(workspace);
    if (body.action === "authorize-start" ? context.actor.role !== "operations_leader"
      : !["admin", "project_manager", "operations_leader"].includes(context.actor.role))
      return reply({ error: "develop_role_denied" }, 403);
    const source = await context.read("work");
    const work = (Array.isArray(source.state?.records) ? source.state.records as Work[] : [])
      .find((item) => item.id === body.workId && item.workspace === workspace
        && item.canonicalWorkId);
    if (!work) return reply({ error: "work_unavailable" }, 404);
    if (!body.packageId || !(work.design?.releases ?? []).some((release) =>
      release.packageId === body.packageId && release.status === "Accepted"))
      return reply({ error: "accepted_package_required" }, 409);
    let result: { data: unknown; error: CustomerRpcError | null };
    if (body.action === "authorize-start") {
      if (!Number.isInteger(body.sourceRevision) || !Number.isInteger(body.designRevision)
        || !Number.isInteger(body.scheduleRevision) || !Number.isInteger(body.deployRevision)
        || (body.reason ?? "").trim().length < 15) return reply({ error: "invalid_start_basis" }, 400);
      result = await call("d5o_hosted_field_start_command_v1", {
        p_workspace_key: workspace, p_presentation_id: body.workId,
        p_package_id: body.packageId, p_action: "authorize-start",
        p_reason: body.reason, p_command_id: body.commandId,
        p_expected_source_revision: body.sourceRevision,
        p_expected_design_revision: body.designRevision,
        p_expected_schedule_revision: body.scheduleRevision,
        p_expected_deploy_revision: body.deployRevision });
    } else if (body.action === "cancel-draft-booking") {
      if (!body.assignmentId) return reply({ error: "invalid_assignment" }, 400);
      result = await call("d5o_hosted_cancel_draft_booking_v1", {
        p_workspace_key: workspace, p_work_id: body.workId,
        p_package_id: body.packageId, p_assignment_id: body.assignmentId,
        p_command_id: body.commandId, p_expected_revision: body.expectedRevision });
    } else {
      if (body.action === "save-booking" && (!body.assignment
        || body.assignment.workId !== body.workId || body.assignment.packageId !== body.packageId))
        return reply({ error: "invalid_assignment" }, 400);
      if (body.action === "publish-week" && !Number.isInteger(body.week))
        return reply({ error: "invalid_week" }, 400);
      result = await call("d5o_hosted_crew_command_v1", {
        p_workspace_key: workspace, p_action: body.action,
        p_input: body.action === "save-booking" ? { assignment: body.assignment }
          : { week: body.week }, p_command_id: body.commandId,
        p_expected_revision: body.expectedRevision });
    }
    if (result.error) return reply({ error: result.error.message }, statusFor(result.error));
    return reply({ action: body.action, result: result.data });
  } catch (error) {
    if (error instanceof HostedStateError) return reply({ error: error.code }, error.status);
    return reply({ error: "develop_action_unavailable" }, 503);
  }
}
