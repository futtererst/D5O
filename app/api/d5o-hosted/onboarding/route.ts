import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!/^[a-z][a-z0-9_-]{2,63}$/.test(workspace)) return reply({ error: "invalid_workspace" }, 400);
  const client = await createRybexSupabaseServerClient();
  const { data, error } = await (client.rpc as unknown as (name: string, args: Record<string, unknown>) =>
    Promise<RpcResult>)("d5o_hosted_onboarding_read_v1", { p_workspace_key: workspace });
  return error ? reply({ error: error.message }, error.code === "42501" ? 403 : 409) : reply(data);
}
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  let input: { workspace?: string; expectedRevision?: number; commandId?: string; reason?: string };
  try { input = await request.json(); } catch { return reply({ error: "invalid_request" }, 400); }
  if (!input.workspace || !Number.isInteger(input.expectedRevision) || !input.commandId || !input.reason)
    return reply({ error: "invalid_request" }, 400);
  const client = await createRybexSupabaseServerClient();
  const { data, error } = await (client.rpc as unknown as (name: string, args: Record<string, unknown>) =>
    Promise<RpcResult>)("d5o_hosted_onboarding_ready_v1", {
      p_workspace_key: input.workspace, p_expected_revision: input.expectedRevision,
      p_command_id: input.commandId, p_reason: input.reason });
  return error ? reply({ error: error.message }, error.code === "42501" ? 403 : 409) : reply({ result: data });
}
