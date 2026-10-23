import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { NextRequest, NextResponse } from "next/server";
import type { WorkspaceKey } from "@/components/d5o/platform/work-types";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import { applyCommercialCommand, type CommercialCommand } from "@/lib/d5o/prototype-work/commercial-command";
import { PrototypeWorkError } from "@/lib/d5o/prototype-work/store-error";
import { HostedStateError, hostedPrototypeContext } from "@/lib/d5o/hosted/prototype-context";
import { hostedConfigurationInventory } from "@/lib/d5o/hosted/configuration-inventory";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";

export const dynamic = "force-dynamic";
const workspaces = new Set(["rybex", "rotork"]);
const actions = new Set(["save-detailed-estimate", "submit-solution", "approve-solution", "return-solution", "submit-pricing", "approve-margin-exception", "approve-pricing", "return-pricing", "save-proposal-revision",
  "submit-proposal", "approve-proposal", "return-proposal", "record-customer-submission",
  "record-customer-response", "start-negotiated-revision", "submit-design-handoff",
  "accept-design-handoff", "return-design-handoff"]);
const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" }
});

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!workspaces.has(workspace)) return reply({ error: "invalid_target" }, 400);
  const raw = await request.text();
  if (raw.length > 100_000) return reply({ error: "command_too_large" }, 413);
  try {
    const command = JSON.parse(raw) as CommercialCommand;
    if (!command || typeof command.workId !== "string" || !command.workId
      || !actions.has(command.action) || !Number.isInteger(command.expectedRevision)
      || !Number.isInteger(command.packageRevision)
      || [command.note, command.dueDate, command.recipient, command.method,
        command.responseStatus, command.receivedAt, command.sourceReference, command.nextAction, command.followUpDue]
        .some((value) => value !== undefined && typeof value !== "string")
      || command.handoffRevision !== undefined
        && (!Number.isInteger(command.handoffRevision) || command.handoffRevision < 1)
      || command.action === "save-detailed-estimate" && (!command.pricingInput || typeof command.pricingInput !== "object" || Array.isArray(command.pricingInput))
      || command.action === "save-proposal-revision" && (!command.offerInput || typeof command.offerInput !== "object" || Array.isArray(command.offerInput)))
      return reply({ error: "invalid_command" }, 400);
    const context = await hostedPrototypeContext(workspace);
    if (!context.canEdit) return reply({ error: "workspace_forbidden" }, 403);
    const loaded = await context.read("work");
    if (loaded.revision !== command.expectedRevision) return reply({ error: "stale_state" }, 409);
    const state = loaded.state;
    const records = state?.records;
    if (!Array.isArray(records)) return reply({ error: "work_unavailable" }, 404);
    const index = records.findIndex((record) => record && typeof record === "object"
      && (record as WorkRecord).id === command.workId);
    if (index < 0) return reply({ error: "work_unavailable" }, 404);
    const current = records[index] as WorkRecord;
    if (current.workspace !== workspace) return reply({ error: "workspace_forbidden" }, 403);
    if (authoritativeD5OCommandsReady() && current.canonicalWorkId &&
      ["submit-design-handoff", "accept-design-handoff", "return-design-handoff"].includes(command.action)) {
      if (!command.commandId || !Number.isInteger(command.expectedDecisionRevision) ||
        Number(command.expectedDecisionRevision) < 0)
        return reply({ error: "invalid_decision_revision" }, 400);
      const client = await createRybexSupabaseServerClient();
      const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
        data: unknown; error: { code?: string; message: string } | null
      }>;
      const { data, error } = await call("d5o_hosted_design_handoff_command_v1", {
        p_workspace_key: workspace, p_presentation_id: command.workId,
        p_action: command.action, p_due_date: command.dueDate ?? null,
        p_reason: command.note ?? null, p_command_id: command.commandId,
        p_expected_source_revision: command.expectedRevision,
        p_expected_decision_revision: command.expectedDecisionRevision,
        p_offer_revision: command.packageRevision,
        p_handoff_revision: command.handoffRevision ??
          (current.discovery?.designHandoff?.revision ?? 0) + 1
      });
      if (error) return reply({ error: error.message, message: error.message },
        error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409 :
          error.code === "22023" ? 400 : 503);
      const result = data as { revision?: number; state?: Record<string, unknown> } | null;
      if (!result?.state || !Number.isInteger(result.revision)) return reply({ error: "invalid_response" }, 502);
      return reply({ state: { ...result.state, revision: result.revision }, synthetic: false });
    }
    if (authoritativeD5OCommandsReady() && current.canonicalWorkId &&
      ["record-customer-submission", "record-customer-response"].includes(command.action)) {
      if (!command.commandId || !Number.isInteger(command.expectedDecisionRevision) ||
        Number(command.expectedDecisionRevision) < 1)
        return reply({ error: "invalid_decision_revision" }, 400);
      const client = await createRybexSupabaseServerClient();
      const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
        data: unknown; error: { code?: string; message: string } | null
      }>;
      const { data, error } = await call("d5o_hosted_customer_decision_command_v1", {
        p_workspace_key: workspace, p_presentation_id: command.workId,
        p_action: command.action, p_offer_revision: command.packageRevision,
        p_recipient: command.recipient ?? null, p_method: command.method ?? null,
        p_due_date: command.dueDate ?? null, p_response_status: command.responseStatus ?? null,
        p_received_at: command.receivedAt ?? null, p_details: command.note ?? null,
        p_source_reference: command.sourceReference ?? null,
        p_next_action: command.nextAction ?? null, p_follow_up_due: command.followUpDue ?? null,
        p_command_id: command.commandId,
        p_expected_source_revision: command.expectedRevision,
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
      command.action === "save-proposal-revision") {
      if (!command.commandId || !Number.isInteger(command.expectedDecisionRevision) ||
        Number(command.expectedDecisionRevision) < 1)
        return reply({ error: "invalid_decision_revision" }, 400);
      const client = await createRybexSupabaseServerClient();
      const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
        data: unknown; error: { code?: string; message: string } | null
      }>;
      const { data, error } = await call("d5o_hosted_offer_revision_command_v1", {
        p_workspace_key: workspace, p_presentation_id: command.workId,
        p_input: command.offerInput, p_command_id: command.commandId,
        p_expected_source_revision: command.expectedRevision,
        p_expected_decision_revision: command.expectedDecisionRevision,
        p_offer_revision: command.packageRevision
      });
      if (error) return reply({ error: error.message, message: error.message },
        error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409 :
          error.code === "22023" ? 400 : 503);
      const result = data as { revision?: number; state?: Record<string, unknown> } | null;
      if (!result?.state || !Number.isInteger(result.revision)) return reply({ error: "invalid_response" }, 502);
      return reply({ state: { ...result.state, revision: result.revision }, synthetic: false });
    }
    if (authoritativeD5OCommandsReady() && current.canonicalWorkId &&
      ["submit-proposal", "approve-proposal", "return-proposal"].includes(command.action)) {
      if (!command.commandId || !Number.isInteger(command.expectedDecisionRevision) ||
        Number(command.expectedDecisionRevision) < 0)
        return reply({ error: "invalid_decision_revision" }, 400);
      const client = await createRybexSupabaseServerClient();
      const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
        data: unknown; error: { code?: string; message: string } | null
      }>;
      const { data, error } = await call("d5o_hosted_offer_review_command_v1", {
        p_workspace_key: workspace, p_presentation_id: command.workId,
        p_action: command.action, p_due_date: command.dueDate ?? null,
        p_reason: command.note ?? null, p_command_id: command.commandId,
        p_expected_source_revision: command.expectedRevision,
        p_expected_decision_revision: command.expectedDecisionRevision,
        p_offer_revision: command.packageRevision
      });
      if (error) return reply({ error: error.message, message: error.message },
        error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409 :
          error.code === "22023" ? 400 : 503);
      const result = data as { revision?: number; state?: Record<string, unknown> } | null;
      if (!result?.state || !Number.isInteger(result.revision)) return reply({ error: "invalid_response" }, 502);
      return reply({ state: { ...result.state, revision: result.revision }, synthetic: false });
    }
    if (authoritativeD5OCommandsReady() && current.canonicalWorkId &&
      ["save-detailed-estimate", "submit-pricing", "approve-pricing", "return-pricing"].includes(command.action)) {
      if (!command.commandId || !Number.isInteger(command.expectedDecisionRevision) ||
        Number(command.expectedDecisionRevision) < 0)
        return reply({ error: "invalid_decision_revision" }, 400);
      const client = await createRybexSupabaseServerClient();
      const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
        data: unknown; error: { code?: string; message: string } | null
      }>;
      const { data, error } = await call("d5o_hosted_estimate_command_v1", {
        p_workspace_key: workspace, p_presentation_id: command.workId,
        p_action: command.action, p_input: command.pricingInput ?? null,
        p_due_date: command.dueDate ?? null, p_reason: command.note ?? null,
        p_command_id: command.commandId,
        p_expected_source_revision: command.expectedRevision,
        p_expected_decision_revision: command.expectedDecisionRevision,
        p_estimate_revision: command.packageRevision
      });
      if (error) return reply({ error: error.message, message: error.message },
        error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409 :
          error.code === "22023" ? 400 : 503);
      const result = data as { revision?: number; state?: Record<string, unknown> } | null;
      if (!result?.state || !Number.isInteger(result.revision)) return reply({ error: "invalid_response" }, 502);
      return reply({ state: { ...result.state, revision: result.revision }, synthetic: false });
    }
    if (authoritativeD5OCommandsReady() && current.canonicalWorkId &&
      ["submit-solution", "approve-solution", "return-solution"].includes(command.action)) {
      if (!command.commandId || !Number.isInteger(command.expectedDecisionRevision) ||
        Number(command.expectedDecisionRevision) < 0)
        return reply({ error: "invalid_decision_revision" }, 400);
      const client = await createRybexSupabaseServerClient();
      const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
        data: unknown; error: { code?: string; message: string } | null
      }>;
      const { data, error } = await call("d5o_hosted_solution_command_v1", {
        p_workspace_key: workspace,p_presentation_id: command.workId,
        p_action: command.action,p_due_date: command.dueDate ?? null,
        p_reason: command.note ?? null,p_command_id: command.commandId,
        p_expected_source_revision: command.expectedRevision,
        p_expected_decision_revision: command.expectedDecisionRevision,
        p_solution_revision: command.packageRevision
      });
      if (error) return reply({ error: error.message, message: error.message },
        error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409 :
          error.code === "22023" ? 400 : 503);
      const result = data as { revision?: number; state?: Record<string, unknown> } | null;
      if (!result?.state || !Number.isInteger(result.revision)) return reply({ error: "invalid_response" }, 502);
      return reply({ state: { ...result.state, revision: result.revision }, synthetic: false });
    }
    if (current.canonicalWorkId) return reply({ error: "authoritative_command_unavailable" }, 409);
    const next = applyCommercialCommand(current, command,
      { id: context.actor.id, name: context.actor.name,
        membershipId: context.actor.membershipId, role: context.actor.role },
      await hostedConfigurationInventory(workspace as WorkspaceKey), state as Record<string, unknown>);
    const nextState = { ...state, revision: loaded.revision + 1,
      records: records.map((record, position) => position === index ? next : record) };
    const saved = await context.save("work", loaded.revision, nextState);
    return reply({ state: { ...saved.state, revision: saved.revision }, synthetic: true });
  } catch (error) {
    if (error instanceof HostedStateError || error instanceof PrototypeWorkError)
      return reply({ error: error.code, message: error.message }, error.status);
    return reply({ error: "command_unavailable" }, 503);
  }
}
