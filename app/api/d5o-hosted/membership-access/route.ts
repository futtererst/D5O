import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseAdminClient } from "@/lib/d5o/auth/supabase-server";
import { hostedPrototypeContext, HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const roles = new Set(["executive", "operations_leader", "business_development_lead", "project_manager", "billing_commercial_lead", "field_supervisor", "closeout_lead", "read_only_auditor"]);
type RpcError = { code?: string; message?: string } | null;
type RpcResult = { data: unknown; error: RpcError };
type MembershipRpc = "d5o_hosted_membership_access_v1" | "d5o_hosted_admin_membership_change_v1" | "d5o_hosted_admin_succession_v1";
const callMembership = (client: ReturnType<typeof createRybexSupabaseAdminClient>, name: MembershipRpc, args: Record<string, unknown>) =>
  (client.rpc.bind(client) as unknown as (name: MembershipRpc, args: Record<string, unknown>) => Promise<RpcResult>)(name, args);
const failure = (error: RpcError) => error?.message === "protected_membership" ? reply({ error: "protected_membership", message: "Administrator and worker access use separate protected controls." }, 403)
  : error?.code === "42501" ? reply({ error: "admin_membership_required" }, 403)
  : error?.code === "23503" ? reply({ error: "confirmed_member_missing", message: "Create and confirm the sign-in account before assigning a role." }, 409)
  : error?.code === "23505" ? reply({ error: "stale_or_conflicting_assignment" }, 409)
  : error?.code === "22023" ? reply({ error: "invalid_assignment" }, 400)
  : reply({ error: "membership_access_unavailable" }, 503);

async function admin(workspace: string) {
  if (!(["rybex", "rotork"] as string[]).includes(workspace)) throw new HostedStateError("invalid_workspace", 400);
  const context = await hostedPrototypeContext(workspace);
  if (context.actor.role !== "admin") throw new HostedStateError("admin_membership_required", 403);
  return context;
}

export async function GET(request: NextRequest) {
  try {
    const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
    const context = await admin(workspace);
    const client = createRybexSupabaseAdminClient();
    const result = await callMembership(client, "d5o_hosted_membership_access_v1", {
      p_workspace_key: workspace, p_admin_user_id: context.actor.id, p_admin_membership_id: context.actor.membershipId
    });
    if (result.error) return failure(result.error);
    return reply({ members: result.data, synthetic: true });
  } catch (error) { return error instanceof HostedStateError ? reply({ error: error.code }, error.status) : reply({ error: "membership_access_unavailable" }, 503); }
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  try {
    const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
    const context = await admin(workspace);
    const raw = await request.text();
    if (raw.length > 1500) return reply({ error: "request_too_large" }, 413);
    const input = JSON.parse(raw) as { action?: string; email?: string; role?: string; expectedRole?: string | null;
      expectedStatus?: string | null; reason?: string; commandId?: string };
    const email = input.email?.trim().toLowerCase() ?? "";
    const suspend = input.action === "suspend";
    const succession = input.action === "succession";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      (!succession && (suspend ? !roles.has(input.expectedRole ?? "") : !roles.has(input.role ?? ""))) ||
      (input.action && input.action !== "assign" && !suspend && !succession) ||
      !input.reason || input.reason.trim().length < (succession ? 12 : 8) || input.reason.length > 500 ||
      (!succession && input.expectedStatus != null && input.expectedStatus !== "active" && input.expectedStatus !== "suspended") ||
      !input.commandId || input.commandId.length < 8 || input.commandId.length > 120)
      return reply({ error: "invalid_assignment" }, 400);
    const client = createRybexSupabaseAdminClient();
    const basis = { p_workspace_key: workspace, p_admin_user_id: context.actor.id,
      p_admin_membership_id: context.actor.membershipId, p_command_id: input.commandId };
    const result = succession
      ? await callMembership(client, "d5o_hosted_admin_succession_v1", { ...basis,
          p_target_email: email, p_reason: input.reason.trim() })
      : await callMembership(client, "d5o_hosted_admin_membership_change_v1", { ...basis,
          p_member_email: email, p_action: suspend ? "suspend" : "assign", p_role: input.role ?? null,
          p_expected_role: input.expectedRole ?? null, p_expected_status: input.expectedStatus ?? null,
          p_reason: input.reason.trim() });
    if (result.error) return failure(result.error);
    return reply({ assignment: result.data, synthetic: true });
  } catch (error) { return error instanceof HostedStateError ? reply({ error: error.code }, error.status) : error instanceof SyntaxError ? reply({ error: "invalid_request" }, 400) : reply({ error: "membership_access_unavailable" }, 503); }
}
