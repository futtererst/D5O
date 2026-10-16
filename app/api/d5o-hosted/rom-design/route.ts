import { NextRequest, NextResponse } from "next/server";
import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const allowedWorkspaces = new Set(["rybex", "rotork"]);
const actions = new Set(["record-budget-ack", "authorize-design", "record-reconciliation"]);
type RpcError = { code?: string; message: string } | null;
function resultError(error: RpcError) {
  const status = error?.code === "42501" ? 403 : error?.code === "23505" || error?.code === "23514" ? 409 : error?.code === "22023" ? 400 : 503;
  return respond({ error: error?.message ?? "rom_design_unavailable" }, status);
}
function target(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  const workId = request.nextUrl.searchParams.get("workId") ?? "";
  return allowedWorkspaces.has(workspace) && /^[\w-]{8,120}$/.test(workId) ? { workspace, workId } : null;
}
export async function GET(request: NextRequest) {
  const selected = target(request);
  if (!selected) return respond({ error: "invalid_target" }, 400);
  if (!authoritativeD5OCommandsReady()) return respond({ error: "authoritative_runtime_unavailable" }, 503);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
  const { data, error } = await call("d5o_hosted_rom_design_read_v1", {
    p_workspace_key: selected.workspace, p_presentation_id: selected.workId
  });
  return error ? resultError(error) : respond(data);
}
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return respond({ error: "invalid_origin" }, 403);
  const selected = target(request);
  if (!selected) return respond({ error: "invalid_target" }, 400);
  if (!authoritativeD5OCommandsReady()) return respond({ error: "authoritative_runtime_unavailable" }, 503);
  const raw = await request.text();
  if (raw.length > 32_000) return respond({ error: "command_too_large" }, 413);
  let intent: Record<string, unknown>;
  try { intent = JSON.parse(raw) as Record<string, unknown>; } catch { return respond({ error: "invalid_json" }, 400); }
  if (!actions.has(String(intent.action)) || typeof intent.commandId !== "string" ||
    !Number.isInteger(intent.expectedSourceRevision) || !Number.isInteger(intent.expectedDecisionRevision) ||
    !Number.isInteger(intent.estimateRevision) || !Number.isInteger(intent.offerRevision) ||
    !intent.basis || typeof intent.basis !== "object" || Array.isArray(intent.basis))
    return respond({ error: "invalid_command" }, 400);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
  const { data, error } = await call("d5o_hosted_rom_design_command_v1", {
    p_workspace_key: selected.workspace, p_presentation_id: selected.workId,
    p_action: intent.action, p_basis: intent.basis, p_command_id: intent.commandId,
    p_expected_source_revision: intent.expectedSourceRevision,
    p_expected_decision_revision: intent.expectedDecisionRevision,
    p_estimate_revision: intent.estimateRevision, p_offer_revision: intent.offerRevision
  });
  return error ? resultError(error) : respond(data);
}
