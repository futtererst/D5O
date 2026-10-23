import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { hostedD5OTargetReady } from "@/lib/d5o/auth/hosted-target";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";

const keyPattern = /^[a-z][a-z0-9_-]{1,63}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" }
});

type RpcName = "d5o_hosted_actor_v1" | "d5o_hosted_list_work_v1" |
  "d5o_hosted_load_work_v1" | "d5o_hosted_create_work_v1";
type RpcError = { code?: string; message: string };

async function authorizedClient(workspaceKey: string) {
  if (!hostedD5OTargetReady()) return { error: "hosted_unavailable", status: 503 as const };
  const client = await createRybexSupabaseServerClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return { error: "unauthenticated", status: 401 as const };
  const call = client.rpc.bind(client) as unknown as
    (name: RpcName, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError | null }>;
  const scope = await call("d5o_hosted_actor_v1", { p_workspace_key: workspaceKey });
  const actor = scope.data as { role?: string } | null;
  if (scope.error || !actor || actor.role === "field_worker")
    return { error: "workspace_forbidden", status: 403 as const };
  return { call, status: 200 as const };
}

function commandError(error: RpcError | null) {
  if (!error) return reply({ error: "invalid_response" }, 502);
  if (error.code === "42501") return reply({ error: "forbidden" }, 403);
  if (error.code === "23505") return reply({ error: "command_conflict" }, 409);
  if (error.code === "22023") return reply({ error: error.message }, 422);
  return reply({ error: "command_unavailable" }, 503);
}

export async function GET(request: NextRequest) {
  const workspaceKey = request.nextUrl.searchParams.get("workspace") ?? "";
  const workId = request.nextUrl.searchParams.get("work");
  if (!keyPattern.test(workspaceKey) || (workId !== null && !uuidPattern.test(workId)))
    return reply({ error: "invalid_target" }, 400);
  const scope = await authorizedClient(workspaceKey);
  if (!scope.call) return reply({ error: scope.error }, scope.status);
  const result = workId
    ? await scope.call("d5o_hosted_load_work_v1", { p_workspace_key: workspaceKey, p_work_id: workId })
    : await scope.call("d5o_hosted_list_work_v1", { p_workspace_key: workspaceKey, p_limit: 50 });
  if (result.error) return commandError(result.error);
  if (workId && !result.data) return reply({ error: "work_unavailable" }, 404);
  return reply({ result: result.data });
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const body = await request.text();
  if (body.length > 8192) return reply({ error: "command_too_large" }, 413);
  let input: Record<string, unknown>;
  try { input = JSON.parse(body) as Record<string, unknown>; }
  catch { return reply({ error: "invalid_command" }, 400); }
  const { workspaceKey, commandId, configurationVersionId, workTypeKey, title } = input;
  if (typeof workspaceKey !== "string" || !keyPattern.test(workspaceKey)
    || typeof commandId !== "string" || commandId.length < 8 || commandId.length > 120
    || typeof configurationVersionId !== "string" || !uuidPattern.test(configurationVersionId)
    || typeof workTypeKey !== "string" || !keyPattern.test(workTypeKey)
    || typeof title !== "string" || !title.trim() || title.length > 240)
    return reply({ error: "invalid_command" }, 400);
  const scope = await authorizedClient(workspaceKey);
  if (!scope.call) return reply({ error: scope.error }, scope.status);
  const result = await scope.call("d5o_hosted_create_work_v1", {
    p_workspace_key: workspaceKey,
    p_command_id: commandId,
    p_configuration_version_id: configurationVersionId,
    p_work_type_key: workTypeKey,
    p_title: title.trim()
  });
  if (result.error) return commandError(result.error);
  return reply({ result: result.data }, 201);
}
