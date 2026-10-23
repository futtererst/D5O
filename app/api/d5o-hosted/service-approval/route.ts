import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { hostedPrototypeContext, HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { customerAdminWorkspaceAllowed } from "@/lib/d5o/admin/customer-workspace";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  try {
    const raw = await request.text();
    if (raw.length > 800) return reply({ error: "request_too_large" }, 413);
    const input = JSON.parse(raw) as { workspace?: string; workId?: string; action?: string;
      amountMinor?: number; currency?: string; commandId?: string };
    if (!input.workspace || !customerAdminWorkspaceAllowed(input.workspace)
      || !/^[0-9a-f-]{36}$/i.test(input.workId ?? "")
      || !["request", "approve", "reject"].includes(input.action ?? "")
      || !Number.isSafeInteger(input.amountMinor) || (input.amountMinor ?? -1) < 0
      || input.currency !== "USD" || typeof input.commandId !== "string"
      || input.commandId.length < 8 || input.commandId.length > 120)
      return reply({ error: "invalid_service_approval_command" }, 400);
    await hostedPrototypeContext(input.workspace);
    const client = await createRybexSupabaseServerClient();
    const { data, error } = await (client.rpc as unknown as (name: string, args: Record<string, unknown>) =>
      Promise<{ data: unknown; error: { code?: string; message: string } | null }>)(
      "d5o_hosted_service_approval_command_v1", {
        p_workspace_key: input.workspace, p_work_id: input.workId, p_action: input.action,
        p_amount_minor: input.amountMinor, p_currency: input.currency, p_command_id: input.commandId,
      });
    if (error) return reply({ error: error.message }, error.code === "42501" ? 403
      : error.code === "22023" ? 400 : error.code === "23505" || error.code === "23514" ? 409 : 503);
    return reply({ result: data });
  } catch (error) {
    return error instanceof HostedStateError ? reply({ error: error.code }, error.status)
      : error instanceof SyntaxError ? reply({ error: "invalid_request" }, 400)
        : reply({ error: "service_approval_unavailable" }, 503);
  }
}
