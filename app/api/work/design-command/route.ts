import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/lib/d5o/auth/request-context";
import { assertProofEnvironment } from "@/lib/d5o/work-record/server";
import { crewPersonForUser, scheduleWorkspaceKeys } from "@/lib/d5o/scheduling/crew-identity";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { applyDesignCommand, type DesignCommand } from "@/lib/d5o/prototype-work/design-command";
import { mutatePrototypeWork, PrototypeWorkError } from "@/lib/d5o/prototype-work/store";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import { loadSchedule } from "@/lib/d5o/scheduling/store";
import { loadConfigurationInventory } from "@/lib/d5o/configuration/server";
import { resolvePublishedPhaseConfiguration } from "@/components/d5o/platform/published-phase-configuration";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: NextRequest) {
  try {
    assertProofEnvironment();
    const context = await getRequestContext();
    const workspace = context.status === "authorized" && context.workspace && context.membership?.status === "active" ? scheduleWorkspaceKeys[context.workspace.id] : undefined;
    if (!workspace || !context.user?.id || !context.membership) return reply({ error: "unauthorized" }, context.authenticated ? 403 : 401);
    if (await crewPersonForUser(workspace, context.user.id)) return reply({ error: "forbidden" }, 403);
    if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
    const raw = await request.text(); if (raw.length > 100_000) return reply({ error: "command_too_large" }, 413);
    const command = JSON.parse(raw) as DesignCommand;
    if (!command || !command.workId || !Number.isInteger(command.expectedRevision) || !command.commandId || !command.action) return reply({ error: "invalid_command" }, 400);
    const actor = { id: context.user.id, name: context.profile?.displayName ?? context.user.name, membershipId: context.membership.id, role: context.membership.role };
    const demands = command.action === "release-package" || command.action === "release-set" ? (await loadSchedule(workspace)).packageDemands : [];
    const crewDemand = demands.find((item) => item.packageId === command.packageId && item.workId === command.workId) ?? null;
    const inventory = await loadConfigurationInventory(context.workspace!.id);
    const state = await mutatePrototypeWork(workspace, command.expectedRevision, command.workId, (record, current) => {
      const work = record as WorkRecord;
      const config = resolvePublishedPhaseConfiguration(inventory, workspace, work.type, work);
      if (work.discovery?.pursuitControl && !config) throw new PrototypeWorkError("design_policy_unavailable", 409, "The pinned Design configuration is unavailable.");
      return applyDesignCommand(work, command, actor, crewDemand, config?.designControls, demands, current.records as WorkRecord[]) as unknown as Record<string, unknown>;
    });
    return reply({ state });
  } catch (error) {
    if (error instanceof PrototypeWorkError) return reply({ error: error.code, message: error.message }, error.status);
    return reply({ error: "design_command_unavailable" }, 500);
  }
}
