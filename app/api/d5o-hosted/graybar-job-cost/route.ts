import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const target = (request: NextRequest) => {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  const workId = request.nextUrl.searchParams.get("workId") ?? "";
  return ["rybex", "rotork"].includes(workspace) && /^[\w-]{8,120}$/.test(workId) ? { workspace, workId } : null;
};
type DbError = { code?: string; message: string } | null;
const failure = (error: DbError) => reply({ error: error?.message ?? "supplier_cost_unavailable" },
  error?.code === "42501" ? 403 : ["23505", "23514"].includes(error?.code ?? "") ? 409 : 400);

export async function GET(request: NextRequest) {
  const selected = target(request);
  if (!selected) return reply({ error: "invalid_target" }, 400);
  if (!authoritativeD5OCommandsReady()) return reply({ error: "authoritative_runtime_unavailable" }, 503);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: DbError }>;
  const { data, error } = await call("d5o_graybar_job_cost_read_v1", { p_workspace_key: selected.workspace, p_presentation_id: selected.workId });
  return error ? failure(error) : reply(data);
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const selected = target(request);
  if (!selected) return reply({ error: "invalid_target" }, 400);
  if (!authoritativeD5OCommandsReady()) return reply({ error: "authoritative_runtime_unavailable" }, 503);
  const raw = await request.text();
  if (raw.length > 8_000) return reply({ error: "command_too_large" }, 413);
  let intent: { action?: string; input?: Record<string, unknown>; commandId?: string; graybarRevision?: number; financeRevision?: number };
  try { intent = JSON.parse(raw); } catch { return reply({ error: "invalid_json" }, 400); }
  if (!["post-commitment", "post-matched-invoice"].includes(intent.action ?? "") || !intent.input ||
    typeof intent.commandId !== "string" || !Number.isInteger(intent.graybarRevision) || !Number.isInteger(intent.financeRevision))
    return reply({ error: "invalid_command" }, 400);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: DbError }>;
  const { data, error } = await call("d5o_graybar_job_cost_command_v1", { p_workspace_key: selected.workspace,
    p_presentation_id: selected.workId, p_action: intent.action, p_input: intent.input,
    p_command_id: intent.commandId, p_graybar_revision: intent.graybarRevision, p_finance_revision: intent.financeRevision });
  return error ? failure(error) : reply(data);
}
