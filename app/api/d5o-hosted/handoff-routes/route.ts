import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { hostedPrototypeContext, HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
const failure = (error: RpcResult["error"]) => reply({ error: error?.message ?? "handoff_route_unavailable" },
  error?.code === "42501" ? 403 : error?.code === "23505" || error?.code === "23514" ? 409 : error?.code === "22023" ? 400 : 503);
async function admin(workspace: string) {
  if (!["rybex", "rotork"].includes(workspace)) throw new HostedStateError("invalid_workspace", 400);
  const context = await hostedPrototypeContext(workspace);
  if (context.actor.role !== "admin") throw new HostedStateError("admin_membership_required", 403);
}
export async function GET(request: NextRequest) {
  try {
    const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
    await admin(workspace);
    const client = await createRybexSupabaseServerClient();
    const { data, error } = await (client.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<RpcResult>)("d5o_hosted_handoff_configuration_v1", { p_workspace_key: workspace });
    return error ? failure(error) : reply(data);
  } catch (error) { return error instanceof HostedStateError ? reply({ error: error.code }, error.status) : reply({ error: "handoff_route_unavailable" }, 503); }
}
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  try {
    const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
    await admin(workspace);
    const raw = await request.text();
    if (raw.length > 1200) return reply({ error: "request_too_large" }, 413);
    const input = JSON.parse(raw) as { action?: string; version?: string; key?: string; role?: string; expectedRevision?: number; commandId?: string };
    if (!/^[0-9a-f-]{36}$/i.test(input.version ?? "")
      || !["create-draft", "save-route", "publish", "activate"].includes(input.action ?? "")
      || (input.action === "save-route" && (!["discoverDefine", "designDeploy", "deployOperate"].includes(input.key ?? "")
        || !["admin", "operations_leader", "project_manager"].includes(input.role ?? "")))
      || !Number.isInteger(input.expectedRevision)
      || !input.commandId || input.commandId.length < 8 || input.commandId.length > 120) return reply({ error: "invalid_route" }, 400);
    const client = await createRybexSupabaseServerClient();
    const { data, error } = await (client.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<RpcResult>)("d5o_hosted_handoff_configuration_command_v1", {
      p_workspace_key: workspace, p_action: input.action, p_version: input.version,
      p_route: input.key ?? null, p_role: input.role ?? null,
      p_expected_revision: input.expectedRevision, p_command_id: input.commandId
    });
    return error ? failure(error) : reply({ result: data });
  } catch (error) { return error instanceof HostedStateError ? reply({ error: error.code }, error.status)
    : error instanceof SyntaxError ? reply({ error: "invalid_request" }, 400) : reply({ error: "handoff_route_unavailable" }, 503); }
}
