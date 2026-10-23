import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" }
});

export async function POST(request: NextRequest) {
  if (!authoritativeD5OCommandsReady()) return reply({ error: "authoritative_runtime_unavailable" }, 503);
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(workspace)) return reply({ error: "invalid_workspace" }, 400);
  const raw = await request.text();
  if (raw.length > 10000) return reply({ error: "command_too_large" }, 413);
  let input: Record<string, unknown>;
  try { input = JSON.parse(raw) as Record<string, unknown>; }
  catch { return reply({ error: "invalid_command" }, 400); }
  if (typeof input.workId !== "string" || typeof input.action !== "string"
    || typeof input.commandId !== "string" || !Number.isInteger(input.expectedRevision)
    || !Number.isInteger(input.expectedDecisionRevision)
    || !input.intent || typeof input.intent !== "object" || Array.isArray(input.intent))
    return reply({ error: "invalid_command" }, 400);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown; error: { code?: string; message: string } | null
  }>;
  const { data, error } = await call("d5o_hosted_pursuit_command_v1", {
    p_workspace_key: workspace, p_presentation_id: input.workId,
    p_action: input.action, p_intent: input.intent, p_command_id: input.commandId,
    p_expected_source_revision: input.expectedRevision,
    p_expected_decision_revision: input.expectedDecisionRevision
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "23505" ? 409 :
      error.code === "22023" ? 400 : error.code === "23514" ? 409 : 503;
    return reply({ error: error.message, message: error.message }, status);
  }
  const result = data as { revision?: number; state?: Record<string, unknown> } | null;
  if (!result?.state || !Number.isInteger(result.revision)) return reply({ error: "invalid_response" }, 502);
  return reply({ state: { ...result.state, revision: result.revision }, synthetic: false });
}
