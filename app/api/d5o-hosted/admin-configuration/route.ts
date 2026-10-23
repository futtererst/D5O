import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { hostedPrototypeContext, HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { customerAdminWorkspaceAllowed } from "@/lib/d5o/admin/customer-workspace";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Rpc = { data: unknown; error: { code?: string; message: string } | null };
const errorStatus = (error: Rpc["error"]) => error?.code === "42501" ? 403
  : error?.code === "23505" || error?.code === "23514" ? 409
    : error?.code === "22023" ? 400 : 503;
async function admin(workspace: string) {
  if (!customerAdminWorkspaceAllowed(workspace)) throw new HostedStateError("invalid_workspace", 400);
  const context = await hostedPrototypeContext(workspace);
  if (context.actor.role !== "admin") throw new HostedStateError("admin_membership_required", 403);
}
export async function GET(request: NextRequest) {
  try {
    const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
    await admin(workspace);
    const client = await createRybexSupabaseServerClient();
    const rpc = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<Rpc>;
    const { data, error } = await rpc("d5o_hosted_configuration_admin_read_v1", { p_workspace_key: workspace });
    if (error) return reply({ error: error.message }, errorStatus(error));
    const history = await rpc("d5o_hosted_configuration_history_v1", { p_workspace_key: workspace });
    return history.error ? reply({ error: history.error.message }, errorStatus(history.error))
      : reply({ ...(data as Record<string, unknown>), history: history.data });
  } catch (error) { return error instanceof HostedStateError ? reply({ error: error.code }, error.status)
    : reply({ error: "configuration_unavailable" }, 503); }
}
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  try {
    const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
    await admin(workspace);
    const raw = await request.text();
    if (raw.length > 3200) return reply({ error: "request_too_large" }, 413);
    const input = JSON.parse(raw) as { action?: string; version?: string; expectedActive?: string;
      expectedRevision?: number; data?: Record<string, unknown>; reason?: string; commandId?: string };
    if (!["create-draft", "save-policy", "save-route", "create-work-type", "rename-work-type", "retire-work-type",
      "set-create-role", "validate-publish", "activate"].includes(input.action ?? "")
      || !/^[0-9a-f-]{36}$/i.test(input.version ?? "")
      || !/^[0-9a-f-]{36}$/i.test(input.expectedActive ?? "")
      || !Number.isInteger(input.expectedRevision) || (input.expectedRevision ?? -1) < 0
      || !input.data || typeof input.data !== "object" || Array.isArray(input.data)
      || typeof input.reason !== "string" || input.reason.trim().length < 8 || input.reason.length > 500
      || typeof input.commandId !== "string" || input.commandId.length < 8 || input.commandId.length > 120)
      return reply({ error: "invalid_configuration_command" }, 400);
    const client = await createRybexSupabaseServerClient();
    const { data, error } = await (client.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<Rpc>)(
      "d5o_hosted_configuration_admin_command_v1", {
        p_workspace_key: workspace, p_action: input.action, p_version: input.version,
        p_expected_active: input.expectedActive, p_expected_revision: input.expectedRevision,
        p_input: input.data, p_reason: input.reason, p_command_id: input.commandId,
      });
    return error ? reply({ error: error.message }, errorStatus(error)) : reply({ result: data });
  } catch (error) { return error instanceof HostedStateError ? reply({ error: error.code }, error.status)
    : error instanceof SyntaxError ? reply({ error: "invalid_request" }, 400)
      : reply({ error: "configuration_unavailable" }, 503); }
}
