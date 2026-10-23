import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseAdminClient, createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { hostedPrototypeContext, HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { customerAdminWorkspaceAllowed } from "@/lib/d5o/admin/customer-workspace";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { isApprovedTestRecipient } from "@/lib/d5o/auth/approved-test-recipient";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
const failure = (error: RpcResult["error"]) => reply({ error: error?.message ?? "org_command_unavailable" },
  error?.code === "42501" ? 403 : error?.code === "22023" ? 400 :
    ["23503", "23505", "23514", "23502", "23516"].includes(error?.code ?? "") ? 409 : 503);

async function adminContext(workspace: string) {
  if (!customerAdminWorkspaceAllowed(workspace)) throw new HostedStateError("invalid_workspace", 400);
  const context = await hostedPrototypeContext(workspace);
  if (context.actor.role !== "admin") throw new HostedStateError("admin_membership_required", 403);
  return context;
}

export async function GET(request: NextRequest) {
  try {
    const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
    await adminContext(workspace);
    const kind = request.nextUrl.searchParams.get("kind") ?? "overview";
    const search = request.nextUrl.searchParams.get("search") ?? "";
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "25");
    if (!Number.isInteger(offset) || !Number.isInteger(limit) || offset < 0 || offset > 10000 ||
      limit < 1 || limit > 50 || search.length > 120) return reply({ error: "invalid_page" }, 400);
    const client = await createRybexSupabaseServerClient();
    const { data, error } = await (client.rpc as unknown as (name: string, args: Record<string, unknown>) =>
      Promise<RpcResult>)("d5o_hosted_org_admin_read_v1", {
        p_workspace_key: workspace, p_kind: kind, p_search: search, p_offset: offset, p_limit: limit });
    return error ? failure(error) : reply(data);
  } catch (error) {
    return error instanceof HostedStateError ? reply({ error: error.code }, error.status)
      : reply({ error: "org_read_unavailable" }, 503);
  }
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  try {
    const raw = await request.text();
    if (raw.length > 4000) return reply({ error: "request_too_large" }, 413);
    const input = JSON.parse(raw) as { workspace?: string; action?: string; id?: string | null;
      data?: Record<string, unknown>; expectedRevision?: number; reason?: string; commandId?: string;
      email?: string; role?: string; expiresAt?: string; inviteId?: string };
    const workspace = input.workspace ?? "";
    const context = await adminContext(workspace);
    if (!input.action || !input.commandId || input.commandId.length < 8 || input.commandId.length > 120 ||
      !input.reason || input.reason.trim().length < 8 || input.reason.length > 500)
      return reply({ error: "invalid_org_command" }, 400);
    const client = await createRybexSupabaseServerClient();
    const rpc = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
    if (input.action === "invitation.request") {
      if (!input.email || !input.role || !input.expiresAt) return reply({ error: "invalid_invitation" }, 400);
      const intent = await rpc("d5o_hosted_org_invitation_request_v1", {
        p_workspace_key: workspace, p_email: input.email, p_role: input.role,
        p_reason: input.reason.trim(), p_command_id: input.commandId, p_expires_at: input.expiresAt });
      if (intent.error) return failure(intent.error);
      const state = intent.data as { providerRequired?: boolean; replay?: boolean; status?: string };
      if (!state.providerRequired || state.replay) return reply({ result: state });
      const admin = createRybexSupabaseAdminClient();
      let status: "provider_accepted" | "provider_rejected" | "uncertain" = "provider_rejected";
      let providerUserId: string | null = null;
      if (isApprovedTestRecipient(input.email)) {
        try {
          const sent = await admin.auth.admin.inviteUserByEmail(input.email.trim().toLowerCase(), {
            redirectTo: `${request.headers.get("origin") ?? "https://d5o-system-of-work.vercel.app"}/auth/set-password?request=${encodeURIComponent(input.commandId)}` });
          status = sent.error ? "provider_rejected" : "provider_accepted";
          providerUserId = sent.data.user?.id ?? null;
        } catch { status = "uncertain"; }
      }
      const finished = await (admin.rpc as unknown as (name: string, args: Record<string, unknown>) =>
        Promise<RpcResult>)("d5o_hosted_org_invitation_finish_v1", {
          p_workspace_key: workspace, p_command_id: input.commandId,
          p_admin_user_id: context.actor.id, p_admin_membership_id: context.actor.membershipId,
          p_status: status, p_provider_user_id: providerUserId });
      if (finished.error) return reply({ error: "invitation_outcome_uncertain" }, 503);
      return reply({ result: finished.data, deliveryVerified: false,
        message: isApprovedTestRecipient(input.email)
          ? "Auth provider accepted the request; mailbox delivery is unverified."
          : "Pilot email delivery permits approved test recipients only." }, status === "provider_rejected" ? 409 : 200);
    }
    if (input.action === "invitation.revoke") {
      if (!input.inviteId) return reply({ error: "invalid_invitation" }, 400);
      const result = await rpc("d5o_hosted_org_invitation_revoke_v1", {
        p_workspace_key: workspace, p_command_id: input.inviteId, p_reason: input.reason.trim() });
      return result.error ? failure(result.error) : reply({ result: result.data });
    }
    if (!Number.isInteger(input.expectedRevision) || (input.expectedRevision ?? -1) < 0 ||
      !input.data || Array.isArray(input.data) || typeof input.data !== "object" ||
      (input.id && !/^[0-9a-f-]{36}$/i.test(input.id))) return reply({ error: "invalid_org_command" }, 400);
    const result = await rpc("d5o_hosted_org_admin_command_v1", {
      p_workspace_key: workspace, p_action: input.action, p_subject_id: input.id ?? null,
      p_input: input.data, p_expected_revision: input.expectedRevision,
      p_reason: input.reason.trim(), p_command_id: input.commandId });
    return result.error ? failure(result.error) : reply({ result: result.data });
  } catch (error) {
    return error instanceof HostedStateError ? reply({ error: error.code }, error.status)
      : error instanceof SyntaxError ? reply({ error: "invalid_request" }, 400)
        : reply({ error: "org_command_unavailable" }, 503);
  }
}
