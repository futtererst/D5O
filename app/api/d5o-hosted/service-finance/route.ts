import { NextRequest, NextResponse } from "next/server";
import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { hostedPrototypeContext } from "@/lib/d5o/hosted/prototype-context";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Rpc = (name: string, args: Record<string, unknown>) =>
  Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
const statusFor = (code?: string) =>
  code === "42501" ? 403 : code === "23503" ? 404 :
    code === "23505" || code === "23514" ? 409 : 400;

async function scoped(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!["rybex", "rotork"].includes(workspace) || !authoritativeD5OCommandsReady())
    return null;
  await hostedPrototypeContext(workspace);
  const session = await createRybexSupabaseServerClient();
  return { workspace, call: session.rpc.bind(session) as unknown as Rpc };
}

export async function GET(request: NextRequest) {
  try {
    const target = await scoped(request);
    const workId = request.nextUrl.searchParams.get("workId") ?? "";
    const requestId = request.nextUrl.searchParams.get("requestId") ?? "";
    if (!target || !workId || !requestId) return reply({ error: "service_finance_scope_missing" }, 400);
    const { data, error } = await target.call("d5o_hosted_service_finance_read_v1", {
      p_workspace_key: target.workspace, p_parent_presentation_id: workId,
      p_request_id: requestId
    });
    return error ? reply({ error: error.message }, statusFor(error.code)) : reply(data);
  } catch {
    return reply({ error: "service_finance_unavailable" }, 503);
  }
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  try {
    const target = await scoped(request);
    if (!target) return reply({ error: "service_finance_unavailable" }, 503);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (!["record-terms", "prepare", "review-ready", "review-hold"].includes(action) ||
      typeof body.workId !== "string" || typeof body.requestId !== "string" ||
      typeof body.commandId !== "string" || typeof body.basisDigest !== "string" ||
      !Number.isInteger(body.expectedWorkRevision) ||
      !Number.isInteger(body.expectedOperateRevision) ||
      !Number.isInteger(body.expectedDesignRevision) ||
      !Number.isInteger(body.expectedDeployRevision) ||
      !Number.isInteger(body.expectedFinanceRevision))
      return reply({ error: "invalid_service_finance_command" }, 400);
    if (action === "record-terms") {
      if (!Number.isInteger(body.expectedTermsRevision) ||
        typeof body.termsSourceDigest !== "string")
        return reply({ error: "invalid_service_billing_terms_command" }, 400);
      const recorded = await target.call("d5o_hosted_service_billing_terms_command_v1", {
        p_workspace_key: target.workspace,
        p_parent_presentation_id: body.workId,
        p_request_id: body.requestId,
        p_input: {
          evidenceId: body.evidenceId, billingBasis: body.billingBasis,
          billingTrigger: body.billingTrigger, paymentTerms: body.paymentTerms,
          customerParty: body.customerParty,
          customerOrganization: body.customerOrganization,
          customerRole: body.customerRole, authorityBasis: body.authorityBasis,
          note: body.note
        },
        p_command_id: body.commandId,
        p_expected_work_revision: body.expectedWorkRevision,
        p_expected_operate_revision: body.expectedOperateRevision,
        p_expected_design_revision: body.expectedDesignRevision,
        p_expected_deploy_revision: body.expectedDeployRevision,
        p_expected_terms_revision: body.expectedTermsRevision,
        p_expected_source_digest: body.termsSourceDigest
      });
      return recorded.error ? reply({ error: recorded.error.message }, statusFor(recorded.error.code)) : reply(recorded.data);
    }
    const { data, error } = await target.call("d5o_hosted_service_finance_command_v1", {
      p_workspace_key: target.workspace,
      p_parent_presentation_id: body.workId,
      p_request_id: body.requestId, p_action: action,
      p_input: {
        note: body.note, billingTermsEvidenceId: body.billingTermsEvidenceId,
        billingTermsStatement: body.billingTermsStatement
      },
      p_command_id: body.commandId,
      p_expected_work_revision: body.expectedWorkRevision,
      p_expected_operate_revision: body.expectedOperateRevision,
      p_expected_design_revision: body.expectedDesignRevision,
      p_expected_deploy_revision: body.expectedDeployRevision,
      p_expected_finance_revision: body.expectedFinanceRevision,
      p_expected_basis_digest: body.basisDigest
    });
    return error ? reply({ error: error.message }, statusFor(error.code)) : reply(data);
  } catch {
    return reply({ error: "service_finance_unavailable" }, 503);
  }
}
