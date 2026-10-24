import { NextRequest, NextResponse } from "next/server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { customerWorkScope, type CustomerRpcError } from "@/lib/d5o/hosted/customer-work-scope";
import { HostedStateError } from "@/lib/d5o/hosted/prototype-context";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body,
  { status, headers: { "Cache-Control": "no-store" } });
const statusFor = (error: CustomerRpcError) => error.code === "42501" ? 403
  : error.code === "23505" ? 409 : ["23514", "22023"].includes(error.code ?? "") ? 422 : 503;
type Work = { id: string; workspace?: string; canonicalWorkId?: string };
async function scope(workspace: string, workId: string) {
  const result = await customerWorkScope(workspace);
  const source = await result.context.read("work");
  const work = (Array.isArray(source.state?.records) ? source.state.records as Work[] : [])
    .find((item) => item.id === workId && item.workspace === workspace && item.canonicalWorkId);
  if (!work) throw new HostedStateError("work_unavailable", 404);
  return result;
}
const readName = { purchase: "d5o_purchase_authority_read_v1",
  labor: "d5o_labor_authority_read_v1" } as const;
const commandName = { purchase: "d5o_purchase_authority_command_v1",
  labor: "d5o_labor_authority_command_v1" } as const;
export async function GET(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  const workId = request.nextUrl.searchParams.get("workId") ?? "";
  try {
    const { context, call } = await scope(workspace, workId);
    if (!["admin", "project_manager", "operations_leader"].includes(context.actor.role))
      return reply({ error: "authority_role_denied" }, 403);
    const [purchase, labor] = await Promise.all(Object.values(readName).map((name) =>
      call(name, { p_workspace_key: workspace, p_presentation_id: workId })));
    if (purchase.error) return reply({ error: purchase.error.message }, statusFor(purchase.error));
    if (labor.error) return reply({ error: labor.error.message }, statusFor(labor.error));
    return reply({ role: context.actor.role, purchase: purchase.data, labor: labor.data });
  } catch (error) {
    if (error instanceof HostedStateError) return reply({ error: error.code }, error.status);
    return reply({ error: "authority_unavailable" }, 503);
  }
}
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  let body: { workId?: string; kind?: "purchase" | "labor"; action?: string;
    commandId?: string; revision?: number; sourceDigest?: string; input?: Record<string, unknown> };
  try { const raw = await request.text(); if (raw.length > 16000) return reply({ error: "command_too_large" }, 413);
    body = JSON.parse(raw) as typeof body; }
  catch { return reply({ error: "invalid_command" }, 400); }
  if (!body || !body.workId || !body.kind || !commandName[body.kind]
    || !["prepare", "approve"].includes(body.action ?? "")
    || !/^[0-9a-f-]{36}$/i.test(body.commandId ?? "")
    || !Number.isInteger(body.revision) || typeof body.sourceDigest !== "string"
    || !body.input || typeof body.input !== "object" || Array.isArray(body.input))
    return reply({ error: "invalid_command" }, 400);
  const allowed = body.action === "approve" ? ["authorityId", "reason"]
    : body.kind === "purchase" ? ["parentCapMinor", "purchaseCapMinor", "subcontractEnabled",
      "validFrom", "validUntil", "purchasingEntity", "graybarAccountReference", "scope",
      "fundingSource", "sourceReference", "conditions"]
      : ["capMinor", "rateMinor", "rateVersion", "rateSource", "rateBasis", "scope",
        "conditions", "validFrom", "validUntil"];
  if (Object.keys(body.input).some((key) => !allowed.includes(key)))
    return reply({ error: "invalid_authority_input" }, 400);
  try {
    const { context, call } = await scope(workspace, body.workId);
    if (body.action === "prepare" ? context.actor.role !== "project_manager"
      : context.actor.role !== "admin") return reply({ error: "authority_role_denied" }, 403);
    const result = await call(commandName[body.kind], {
      p_workspace_key: workspace, p_presentation_id: body.workId, p_action: body.action,
      p_input: body.input, p_command_id: body.commandId,
      p_expected_revision: body.revision, p_expected_source_digest: body.sourceDigest });
    if (result.error) return reply({ error: result.error.message }, statusFor(result.error));
    return reply({ kind: body.kind, action: body.action, result: result.data });
  } catch (error) {
    if (error instanceof HostedStateError) return reply({ error: error.code }, error.status);
    return reply({ error: "authority_action_unavailable" }, 503);
  }
}
