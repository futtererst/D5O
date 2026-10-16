import { NextRequest, NextResponse } from "next/server";
import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { graybarDirectAdapter, graybarDocumentCapabilities } from "@/lib/d5o/graybar/supplier-adapter";

export const dynamic = "force-dynamic";
const reply = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
const actions = new Set(["accept-quote", "assess-product", "prepare-bom", "approve-bom", "prepare-po", "approve-po", "record-test-submission", "record-acknowledgment", "record-shipment", "record-receipt", "record-supplier-invoice", "review-supplier-invoice", "record-return", "record-credit", "handoff-installed"]);
function target(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  const workId = request.nextUrl.searchParams.get("workId") ?? "";
  return ["rybex", "rotork"].includes(workspace) && /^[\w-]{8,120}$/.test(workId) ? { workspace, workId } : null;
}
const errorResult = (error: { code?: string; message: string } | null) => reply({ error: error?.message ?? "procurement_unavailable" }, error?.code === "42501" ? 403 : ["23505", "23514"].includes(error?.code ?? "") ? 409 : error?.code === "22023" ? 400 : 503);
export async function GET(request: NextRequest) {
  const selected = target(request);
  if (!selected) return reply({ error: "invalid_target" }, 400);
  if (!authoritativeD5OCommandsReady()) return reply({ error: "authoritative_runtime_unavailable" }, 503);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
  const { data, error } = await call("d5o_graybar_read_v1", { p_workspace_key: selected.workspace, p_presentation_id: selected.workId });
  return error ? errorResult(error) : reply({ ...(data as Record<string, unknown>), supplierCapabilities: {
    direct: graybarDirectAdapter.capabilities, documents: graybarDocumentCapabilities,
  } });
}
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const selected = target(request);
  if (!selected) return reply({ error: "invalid_target" }, 400);
  if (!authoritativeD5OCommandsReady()) return reply({ error: "authoritative_runtime_unavailable" }, 503);
  const body = await request.text();
  if (body.length > 60_000) return reply({ error: "command_too_large" }, 413);
  let intent: Record<string, unknown>;
  try { intent = JSON.parse(body) as Record<string, unknown>; } catch { return reply({ error: "invalid_json" }, 400); }
  if (!actions.has(String(intent.action)) || typeof intent.commandId !== "string" || !Number.isInteger(intent.expectedRevision) ||
    !intent.input || typeof intent.input !== "object" || Array.isArray(intent.input)) return reply({ error: "invalid_command" }, 400);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
  const { data, error } = await call("d5o_graybar_command_v1", { p_workspace_key: selected.workspace, p_presentation_id: selected.workId,
    p_action: intent.action, p_input: intent.input, p_command_id: intent.commandId, p_expected_revision: intent.expectedRevision });
  return error ? errorResult(error) : reply(data);
}
