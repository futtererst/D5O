import { NextRequest, NextResponse } from "next/server";
import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const actions = new Set(["prepare-authority", "approve-authority", "return-authority", "revoke-authority",
  "prepare-commitment", "approve-commitment", "return-commitment"]);
type RpcError = { code?: string; message: string } | null;
const errorResponse = (error: RpcError) => respond({ error: error?.message ?? "design_spend_unavailable" },
  error?.code === "42501" ? 403 : error?.code === "23505" || error?.code === "23514" ? 409 : error?.code === "22023" ? 400 : 503);
function target(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  const workId = request.nextUrl.searchParams.get("workId") ?? "";
  return ["rybex", "rotork"].includes(workspace) && /^[\w-]{8,120}$/.test(workId) ? { workspace, workId } : null;
}
export async function GET(request: NextRequest) {
  const selected = target(request);
  if (!selected) return respond({ error: "invalid_target" }, 400);
  if (!authoritativeD5OCommandsReady()) return respond({ error: "authoritative_runtime_unavailable" }, 503);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
  const { data, error } = await call("d5o_hosted_design_spend_read_v1", {
    p_workspace_key: selected.workspace, p_presentation_id: selected.workId
  });
  return error ? errorResponse(error) : respond(data);
}
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return respond({ error: "invalid_origin" }, 403);
  const selected = target(request);
  if (!selected) return respond({ error: "invalid_target" }, 400);
  if (!authoritativeD5OCommandsReady()) return respond({ error: "authoritative_runtime_unavailable" }, 503);
  const raw = await request.text();
  if (raw.length > 16_000) return respond({ error: "command_too_large" }, 413);
  let intent: Record<string, unknown>;
  try { intent = JSON.parse(raw) as Record<string, unknown>; } catch { return respond({ error: "invalid_json" }, 400); }
  if (!actions.has(String(intent.action)) || typeof intent.commandId !== "string"
    || !Number.isInteger(intent.expectedRevision) || typeof intent.expectedSourceDigest !== "string"
    || !intent.input || typeof intent.input !== "object" || Array.isArray(intent.input))
    return respond({ error: "invalid_command" }, 400);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
  const { data, error } = await call("d5o_hosted_design_spend_command_v1", {
    p_workspace_key: selected.workspace, p_presentation_id: selected.workId,
    p_action: intent.action as string, p_input: intent.input as Record<string, unknown>,
    p_command_id: intent.commandId, p_expected_revision: intent.expectedRevision as number,
    p_expected_source_digest: intent.expectedSourceDigest as string
  });
  return error ? errorResponse(error) : respond(data);
}

