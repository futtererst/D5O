import { NextRequest, NextResponse } from "next/server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { customerWorkScope, type CustomerRpcError } from "@/lib/d5o/hosted/customer-work-scope";
import { HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { designActionRole, designCommandFor, isCustomerDesignAction } from "@/lib/d5o/hosted/customer-design-contract";

export const dynamic = "force-dynamic";
const reply = (value: unknown, status = 200) => NextResponse.json(value,
  { status, headers: { "Cache-Control": "no-store" } });
const statusFor = (error: CustomerRpcError) => error.code === "42501" ? 403
  : error.code === "23505" ? 409 : ["23514", "22023"].includes(error.code ?? "") ? 422 : 503;
type Body = { workId?: string; action?: string; commandId?: string;
  sourceRevision?: number; designRevision?: number; catalogRevision?: number;
  packageCount?: number; handoffRevision?: number; input?: Record<string, unknown> };
type Work = { id: string; workspace?: string; canonicalWorkId?: string;
  discovery?: { designHandoff?: { status?: string; revision?: number } };
  design?: { authorityRevision?: number } };

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  let body: Body;
  try {
    const raw = await request.text();
    if (raw.length > 30000) return reply({ error: "command_too_large" }, 413);
    body = JSON.parse(raw) as Body;
  } catch { return reply({ error: "invalid_command" }, 400); }
  if (!body || !isCustomerDesignAction(body.action) || !body.workId
    || !/^[0-9a-f-]{36}$/i.test(body.commandId ?? "")
    || !Number.isInteger(body.sourceRevision) || !Number.isInteger(body.designRevision)
    || !body.input || typeof body.input !== "object" || Array.isArray(body.input))
    return reply({ error: "invalid_command" }, 400);
  try {
    const { context, call } = await customerWorkScope(workspace);
    if (!designActionRole(body.action, context.actor.role)) return reply({ error: "design_role_denied" }, 403);
    const loaded = await context.read("work");
    const records = Array.isArray(loaded.state?.records) ? loaded.state.records as Work[] : [];
    const record = records.find((work) => work.id === body.workId && work.workspace === workspace
      && work.canonicalWorkId);
    if (!record) return reply({ error: "work_unavailable" }, 404);
    // Hosted commands compare revisions inside the same transaction and check
    // idempotency receipts first. Prechecking here would reject a safe replay.
    if (record.discovery?.designHandoff?.status !== "accepted")
      return reply({ error: "design_handoff_required" }, 409);
    const basis = { p_workspace_key: workspace, p_presentation_id: body.workId,
      p_command_id: body.commandId };
    let args: Record<string, unknown>;
    if (body.action === "create-package") {
      if (!Number.isInteger(body.catalogRevision) || !Number.isInteger(body.packageCount)
        || body.handoffRevision !== record.discovery.designHandoff.revision)
        return reply({ error: "invalid_package_basis" }, 400);
      args = { ...basis, p_name: body.input.name, p_owner: body.input.owner,
        p_expected_work_revision: body.sourceRevision, p_expected_catalog_revision: body.catalogRevision,
        p_expected_handoff_revision: body.handoffRevision,
        p_expected_package_count: body.packageCount };
    } else {
      args = { ...basis, p_expected_source_revision: body.sourceRevision,
        p_expected_decision_revision: body.designRevision };
      if (body.action === "save-demand") args.p_demand = body.input;
      else { args.p_action = body.action; args.p_input = body.input; }
    }
    const result = await call(designCommandFor(body.action), args);
    if (result.error) return reply({ error: result.error.message }, statusFor(result.error));
    return reply({ action: body.action, result: result.data });
  } catch (error) {
    if (error instanceof HostedStateError) return reply({ error: error.code }, error.status);
    return reply({ error: "design_action_unavailable" }, 503);
  }
}
