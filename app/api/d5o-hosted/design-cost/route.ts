import { NextRequest, NextResponse } from "next/server";
import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status,
  headers: { "Cache-Control": "no-store" } });
const actions = new Set(["link-commitment", "prepare-cost", "prepare-rated-cost", "review-cost",
  "prepare-assessment", "review-assessment", "set-work-forecast"]);
type DbResult = { data: unknown; error: { code?: string; message: string } | null };
function target(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  const workId = request.nextUrl.searchParams.get("workId") ?? "";
  return ["rybex", "rotork"].includes(workspace) && /^[\w-]{8,120}$/.test(workId)
    ? { workspace, workId } : null;
}
function failure(error: DbResult["error"]) {
  return reply({ error: error?.message ?? "design_cost_unavailable" },
    error?.code === "42501" ? 403 : ["23505", "23514"].includes(error?.code ?? "") ? 409 :
      error?.code === "22023" ? 400 : 503);
}
export async function GET(request: NextRequest) {
  const selected = target(request);
  if (!selected) return reply({ error: "invalid_target" }, 400);
  if (!authoritativeD5OCommandsReady()) return reply({ error: "authoritative_runtime_unavailable" }, 503);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<DbResult>;
  const { data, error } = await call("d5o_hosted_design_cost_read_v1", {
    p_workspace_key: selected.workspace, p_presentation_id: selected.workId
  });
  return error ? failure(error) : reply(data);
}
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const selected = target(request);
  if (!selected) return reply({ error: "invalid_target" }, 400);
  if (!authoritativeD5OCommandsReady()) return reply({ error: "authoritative_runtime_unavailable" }, 503);
  const raw = await request.text();
  if (raw.length > 16_000) return reply({ error: "command_too_large" }, 413);
  let command: Record<string, unknown>;
  try { command = JSON.parse(raw) as Record<string, unknown>; } catch { return reply({ error: "invalid_json" }, 400); }
  if (!actions.has(String(command.action)) || typeof command.commandId !== "string"
    || !Number.isInteger(command.expectedRevision) || typeof command.expectedSourceDigest !== "string"
    || !command.input || typeof command.input !== "object" || Array.isArray(command.input))
    return reply({ error: "invalid_command" }, 400);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<DbResult>;
  const { data, error } = await call("d5o_hosted_design_cost_command_v1", {
    p_workspace_key: selected.workspace, p_presentation_id: selected.workId,
    p_action: command.action, p_input: command.input,
    p_command_id: command.commandId, p_expected_revision: command.expectedRevision,
    p_expected_source_digest: command.expectedSourceDigest
  });
  return error ? failure(error) : reply(data);
}
