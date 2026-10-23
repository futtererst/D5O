import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseAdminClient } from "@/lib/d5o/auth/supabase-server";
import { hostedPrototypeContext, HostedStateError } from "@/lib/d5o/hosted/prototype-context";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams;
    const workspace = q.get("workspace") ?? "";
    if (workspace !== "rybex") return reply({ error: "invalid_workspace" }, 400);
    const context = await hostedPrototypeContext(workspace);
    if (context.actor.role !== "admin") return reply({ error: "admin_membership_required" }, 403);
    const offset = Number(q.get("offset") ?? "0");
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000) return reply({ error: "invalid_page" }, 400);
    const client = createRybexSupabaseAdminClient();
    const { data, error } = await (client.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>)("d5o_hosted_admin_audit_v1", {
      p_workspace_key: workspace, p_admin_user_id: context.actor.id,
      p_admin_membership_id: context.actor.membershipId,
      p_actor: q.get("actor")?.slice(0, 120) ?? "",
      p_action: q.get("action")?.slice(0, 120) ?? "",
      p_subject: q.get("subject")?.slice(0, 120) ?? "",
      p_from: q.get("from") || null, p_to: q.get("to") || null,
      p_offset: offset, p_limit: 25,
    });
    return error ? reply({ error: error.code === "42501" ? "admin_membership_required" : "audit_unavailable" }, error.code === "42501" ? 403 : 503) : reply(data);
  } catch (error) {
    return error instanceof HostedStateError ? reply({ error: error.code }, error.status) : reply({ error: "audit_unavailable" }, 503);
  }
}
