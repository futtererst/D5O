import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  let input: { workspaceKey?: string; invitationId?: string };
  try { input = await request.json(); } catch { return NextResponse.json({ error: "invalid_request" }, { status: 400 }); }
  if (!input.workspaceKey || !input.invitationId || input.invitationId.length > 130)
    return NextResponse.json({ error: "invalid_invitation" }, { status: 400 });
  const client = await createRybexSupabaseServerClient();
  const user = await client.auth.getUser();
  if (!user.data.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data, error } = await (client.rpc as unknown as (name: string, args: Record<string, unknown>) =>
    Promise<{ data: unknown; error: { code?: string; message: string } | null }>)(
    "d5o_platform_initial_admin_accept_v1", {
      p_workspace_key: input.workspaceKey, p_invitation_id: input.invitationId });
  return NextResponse.json(error ? { error: error.message } : { result: data },
    { status: error ? error.code === "42501" ? 403 : 409 : 200 });
}
