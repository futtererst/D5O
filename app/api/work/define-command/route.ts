import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/lib/d5o/auth/request-context";
import { assertProofEnvironment } from "@/lib/d5o/work-record/server";
import { scheduleWorkspaceKeys } from "@/lib/d5o/scheduling/crew-identity";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { loadConfigurationInventory } from "@/lib/d5o/configuration/server";
import { applyDefineCommand, defineCommandFingerprint, type DefineCommand } from "@/lib/d5o/prototype-work/define-command";
import { loadPrototypeWork, mutatePrototypeWork, PrototypeWorkError } from "@/lib/d5o/prototype-work/store";
import type { WorkRecord } from "@/components/d5o/platform/work-types";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: NextRequest) {
  try {
    assertProofEnvironment();
    if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
    const context = await getRequestContext();
    const workspace = context.status === "authorized" && context.workspace && context.membership?.status === "active"
      ? scheduleWorkspaceKeys[context.workspace.id] : undefined;
    if (!workspace || !context.user?.id || !context.membership) return reply({ error: "unauthorized" }, context.authenticated ? 403 : 401);
    const raw = await request.text();
    if (raw.length > 20000) return reply({ error: "command_too_large" }, 413);
    const command = JSON.parse(raw) as DefineCommand;
    if (!command?.workId || !command.action || !command.commandId || !Number.isInteger(command.expectedRevision)) return reply({ error: "invalid_command" }, 400);
    const actor = { id: context.user.id, membershipId: context.membership.id, name: context.profile?.displayName ?? context.user.name, role: context.membership.role };
    const prior = await loadPrototypeWork(workspace);
    const work = prior.records.find((item) => item.id === command.workId) as WorkRecord | undefined;
    if (!work) return reply({ error: "work_unavailable" }, 404);
    const replay = work.definition?.decisions?.find((item) => item.commandId === command.commandId);
    if (replay) {
      if (replay.actorId !== actor.id || replay.membershipId !== actor.membershipId || replay.fingerprint !== defineCommandFingerprint(command))
        return reply({ error: "command_reuse_conflict" }, 409);
      return reply({ state: prior, synthetic: true, replay: true });
    }
    const inventory = await loadConfigurationInventory(context.workspace!.id);
    const state = await mutatePrototypeWork(workspace, command.expectedRevision, command.workId,
      (record) => applyDefineCommand(record as WorkRecord, command, actor, inventory));
    return reply({ state, synthetic: true });
  } catch (error) {
    if (error instanceof PrototypeWorkError) return reply({ error: error.code, message: error.message }, error.status);
    return reply({ error: "define_command_unavailable" }, 503);
  }
}
