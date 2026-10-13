import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { NextRequest, NextResponse } from "next/server";
import { applyDesignCommand, type DesignCommand } from "@/lib/d5o/prototype-work/design-command";
import { PrototypeWorkError } from "@/lib/d5o/prototype-work/store-error";
import { HostedStateError, hostedPrototypeContext } from "@/lib/d5o/hosted/prototype-context";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import type { SharedSchedule } from "@/components/d5o/platform/schedule-model";
import { hostedConfigurationInventory } from "@/lib/d5o/hosted/configuration-inventory";
import { resolvePublishedPhaseConfiguration } from "@/components/d5o/platform/published-phase-configuration";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!["rybex", "rotork"].includes(workspace)) return reply({ error: "invalid_target" }, 400);
  const raw = await request.text(); if (raw.length > 100_000) return reply({ error: "command_too_large" }, 413);
  try {
    const command = JSON.parse(raw) as DesignCommand;
    if (!command || !command.workId || !Number.isInteger(command.expectedRevision) || !command.commandId || !command.action) return reply({ error: "invalid_command" }, 400);
    const context = await hostedPrototypeContext(workspace);
    if (!context.canEdit) return reply({ error: "workspace_forbidden" }, 403);
    const loaded = await context.read("work");
    if (loaded.revision !== command.expectedRevision || !loaded.state) return reply({ error: "stale_state" }, 409);
    const records = loaded.state.records;
    if (!Array.isArray(records)) return reply({ error: "work_unavailable" }, 404);
    const index = records.findIndex((item) => item && typeof item === "object" && (item as WorkRecord).id === command.workId && (item as WorkRecord).workspace === workspace);
    if (index < 0) return reply({ error: "work_unavailable" }, 404);
    const current = records[index] as WorkRecord;
    if (authoritativeD5OCommandsReady() && current.canonicalWorkId
      && current.serviceSource && command.action.endsWith("service-basis")) {
      if (!Number.isInteger(command.expectedDecisionRevision)
        || !Number.isInteger(command.expectedOperateRevision)
        || command.expectedOperateRevision! < 1)
        return reply({ error: "invalid_service_basis_revision" }, 400);
      const client = await createRybexSupabaseServerClient();
      const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
        data: unknown; error: { code?: string; message: string } | null
      }>;
      const { data, error } = await call("d5o_hosted_service_basis_command_v1", {
        p_workspace_key: workspace, p_presentation_id: command.workId,
        p_action: command.action,
        p_input: { ...(command.serviceBasis ?? {}), reason: command.note ?? "" },
        p_command_id: command.commandId,
        p_expected_work_revision: command.expectedRevision,
        p_expected_operate_revision: command.expectedOperateRevision,
        p_expected_decision_revision: command.expectedDecisionRevision
      });
      if (error) return reply({ error: error.message, message: error.message },
        error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409 :
          error.code === "22023" ? 400 : 503);
      const result = data as { revision?: number; state?: Record<string, unknown> } | null;
      if (!result?.state || !Number.isInteger(result.revision)) return reply({ error: "invalid_response" }, 502);
      return reply({ state: { ...result.state, revision: result.revision }, synthetic: false });
    }
    if (authoritativeD5OCommandsReady() && current.canonicalWorkId &&
      ["save-document", "save-package", "save-demand", "submit-document", "return-document", "approve-document",
        "issue-document", "request-review", "decide-review",
        "release-package", "respond-receipt", "record-change", "acknowledge-hold", "resolve-change"].includes(command.action)) {
      if (!Number.isInteger(command.expectedDecisionRevision) ||
        Number(command.expectedDecisionRevision) < 0)
        return reply({ error: "invalid_decision_revision" }, 400);
      const client = await createRybexSupabaseServerClient();
      const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
        data: unknown; error: { code?: string; message: string } | null
      }>;
      const commandName = ["record-change", "acknowledge-hold", "resolve-change"].includes(command.action)
        ? "d5o_hosted_design_field_change_command_v1"
        : ["save-document", "save-package"].includes(command.action)
        ? "d5o_hosted_design_draft_command_v1"
        : command.action === "save-demand"
          ? "d5o_hosted_design_demand_command_v1"
        : ["release-package", "respond-receipt"].includes(command.action)
          ? "d5o_hosted_design_release_command_v1"
          : "d5o_hosted_design_review_command_v1";
      const args: Record<string, unknown> = {
        p_workspace_key: workspace, p_presentation_id: command.workId,
        p_command_id: command.commandId,
        p_expected_source_revision: command.expectedRevision,
        p_expected_decision_revision: command.expectedDecisionRevision
      };
      if (command.action === "save-demand") args.p_demand = command.demand;
      else { args.p_action = command.action; args.p_input = command; }
      const { data, error } = await call(commandName, args);
      if (error) return reply({ error: error.message, message: error.message },
        error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409 :
          error.code === "22023" ? 400 : 503);
      const result = data as { revision?: number; state?: Record<string, unknown> } | null;
      if (!result?.state || !Number.isInteger(result.revision)) return reply({ error: "invalid_response" }, 502);
      return reply({ state: { ...result.state, revision: result.revision }, synthetic: false });
    }
    if (current.canonicalWorkId) return reply({ error: "authoritative_command_unavailable" }, 409);
    const schedule = command.action === "release-package" || command.action === "release-set" ? (await context.read("schedule")).state as SharedSchedule | null : null;
    const crewDemand = schedule?.packageDemands.find((item) => item.packageId === command.packageId && item.workId === command.workId) ?? null;
    const work = current;
    const config = resolvePublishedPhaseConfiguration(await hostedConfigurationInventory(workspace as WorkRecord["workspace"]), work.workspace, work.type, work);
    if (work.discovery?.pursuitControl && !config) return reply({ error: "design_policy_unavailable" }, 409);
    const next = applyDesignCommand(work, command, context.actor, crewDemand, config?.designControls, schedule?.packageDemands ?? [], records as WorkRecord[]);
    const saved = await context.save("work", loaded.revision, { ...loaded.state, revision: loaded.revision + 1, records: records.map((item, i) => i === index ? next : item) });
    return reply({ state: { ...saved.state, revision: saved.revision }, synthetic: true });
  } catch (error) {
    if (error instanceof HostedStateError || error instanceof PrototypeWorkError) return reply({ error: error.code, message: error.message }, error.status);
    return reply({ error: "design_command_unavailable" }, 503);
  }
}
