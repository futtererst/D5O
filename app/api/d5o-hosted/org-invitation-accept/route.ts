import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const input = await request.json().catch(() => null) as { workspace?: string; inviteId?: string } | null;
  // The database verifies the exact tenant-bound offer and signed-in recipient.
  if (!input || !/^[a-z][a-z0-9_-]{2,63}$/.test(input.workspace ?? "") ||
    !input.inviteId || input.inviteId.length < 8 || input.inviteId.length > 120)
    return NextResponse.json({ error: "invalid_invitation" }, { status: 400 });
  const client = await createRybexSupabaseServerClient();
  const { data, error } = await (client.rpc as unknown as (name: string, args: Record<string, unknown>) =>
    Promise<{ data: unknown; error: { code?: string; message: string } | null }>)(
    "d5o_hosted_org_invitation_accept_v1", {
      p_workspace_key: input.workspace, p_command_id: input.inviteId });
  return NextResponse.json(error ? { error: error.message } : { result: data },
    { status: error ? error.code === "42501" ? 403 : 409 : 200,
      headers: { "Cache-Control": "no-store" } });
}
