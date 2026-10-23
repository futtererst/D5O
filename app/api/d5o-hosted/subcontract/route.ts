import { NextRequest, NextResponse } from "next/server";
import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
export const dynamic = "force-dynamic";
type RpcError = { code?: string; message: string } | null;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const failure = (error: RpcError) => reply({ error: error?.message ?? "subcontract_unavailable" },
  error?.code === "42501" ? 403 : ["23505", "23514"].includes(error?.code ?? "") ? 409 : error?.code === "22023" ? 400 : 503);
function target(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  const workId = request.nextUrl.searchParams.get("workId") ?? "";
  return ["rybex", "rotork"].includes(workspace) && /^[\w-]{8,120}$/.test(workId) ? { workspace, workId } : null;
}
const business = new Set(["register-company", "prepare-allocation", "review-allocation",
  "prepare-agreement", "review-agreement", "prepare-variation", "review-variation",
  "submit-deliverable", "review-deliverable", "record-invoice", "review-invoice"]);
const finance = new Set(["post-commitment", "post-invoice"]);
export async function GET(request: NextRequest) {
  const selected = target(request);
  if (!selected) return reply({ error: "invalid_target" }, 400);
  if (!authoritativeD5OCommandsReady()) return reply({ error: "authoritative_runtime_unavailable" }, 503);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
  const [position, financePosition] = await Promise.all([
    call("d5o_subcontract_read_v1", { p_workspace_key: selected.workspace, p_presentation_id: selected.workId }),
    call("d5o_hosted_job_finance_read_v1", { p_workspace_key: selected.workspace, p_presentation_id: selected.workId })
  ]);
  if (position.error) return failure(position.error);
  return reply({ ...(position.data as object), financeRevision:
    (financePosition.data as { revision?: number } | null)?.revision ?? null });
}
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const selected = target(request);
  if (!selected) return reply({ error: "invalid_target" }, 400);
  if (!authoritativeD5OCommandsReady()) return reply({ error: "authoritative_runtime_unavailable" }, 503);
  const raw = await request.text();
  if (raw.length > 16_000) return reply({ error: "command_too_large" }, 413);
  let intent: Record<string, unknown>;
  try { intent = JSON.parse(raw) as Record<string, unknown>; } catch { return reply({ error: "invalid_json" }, 400); }
  const action = String(intent.action ?? "");
  if ((!business.has(action) && !finance.has(action)) || typeof intent.commandId !== "string" ||
    !Number.isInteger(intent.expectedRevision) ||
    (business.has(action) && (!intent.input || typeof intent.input !== "object" || Array.isArray(intent.input) ||
      typeof intent.expectedSourceDigest !== "string")) ||
    (finance.has(action) && (!Number.isInteger(intent.expectedFinanceRevision) ||
      typeof intent.subjectId !== "string" || !/^[0-9a-f-]{36}$/i.test(intent.subjectId))))
    return reply({ error: "invalid_command" }, 400);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
  const { data, error } = finance.has(action)
    ? await call("d5o_subcontract_cost_command_v1", {
      p_workspace_key: selected.workspace, p_presentation_id: selected.workId,
      p_action: action, p_subject_id: intent.subjectId,
      p_command_id: intent.commandId, p_expected_subcontract_revision: intent.expectedRevision,
      p_expected_finance_revision: intent.expectedFinanceRevision
    })
    : await call("d5o_subcontract_command_v1", {
      p_workspace_key: selected.workspace, p_presentation_id: selected.workId,
      p_action: action, p_input: intent.input,
      p_command_id: intent.commandId, p_expected_revision: intent.expectedRevision,
      p_expected_source_digest: intent.expectedSourceDigest
    });
  return error ? failure(error) : reply(data);
}
