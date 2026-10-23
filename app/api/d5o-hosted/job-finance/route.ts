import { NextRequest, NextResponse } from "next/server";
import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
const reply = (value: unknown, status = 200) => NextResponse.json(value, {
  status, headers: { "Cache-Control": "no-store" }
});
type DbResult = { data: unknown; error: { code?: string; message: string } | null };
const actions = new Set(["add-cost", "set-remaining", "draft-bill", "submit-bill",
  "review-bill", "revise-bill", "return-unbilled", "record-billed", "record-paid"]);
const validId = (value: unknown) => typeof value === "string" && value.length >= 2 && value.length <= 120;
export async function GET(request: NextRequest) {
  if (!authoritativeD5OCommandsReady()) return reply({ error: "finance_unavailable" }, 503);
  const workspace = request.nextUrl.searchParams.get("workspace");
  const workId = request.nextUrl.searchParams.get("workId");
  if (workspace !== "rybex" || !validId(workId)) return reply({ error: "invalid_target" }, 400);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<DbResult>;
  const { data, error } = await call("d5o_hosted_job_finance_read_v1", {
    p_workspace_key: workspace, p_presentation_id: workId
  });
  if (error) return reply({ error: error.message }, error.code === "42501" ? 403 : 503);
  return reply(data);
}
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  if (!authoritativeD5OCommandsReady()) return reply({ error: "finance_unavailable" }, 503);
  const raw = await request.text(); if (raw.length > 16000) return reply({ error: "request_too_large" }, 413);
  let input: { workspace?: string; workId?: string; action?: string;
    data?: Record<string, unknown>; commandId?: string; expectedRevision?: number };
  try { input = JSON.parse(raw); } catch { return reply({ error: "invalid_request" }, 400); }
  if (input.workspace !== "rybex" || !validId(input.workId) || !actions.has(input.action ?? "")
    || !input.data || !validId(input.commandId) || !Number.isInteger(input.expectedRevision))
    return reply({ error: "invalid_command" }, 400);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<DbResult>;
  const { data, error } = await call("d5o_hosted_job_finance_command_v1", {
    p_workspace_key: input.workspace, p_presentation_id: input.workId,
    p_action: input.action, p_input: input.data, p_command_id: input.commandId,
    p_expected_revision: input.expectedRevision
  });
  if (error) return reply({ error: error.message },
    error.code === "42501" ? 403 : ["23505", "23514"].includes(error.code ?? "") ? 409 : 400);
  return reply(data);
}
