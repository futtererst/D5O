import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseAdminClient } from "@/lib/d5o/auth/supabase-server";
import { hostedPrototypeContext, HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Rpc = { data: { fresh?: boolean; status?: string } | null; error: { code?: string } | null };
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  try {
    const raw = await request.text();
    if (raw.length > 1600) return reply({ error: "request_too_large" }, 413);
    const input = JSON.parse(raw) as { workspace?: string; action?: string; email?: string;
      reason?: string; commandId?: string; approvedRecipient?: boolean };
    if (input.workspace !== "rybex" || !["invite", "recovery"].includes(input.action ?? "")
      || !input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)
      || !input.reason || input.reason.trim().length < 8 || input.reason.length > 500
      || !input.commandId || input.commandId.length < 8 || input.commandId.length > 120
      || input.approvedRecipient !== true) return reply({ error: "invalid_identity_request" }, 400);
    const context = await hostedPrototypeContext(input.workspace);
    if (context.actor.role !== "admin") return reply({ error: "admin_membership_required" }, 403);
    const allowedDomain = process.env.D5O_APPROVED_TEST_EMAIL_DOMAIN?.trim().toLowerCase();
    if (!allowedDomain || input.email.trim().toLowerCase().split("@")[1] !== allowedDomain)
      return reply({ error: "approved_test_mailbox_required", message: "Email delivery is disabled until an approved synthetic recipient domain is configured." }, 409);
    const redirectOrigin = process.env.D5O_ISOLATED_PILOT === "1" && /^http:\/\/127\.0\.0\.1:\d+$/.test(request.nextUrl.origin)
      ? request.nextUrl.origin : "https://d5o-system-of-work.vercel.app";
    const redirectTo = `${redirectOrigin}/auth/set-password`;
    const admin = createRybexSupabaseAdminClient();
    const rpc = admin.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<Rpc>;
    const basis = { p_workspace_key: input.workspace, p_admin_user_id: context.actor.id,
      p_admin_membership_id: context.actor.membershipId, p_command_id: input.commandId };
    const intent = await rpc("d5o_hosted_admin_identity_intent_v1", { ...basis,
      p_action: input.action, p_target_email: input.email, p_reason: input.reason.trim() });
    if (intent.error) return reply({ error: intent.error.code === "42501" ? "admin_membership_required" : "identity_intent_rejected" }, intent.error.code === "42501" ? 403 : 409);
    if (intent.data?.fresh !== true) return reply({ status: intent.data?.status ?? "uncertain", message: "Existing request retained; the provider action was not repeated." });
    let outcome: "provider_accepted" | "provider_rejected" | "uncertain" = "uncertain";
    let providerUserId: string | null = null;
    try {
      if (input.action === "invite") {
        const sent = await admin.auth.admin.inviteUserByEmail(input.email.trim().toLowerCase(),
          { redirectTo });
        outcome = sent.error ? "provider_rejected" : "provider_accepted";
        providerUserId = sent.data.user?.id ?? null;
      } else {
        const sent = await admin.auth.resetPasswordForEmail(input.email.trim().toLowerCase(),
          { redirectTo });
        outcome = sent.error ? "provider_rejected" : "provider_accepted";
      }
    } catch { outcome = "uncertain"; }
    const finished = await rpc("d5o_hosted_admin_identity_finish_v1", { ...basis,
      p_status: outcome, p_provider_user_id: providerUserId,
      p_provider_message: outcome === "provider_accepted" ? "Provider accepted request; delivery unverified" :
        outcome === "provider_rejected" ? "Provider rejected request" : "Provider outcome uncertain" });
    if (finished.error) return reply({ status: "uncertain", message: "Provider result could not be recorded. Do not repeat the email request." }, 503);
    return reply({ status: outcome, message: outcome === "provider_accepted"
      ? "Provider accepted the request. Email delivery and recipient action have not been verified."
      : outcome === "provider_rejected" ? "The provider rejected this request. No delivery is claimed."
        : "The provider outcome is uncertain. This command will not send a second email on replay." });
  } catch (error) {
    return error instanceof HostedStateError ? reply({ error: error.code }, error.status)
      : error instanceof SyntaxError ? reply({ error: "invalid_request" }, 400)
        : reply({ error: "identity_unavailable" }, 503);
  }
}
