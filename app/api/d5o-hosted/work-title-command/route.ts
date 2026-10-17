import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseAdminClient } from "@/lib/d5o/auth/supabase-server";
import { hostedPrototypeContext, HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  if (!authoritativeD5OCommandsReady()) return reply({ error: "command_runtime_unavailable" }, 503);
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!["rybex", "rotork"].includes(workspace)) return reply({ error: "invalid_target" }, 400);
  const raw = await request.text();
  if (raw.length > 4000) return reply({ error: "command_too_large" }, 413);
  let input: Record<string, unknown>;
  try { input = JSON.parse(raw) as Record<string, unknown>; }
  catch { return reply({ error: "invalid_command" }, 400); }
  if (!input || typeof input.workId !== "string" || typeof input.commandId !== "string"
    || !Number.isInteger(input.expectedRecordVersion)
    || !Number.isInteger(input.expectedWorkRevision)
    || !Number.isInteger(input.expectedCatalogRevision)
    || typeof input.expectedTitle !== "string" || typeof input.title !== "string"
    || typeof input.reason !== "string") return reply({ error: "invalid_command" }, 400);
  let actor: { id: string; membershipId: string };
  try { actor = (await hostedPrototypeContext(workspace)).actor; }
  catch (error) { return error instanceof HostedStateError
    ? reply({ error: error.code }, error.status) : reply({ error: "identity_unavailable" }, 503); }
  const admin = createRybexSupabaseAdminClient();
  const call = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
  const { data, error } = await call("d5o_hosted_correct_work_title_v1", {
    p_workspace_key: workspace,
    p_presentation_id: input.workId,
    p_command_id: input.commandId,
    p_expected_record_version: input.expectedRecordVersion,
    p_expected_work_revision: input.expectedWorkRevision,
    p_expected_catalog_revision: input.expectedCatalogRevision,
    p_expected_title: input.expectedTitle,
    p_new_title: input.title,
    p_reason: input.reason,
    p_actor_user_id: actor.id, p_membership_id: actor.membershipId
  });
  if (error) return reply({ error: error.message },
    error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409
      : error.code === "22023" ? 400 : 503);
  return reply(data);
}




