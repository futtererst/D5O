import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseAdminClient, createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { isApprovedTestRecipient } from "@/lib/d5o/auth/approved-test-recipient";

export const dynamic = "force-dynamic";
type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const errorReply = (error: RpcResult["error"]) => reply({ error: error?.message ?? "platform_unavailable" },
  error?.code === "42501" ? 403 : error?.code === "22023" ? 400 :
    ["23503", "23505", "23514"].includes(error?.code ?? "") ? 409 : 503);

async function context() {
  const client = await createRybexSupabaseServerClient();
  const user = await client.auth.getUser();
  if (user.error || !user.data.user) return null;
  return { client, user: user.data.user };
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return reply({ error: "unauthenticated" }, 401);
  const rpc = ctx.client.rpc.bind(ctx.client) as unknown as (name: string) => Promise<RpcResult>;
  const [tenants, templates] = await Promise.all([
    rpc("d5o_platform_provisioning_directory_v1"), rpc("d5o_platform_templates_v1")]);
  if (tenants.error) return errorReply(tenants.error);
  if (templates.error) return errorReply(templates.error);
  return reply({ tenants: tenants.data, templates: templates.data });
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const ctx = await context();
  if (!ctx) return reply({ error: "unauthenticated" }, 401);
  let input: Record<string, unknown>;
  try { const raw = await request.text(); if (raw.length > 6000) return reply({ error: "request_too_large" }, 413);
    input = JSON.parse(raw) as Record<string, unknown>; }
  catch { return reply({ error: "invalid_request" }, 400); }
  const rpc = ctx.client.rpc.bind(ctx.client) as unknown as
    (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  let result: RpcResult;
  if (input.action === "provision") result = await rpc("d5o_platform_provision_v1", {
    p_request_id: input.commandId, p_workspace_key: input.workspaceKey,
    p_legal_name: input.legalName, p_display_name: input.displayName,
    p_admin_email: input.adminEmail, p_country: input.country,
    p_time_zone: input.timeZone, p_currency: input.currency,
    p_template_version_id: input.templateVersionId, p_reason: input.reason });
  else if (input.action === "recover") result = await rpc("d5o_platform_invitation_recover_v1", {
    p_workspace_key: input.workspaceKey, p_command_id: input.commandId, p_reason: input.reason });
  else if (input.action === "activate") result = await rpc("d5o_platform_activate_v1", {
    p_workspace_key: input.workspaceKey, p_expected_revision: input.expectedRevision,
    p_command_id: input.commandId, p_reason: input.reason });
  else if (input.action === "template") result = await rpc("d5o_platform_template_command_v1", {
    p_template_key: input.templateKey, p_action: input.templateAction,
    p_version_id: input.templateVersionId ?? null, p_payload: input.payload ?? null,
    p_command_id: input.commandId, p_reason: input.reason });
  else return reply({ error: "invalid_action" }, 400);
  if (result.error) return errorReply(result.error);
  const data = result.data as { invitationStatus?: string; invitationId?: string;
    workspaceKey?: string; adminEmail?: string };
  if ((input.action === "provision" || input.action === "recover") &&
    data.invitationStatus === "pending" && data.adminEmail &&
    isApprovedTestRecipient(data.adminEmail) && data.invitationId) {
    const admin = createRybexSupabaseAdminClient();
    let status: "provider_accepted" | "provider_rejected" | "uncertain" = "provider_rejected";
    let userId: string | null = null;
    try {
      const sent = await admin.auth.admin.inviteUserByEmail(data.adminEmail, {
        redirectTo: `${request.nextUrl.origin}/auth/set-password?initial=${encodeURIComponent(data.invitationId)}&workspace=${encodeURIComponent(data.workspaceKey ?? "")}` });
      status = sent.error ? "provider_rejected" : "provider_accepted";
      userId = sent.data.user?.id ?? null;
    } catch { status = "uncertain"; }
    const finished = await (admin.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<RpcResult>)(
      "d5o_platform_invitation_finish_v1", { p_workspace_key: data.workspaceKey,
        p_invitation_id: data.invitationId, p_vendor_user_id: ctx.user.id,
        p_status: status, p_provider_user_id: userId });
    if (finished.error) return reply({ error: "invitation_outcome_uncertain", result: data }, 503);
    return reply({ result: data, delivery: status, mailboxDeliveryVerified: false });
  }
  return reply({ result: data, mailboxDeliveryVerified: false });
}
