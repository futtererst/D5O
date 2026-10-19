import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseAdminClient } from "@/lib/d5o/auth/supabase-server";
import { hostedPrototypeContext, HostedStateError } from "@/lib/d5o/hosted/prototype-context";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: NextRequest) {
  try {
    const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
    if (workspace !== "rybex") return reply({ error: "invalid_workspace" }, 400);
    const context = await hostedPrototypeContext(workspace);
    if (context.actor.role !== "admin") return reply({ error: "admin_membership_required" }, 403);
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "25");
    const userId = request.nextUrl.searchParams.get("userId");
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 50)
      return reply({ error: "invalid_page" }, 400);
    if (userId && !/^[0-9a-f-]{36}$/i.test(userId)) return reply({ error: "invalid_user" }, 400);
    const client = createRybexSupabaseAdminClient();
    const { data, error } = await (client.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>)("d5o_hosted_admin_directory_v1", {
      p_workspace_key: workspace, p_admin_user_id: context.actor.id,
      p_admin_membership_id: context.actor.membershipId,
      p_search: request.nextUrl.searchParams.get("search")?.slice(0, 120) ?? "", p_offset: offset, p_limit: limit,
      p_user_id: userId || null,
    });
    return error ? reply({ error: error.code === "42501" ? "admin_membership_required" : "directory_unavailable" }, error.code === "42501" ? 403 : 503) : reply(data);
  } catch (error) {
    return error instanceof HostedStateError ? reply({ error: error.code }, error.status) : reply({ error: "directory_unavailable" }, 503);
  }
}
