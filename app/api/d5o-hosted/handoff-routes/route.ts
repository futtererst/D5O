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
    await admin(request.nextUrl.searchParams.get("workspace") ?? "");
    return reply({ error: "configuration_editor_required", next: "/work/admin/configuration?workspace=rybex" }, 410);
  } catch (error) { return error instanceof HostedStateError ? reply({ error: error.code }, error.status)
    : reply({ error: "handoff_route_unavailable" }, 503); }
}
