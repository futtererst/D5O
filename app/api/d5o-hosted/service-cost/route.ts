import { NextRequest, NextResponse } from "next/server";
import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { hostedPrototypeContext } from "@/lib/d5o/hosted/prototype-context";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
const statusFor = (code?: string) => code === "42501" ? 403 : code === "23503" ? 404 : code === "23505" || code === "23514" ? 409 : 400;
async function scoped(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!["rybex", "rotork"].includes(workspace) || !authoritativeD5OCommandsReady()) return null;
  await hostedPrototypeContext(workspace);
  const session = await createRybexSupabaseServerClient();
  return { workspace, call: session.rpc.bind(session) as unknown as Rpc };
}
export async function GET(request: NextRequest) {
  try {
    const target = await scoped(request);
    const workId = request.nextUrl.searchParams.get("workId") ?? "";
    const requestId = request.nextUrl.searchParams.get("requestId") ?? "";
    if (!target || !workId || !requestId) return reply({ error: "service_cost_scope_missing" }, 400);
    const { data, error } = await target.call("d5o_hosted_service_cost_read_v1", { p_workspace_key: target.workspace, p_parent_presentation_id: workId, p_request_id: requestId });
    return error ? reply({ error: error.message }, statusFor(error.code)) : reply(data);
  } catch { return reply({ error: "service_cost_unavailable" }, 503); }
}
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  try {
    const target = await scoped(request);
    if (!target) return reply({ error: "service_cost_unavailable" }, 503);
    const body = await request.json() as Record<string, unknown>;
    if (!["record-cost", "correct-cost"].includes(String(body.action)) || typeof body.workId !== "string" || typeof body.requestId !== "string" || typeof body.commandId !== "string" || !Number.isInteger(body.expectedRevision)) return reply({ error: "invalid_service_cost_command" }, 400);
    const { data, error } = await target.call("d5o_hosted_service_cost_command_v1", {
      p_workspace_key: target.workspace, p_parent_presentation_id: body.workId, p_request_id: body.requestId,
      p_action: body.action, p_input: { originalId: body.originalId, amountMinor: body.amountMinor,
        currency: body.currency, category: body.category, allocation: body.allocation,
        incurredDate: body.incurredDate, source: body.source, rationale: body.rationale },
      p_command_id: body.commandId, p_expected_revision: body.expectedRevision,
      p_expected_work_revision: body.expectedWorkRevision, p_expected_operate_revision: body.expectedOperateRevision,
      p_expected_cycle: body.requestCycleAt, p_expected_child_work_id: body.childWorkId,
      p_expected_source_digest: body.sourceDigest
    });
    return error ? reply({ error: error.message }, statusFor(error.code)) : reply(data);
  } catch { return reply({ error: "service_cost_unavailable" }, 503); }
}
