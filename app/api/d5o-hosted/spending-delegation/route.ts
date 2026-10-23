import { NextRequest, NextResponse } from "next/server";
import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
type RpcError = { code?: string; message: string } | null;
const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const failure = (error: RpcError) => respond({ error: error?.message ?? "spending_delegation_unavailable" },
  error?.code === "42501" ? 403 : ["23505", "23514"].includes(error?.code ?? "") ? 409 : error?.code === "22023" ? 400 : 503);
const workspaceOf = (request: NextRequest) => {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  return ["rybex", "rotork"].includes(workspace) ? workspace : null;
};
export async function GET(request: NextRequest) {
  const workspace = workspaceOf(request);
  if (!workspace) return respond({ error: "invalid_workspace" }, 400);
  if (!authoritativeD5OCommandsReady()) return respond({ error: "authoritative_runtime_unavailable" }, 503);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
  const { data, error } = await call("d5o_spending_delegate_read_v1", { p_workspace_key: workspace });
  return error ? failure(error) : respond(data);
}
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return respond({ error: "invalid_origin" }, 403);
  const workspace = workspaceOf(request);
  if (!workspace) return respond({ error: "invalid_workspace" }, 400);
  if (!authoritativeD5OCommandsReady()) return respond({ error: "authoritative_runtime_unavailable" }, 503);
  const raw = await request.text();
  if (raw.length > 8_000) return respond({ error: "command_too_large" }, 413);
  let intent: Record<string, unknown>;
  try { intent = JSON.parse(raw) as Record<string, unknown>; } catch { return respond({ error: "invalid_json" }, 400); }
  if (!["add", "revoke"].includes(String(intent.action)) || typeof intent.commandId !== "string"
    || !Number.isInteger(intent.expectedRevision) || !intent.input || typeof intent.input !== "object" || Array.isArray(intent.input))
    return respond({ error: "invalid_command" }, 400);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
  const { data, error } = await call("d5o_spending_delegate_command_v1", {
    p_workspace_key: workspace, p_action: String(intent.action), p_input: intent.input as Record<string, unknown>,
    p_command_id: intent.commandId, p_expected_revision: intent.expectedRevision as number
  });
  return error ? failure(error) : respond(data);
}
