import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { hostedPrototypeContext, HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { customerAdminWorkspaceAllowed } from "@/lib/d5o/admin/customer-workspace";
import { customerWorkScope } from "@/lib/d5o/hosted/customer-work-scope";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const approvalWorkspaceAllowed = (workspace: string) => customerAdminWorkspaceAllowed(workspace)
  || (workspace !== "rotork" && /^[a-z][a-z0-9_-]{2,63}$/.test(workspace));
async function approvalScope(workspace: string) {
  if (workspace === "rybex" || workspace === "rotork") await hostedPrototypeContext(workspace);
  else await customerWorkScope(workspace);
}

export async function GET(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  const parentPresentationId = request.nextUrl.searchParams.get("parentPresentationId") ?? "";
  const requestId = request.nextUrl.searchParams.get("requestId") ?? "";
  if (!approvalWorkspaceAllowed(workspace) || !parentPresentationId
    || parentPresentationId.length > 160 || !requestId || requestId.length > 120)
    return reply({ error: "invalid_service_approval_read" }, 400);
  try {
    await approvalScope(workspace);
    const client = await createRybexSupabaseServerClient();
    const { data, error } = await (client.rpc as unknown as (name: string, args: Record<string, unknown>) =>
      Promise<{ data: unknown; error: { code?: string; message: string } | null }>)(
      "d5o_hosted_connected_service_approval_read_v1", {
        p_workspace_key: workspace, p_parent_presentation_id: parentPresentationId,
        p_request_id: requestId });
    if (error) return reply({ error: error.message }, error.code === "42501" ? 403
      : error.code === "23514" ? 409 : 503);
    return reply({ result: data });
  } catch (error) {
    return error instanceof HostedStateError ? reply({ error: error.code }, error.status)
      : reply({ error: "service_approval_unavailable" }, 503);
  }
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  try {
    const raw = await request.text();
    if (raw.length > 800) return reply({ error: "request_too_large" }, 413);
    const input = JSON.parse(raw) as { workspace?: string; workId?: string; action?: string;
      amountMinor?: number; currency?: string; commandId?: string;
      parentPresentationId?: string; requestId?: string };
    const connected = input.parentPresentationId !== undefined || input.requestId !== undefined;
    if (!input.workspace || !approvalWorkspaceAllowed(input.workspace)
      || (connected ? typeof input.parentPresentationId !== "string"
        || input.parentPresentationId.length < 1 || input.parentPresentationId.length > 160
        || typeof input.requestId !== "string" || input.requestId.length < 1
        || input.requestId.length > 120 : !/^[0-9a-f-]{36}$/i.test(input.workId ?? ""))
      || !["request", "approve", "reject"].includes(input.action ?? "")
      || (!connected && (!Number.isSafeInteger(input.amountMinor)
        || (input.amountMinor ?? -1) < 0 || input.currency !== "USD"))
      || typeof input.commandId !== "string"
      || input.commandId.length < 8 || input.commandId.length > 120)
      return reply({ error: "invalid_service_approval_command" }, 400);
    await approvalScope(input.workspace);
    const client = await createRybexSupabaseServerClient();
    const { data, error } = await (client.rpc as unknown as (name: string, args: Record<string, unknown>) =>
      Promise<{ data: unknown; error: { code?: string; message: string } | null }>)(
      connected ? "d5o_hosted_connected_service_approval_command_v1"
        : "d5o_hosted_service_approval_command_v1",
      connected ? { p_workspace_key: input.workspace,
        p_parent_presentation_id: input.parentPresentationId, p_request_id: input.requestId,
        p_action: input.action, p_command_id: input.commandId }
        : { p_workspace_key: input.workspace, p_work_id: input.workId,
          p_action: input.action, p_amount_minor: input.amountMinor,
          p_currency: input.currency, p_command_id: input.commandId });
    if (error) return reply({ error: error.message }, error.code === "42501" ? 403
      : error.code === "22023" ? 400 : error.code === "23505" || error.code === "23514" ? 409 : 503);
    return reply({ result: data });
  } catch (error) {
    return error instanceof HostedStateError ? reply({ error: error.code }, error.status)
      : error instanceof SyntaxError ? reply({ error: "invalid_request" }, 400)
        : reply({ error: "service_approval_unavailable" }, 503);
  }
}
