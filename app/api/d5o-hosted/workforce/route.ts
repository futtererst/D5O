import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { customerWorkspaceKey } from "@/lib/d5o/hosted/customer-work-scope";

export const dynamic = "force-dynamic";
const reply = (value: unknown, status = 200) => NextResponse.json(value, {
  status, headers: { "Cache-Control": "no-store" }
});
const allowed = new Set(["save-person", "bind-person", "set-active", "correct-binding"]);
const validWorkspace = (value: unknown): value is string => typeof value === "string" &&
  (value === "rybex" || customerWorkspaceKey.test(value) && value !== "rotork");
type DbResult = { data: unknown; error: { code?: string; message: string } | null };

export async function GET(request: NextRequest) {
  if (!authoritativeD5OCommandsReady()) return reply({ error: "workforce_unavailable" }, 503);
  const workspace = request.nextUrl.searchParams.get("workspace");
  if (!validWorkspace(workspace)) return reply({ error: "invalid_workspace" }, 400);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<DbResult>;
  const { data, error } = await call("d5o_hosted_workforce_read_v1", { p_workspace_key: workspace });
  if (error) return reply({ error: error.message }, error.code === "42501" ? 403 : 503);
  return reply(data);
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  if (!authoritativeD5OCommandsReady()) return reply({ error: "workforce_unavailable" }, 503);
  const raw = await request.text();
  if (raw.length > 12000) return reply({ error: "request_too_large" }, 413);
  let input: { workspace?: string; action?: string; data?: Record<string, unknown>; commandId?: string; expectedRevision?: number; expectedScheduleRevision?: number | null };
  try { input = JSON.parse(raw); } catch { return reply({ error: "invalid_request" }, 400); }
  if (!validWorkspace(input.workspace) || !allowed.has(input.action ?? "") ||
    !input.data || typeof input.commandId !== "string" ||
    !Number.isInteger(input.expectedRevision)) return reply({ error: "invalid_command" }, 400);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<DbResult>;
  if (input.expectedScheduleRevision != null && !Number.isInteger(input.expectedScheduleRevision))
    return reply({ error: "invalid_schedule_revision" }, 400);
  const { data, error } = await call("d5o_hosted_workforce_impact_command_v1", {
    p_workspace_key: input.workspace, p_action: input.action, p_input: input.data,
    p_command_id: input.commandId, p_expected_revision: input.expectedRevision,
    p_expected_schedule_revision: input.expectedScheduleRevision ?? null
  });
  if (error) return reply({ error: error.message },
    error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409 : 400);
  return reply(data);
}
