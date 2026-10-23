import { NextRequest, NextResponse } from "next/server";
import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
type DbError = { code?: string; message: string } | null;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status,
  headers: { "Cache-Control": "no-store" } });
const failure = (error: DbError) => reply({ error: error?.message ?? "internal_rate_unavailable" },
  error?.code === "42501" ? 403 : ["23505", "23514"].includes(error?.code ?? "") ? 409 :
    error?.code === "22023" ? 400 : 503);
const workspace = (request: NextRequest) => {
  const key = request.nextUrl.searchParams.get("workspace") ?? "";
  return ["rybex", "rotork"].includes(key) ? key : null;
};

export async function GET(request: NextRequest) {
  const selected = workspace(request);
  if (!selected) return reply({ error: "invalid_workspace" }, 400);
  if (!authoritativeD5OCommandsReady()) return reply({ error: "authoritative_runtime_unavailable" }, 503);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) =>
    Promise<{ data: unknown; error: DbError }>;
  const { data, error } = await call("d5o_design_internal_rate_read_v1", { p_workspace_key: selected });
  return error ? failure(error) : reply(data);
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const selected = workspace(request);
  if (!selected) return reply({ error: "invalid_workspace" }, 400);
  if (!authoritativeD5OCommandsReady()) return reply({ error: "authoritative_runtime_unavailable" }, 503);
  const raw = await request.text();
  if (raw.length > 12_000) return reply({ error: "command_too_large" }, 413);
  let command: Record<string, unknown>;
  try { command = JSON.parse(raw) as Record<string, unknown>; } catch { return reply({ error: "invalid_json" }, 400); }
  if (!["prepare", "approve", "return", "retire"].includes(String(command.action)) ||
    typeof command.commandId !== "string" || !Number.isInteger(command.expectedRevision) ||
    !command.input || typeof command.input !== "object" || Array.isArray(command.input))
    return reply({ error: "invalid_command" }, 400);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) =>
    Promise<{ data: unknown; error: DbError }>;
  const { data, error } = await call("d5o_design_internal_rate_command_v1", {
    p_workspace_key: selected, p_action: command.action as string,
    p_input: command.input as Record<string, unknown>, p_command_id: command.commandId,
    p_expected_revision: command.expectedRevision as number,
  });
  return error ? failure(error) : reply(data);
}
