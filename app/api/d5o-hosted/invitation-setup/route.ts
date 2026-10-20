import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseAdminClient, createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  try {
    const raw = await request.text();
    if (raw.length > 300) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const input = JSON.parse(raw) as { requestId?: string };
    if (!input.requestId || input.requestId.length < 8 || input.requestId.length > 120)
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const ordinary = await createRybexSupabaseServerClient();
    const { data: { user }, error } = await ordinary.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
    const admin = createRybexSupabaseAdminClient();
    const result = await (admin.rpc as unknown as (name: string, args: Record<string, unknown>) =>
      Promise<{ data: unknown; error: { code?: string } | null }>)("d5o_hosted_identity_setup_completed_v1", {
        p_workspace_key: "rybex", p_command_id: input.requestId, p_user_id: user.id,
      });
    if (result.error) return NextResponse.json({ error: "invitation_identity_mismatch" },
      { status: result.error.code === "42501" ? 403 : 409 });
    return NextResponse.json({ result: result.data }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "setup_unavailable" }, { status: 503 });
  }
}
