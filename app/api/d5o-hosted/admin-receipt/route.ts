import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseAdminClient, createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { hostedPrototypeContext, HostedStateError } from "@/lib/d5o/hosted/prototype-context";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: NextRequest) {
  try {
    const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
    const commandId = request.nextUrl.searchParams.get("commandId") ?? "";
    if (workspace !== "rybex" || commandId.length < 8 || commandId.length > 120) return reply({ error: "invalid_request" }, 400);
    const context = await hostedPrototypeContext(workspace);
    if (context.actor.role !== "admin") return reply({ error: "admin_membership_required" }, 403);
    const client = createRybexSupabaseAdminClient();
    const { data, error } = await (client.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>)("d5o_hosted_admin_receipt_v1", {
      p_workspace_key: workspace, p_admin_user_id: context.actor.id,
      p_admin_membership_id: context.actor.membershipId, p_command_id: commandId,
    });
    if (error) return reply({ error: error.code === "42501" ? "admin_membership_required" : "receipt_unavailable" }, error.code === "42501" ? 403 : 503);
    if ((data as { found?: boolean } | null)?.found) return reply(data);
    const ordinary = await createRybexSupabaseServerClient();
    const { data: configuration, error: configurationError } = await (ordinary.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>)(
      "d5o_hosted_configuration_admin_receipt_v1", { p_workspace_key: workspace, p_command_id: commandId });
    return configurationError ? reply({ error: "receipt_unavailable" }, configurationError.code === "42501" ? 403 : 503) : reply(configuration);
  } catch (error) {
    return error instanceof HostedStateError ? reply({ error: error.code }, error.status) : reply({ error: "receipt_unavailable" }, 503);
  }
}
