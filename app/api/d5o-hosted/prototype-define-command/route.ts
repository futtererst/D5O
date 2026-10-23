import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { NextRequest, NextResponse } from "next/server";
import { HostedStateError, hostedPrototypeContext } from "@/lib/d5o/hosted/prototype-context";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { hostedConfigurationInventory } from "@/lib/d5o/hosted/configuration-inventory";
import { applyDefineCommand, defineCommandFingerprint, type DefineCommand } from "@/lib/d5o/prototype-work/define-command";
import { PrototypeWorkError } from "@/lib/d5o/prototype-work/store-error";
import type { WorkRecord, WorkspaceKey } from "@/components/d5o/platform/work-types";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!["rybex", "rotork"].includes(workspace)) return reply({ error: "invalid_workspace" }, 400);
  try {
    const raw = await request.text();
    if (raw.length > 20000) return reply({ error: "command_too_large" }, 413);
    const command = JSON.parse(raw) as DefineCommand;
    if (!command?.workId || !command.action || !command.commandId || !Number.isInteger(command.expectedRevision)) return reply({ error: "invalid_command" }, 400);
    const context = await hostedPrototypeContext(workspace);
    const allowed = context.canEdit || (context.actor.role === "billing_commercial_lead" && command.action.endsWith("review") && command.role === "commercial");
    if (!allowed) return reply({ error: "workspace_forbidden" }, 403);
    const loaded = await context.read("work"), records = loaded.state?.records as WorkRecord[] | undefined;
    const index = records?.findIndex((item) => item.id === command.workId && item.workspace === workspace) ?? -1;
    if (!records || index < 0) return reply({ error: "work_unavailable" }, 404);
    if (authoritativeD5OCommandsReady() && records[index].canonicalWorkId) {
      if (!Number.isInteger(command.expectedDecisionRevision) || Number(command.expectedDecisionRevision) < 0)
        return reply({ error: "invalid_decision_revision" }, 400);
      const client = await createRybexSupabaseServerClient();
      const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
        data: unknown; error: { code?: string; message: string } | null
      }>;
      const { data, error } = await call("d5o_hosted_define_command_v1", {
        p_workspace_key: workspace,
        p_presentation_id: command.workId,
        p_action: command.action,
        p_review_role: command.role ?? null,
        p_reason: command.reason ?? null,
        p_command_id: command.commandId,
        p_expected_source_revision: command.expectedRevision,
        p_expected_decision_revision: command.expectedDecisionRevision
      });
      if (error) {
        const status = error.code === "42501" ? 403 : error.code === "23505" ? 409 :
          error.code === "22023" ? 400 : error.code === "23514" ? 409 : 503;
        return reply({ error: error.message, message: error.message }, status);
      }
      const result = data as { revision?: number; state?: Record<string, unknown> } | null;
      if (!result?.state || !Number.isInteger(result.revision))
        return reply({ error: "invalid_response" }, 502);
      return reply({ state: { ...result.state, revision: result.revision }, synthetic: false });
    }
    const replay = records[index].definition?.decisions?.find((item) => item.commandId === command.commandId);
    if (replay) {
      if (replay.actorId !== context.actor.id || replay.membershipId !== context.actor.membershipId || replay.fingerprint !== defineCommandFingerprint(command))
        return reply({ error: "command_reuse_conflict" }, 409);
      return reply({ state: { ...loaded.state, revision: loaded.revision }, synthetic: true, replay: true });
    }
    if (loaded.revision !== command.expectedRevision) return reply({ error: "stale_state" }, 409);
    const inventory = await hostedConfigurationInventory(workspace as WorkspaceKey);
    const next = records.map((item, i) => i === index ? applyDefineCommand(item, command, context.actor, inventory) : item);
    const saved = await context.save("work", loaded.revision, { ...loaded.state, records: next, revision: loaded.revision + 1 });
    return reply({ state: { ...saved.state, revision: saved.revision }, synthetic: true });
  } catch (error) {
    if (error instanceof PrototypeWorkError || error instanceof HostedStateError) return reply({ error: error.code, message: error.message }, error.status);
    return reply({ error: "define_command_unavailable" }, 503);
  }
}
