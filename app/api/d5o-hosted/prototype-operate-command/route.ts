import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { NextRequest, NextResponse } from "next/server";
import { HostedStateError, hostedPrototypeContext } from "@/lib/d5o/hosted/prototype-context";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { applyOperateCommand, operateCommandFingerprint, type OperateCommand } from "@/lib/d5o/prototype-work/operate-command";
import { PrototypeWorkError } from "@/lib/d5o/prototype-work/store-error";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import { hostedConfigurationInventory } from "@/lib/d5o/hosted/configuration-inventory";
import { resolvePublishedPhaseConfiguration } from "@/components/d5o/platform/published-phase-configuration";
import { createRybexSupabaseAdminClient, createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!["rybex", "rotork"].includes(workspace)) return reply({ error: "invalid_workspace" }, 400);
  try {
    const raw = await request.text(); if (raw.length > 100_000) return reply({ error: "command_too_large" }, 413);
    const command = JSON.parse(raw) as OperateCommand;
    if (!command?.workId || !command.action || !command.commandId || !Number.isInteger(command.expectedRevision)) return reply({ error: "invalid_command" }, 400);
    const context = await hostedPrototypeContext(workspace);
    if (!context.canEdit && !(command.action === "update-finance" && context.actor.role === "billing_commercial_lead"))
      return reply({ error: "workspace_forbidden" }, 403);
    const loaded = await context.read("work"), records = loaded.state?.records as WorkRecord[] | undefined;
    const index = records?.findIndex((item) => item.id === command.workId && item.workspace === workspace) ?? -1;
    if (!records || index < 0) return reply({ error: "work_unavailable" }, 404);
    const selected = records[index];
    if (command.action === "link-existing-asset" &&
      (!authoritativeD5OCommandsReady() || !selected.canonicalWorkId))
      return reply({ error: "authoritative_command_unavailable" }, 409);
    if (authoritativeD5OCommandsReady() && selected.canonicalWorkId) {
      if (command.action === "link-existing-asset") {
        if (!command.sourceWorkId || !command.assetId || !command.note ||
          !Number.isInteger(command.expectedDeployRevision) ||
          !Number.isInteger(command.expectedDecisionRevision) ||
          !Number.isInteger(command.expectedOwnerOperateRevision))
          return reply({ error: "asset_link_basis_missing" }, 400);
        const session = await createRybexSupabaseServerClient();
        const call = session.rpc.bind(session) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
          data: unknown; error: { code?: string; message: string } | null
        }>;
        const { data, error } = await call("d5o_hosted_link_existing_asset_v1", {
          p_workspace_key: workspace,p_target_presentation_id: command.workId,
          p_owner_presentation_id: command.sourceWorkId,p_asset_id: command.assetId,
          p_note: command.note,p_command_id: command.commandId,
          p_expected_source_revision: command.expectedRevision,
          p_expected_target_deploy_revision: command.expectedDeployRevision,
          p_expected_target_operate_revision: command.expectedDecisionRevision,
          p_expected_owner_operate_revision: command.expectedOwnerOperateRevision
        });
        if (error) return reply({ error: error.message, message: error.message },
          error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409 : 400);
        const result = data as { state?: Record<string, unknown>; revision?: number } | null;
        if (!result?.state || !Number.isInteger(result.revision)) return reply({ error: "invalid_response" }, 502);
        return reply({ state: { ...result.state, revision: result.revision }, synthetic: false });
      }
      if (command.action === "submit-support-document" || command.action === "review-support-document") {
        if (!command.turnoverId || !command.documentKind || !command.evidenceId ||
          !Number.isInteger(command.expectedDeployRevision) ||
          !Number.isInteger(command.expectedDecisionRevision))
          return reply({ error: "support_document_basis_missing" }, 400);
        const session = await createRybexSupabaseServerClient();
        const call = session.rpc.bind(session) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
          data: unknown; error: { code?: string; message: string } | null
        }>;
        const { data, error } = await call("d5o_hosted_support_document_command_v1", {
          p_workspace_key: workspace,p_presentation_id: command.workId,
          p_action: command.action === "submit-support-document" ? "submit" : "review",
          p_turnover_id: command.turnoverId,p_kind: command.documentKind,
          p_evidence_id: command.evidenceId,p_decision: command.decision ?? null,
          p_note: command.note ?? "",p_command_id: command.commandId,
          p_expected_source_revision: command.expectedRevision,
          p_expected_deploy_revision: command.expectedDeployRevision,
          p_expected_operate_revision: command.expectedDecisionRevision
        });
        if (error) return reply({ error: error.message, message: error.message },
          error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409 : 400);
        const result = data as { state?: Record<string, unknown>; revision?: number } | null;
        if (!result?.state || !Number.isInteger(result.revision)) return reply({ error: "invalid_response" }, 502);
        return reply({ state: { ...result.state, revision: result.revision }, synthetic: false });
      }
      if (["save-service-estimate", "submit-service-pricing", "approve-service-pricing",
        "return-service-pricing", "record-service-authorization"].includes(command.action)) {
        if (!command.requestId || !Number.isInteger(command.expectedDecisionRevision))
          return reply({ error: "service_pricing_basis_missing" }, 400);
        const session = await createRybexSupabaseServerClient();
        const call = session.rpc.bind(session) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
          data: unknown; error: { code?: string; message: string } | null
        }>;
        const { data, error } = await call("d5o_hosted_service_pricing_command_v1", {
          p_workspace_key: workspace,p_parent_presentation_id: command.workId,
          p_request_id: command.requestId,p_action: command.action,
          p_input: { pricingInput: command.pricingInput,estimateRevision: command.estimateRevision,
            note: command.note,source: command.source,customerParty: command.customerParty,
            customerOrganization: command.customerOrganization,
            customerRole: command.customerRole,authorityBasis: command.authorityBasis,
            outcome: command.outcome,conditions: command.conditions,
            exclusions: command.exclusions,evidenceId: command.evidenceId },
          p_command_id: command.commandId,p_expected_work_revision: command.expectedRevision,
          p_expected_operate_revision: command.expectedDecisionRevision
        });
        if (error) return reply({ error: error.message, message: error.message },
          error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409 : 400);
        const result = data as { state?: Record<string, unknown>; revision?: number } | null;
        if (!result?.state || !Number.isInteger(result.revision)) return reply({ error: "invalid_response" }, 502);
        return reply({ state: { ...result.state, revision: result.revision }, synthetic: false });
      }
      if (["link-execution", "complete-job", "resolve-request", "close-request"].includes(command.action)) {
        const jobs = selected.operate?.jobs ?? [];
        const request = selected.operate?.requests.find((item) => item.id === command.requestId);
        const job = command.action === "link-execution" || command.action === "complete-job"
          ? jobs.find((item) => item.id === command.id)
          : jobs.find((item) => item.id === request?.currentCycleJobIds?.[0] && item.requestId === request?.id);
        const child = records.find((item) => item.id === job?.workId && item.serviceSource?.parentWorkId === selected.id);
        if (!job || !child?.canonicalWorkId || !Number.isInteger(command.expectedDecisionRevision)
          || !Number.isInteger(command.expectedServiceDeployRevision))
          return reply({ error: "service_execution_basis_missing" }, 409);
        const session = await createRybexSupabaseServerClient();
        const call = session.rpc.bind(session) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
          data: unknown; error: { code?: string; message: string } | null
        }>;
        const { data, error } = await call("d5o_hosted_service_return_command_v1", {
          p_workspace_key: workspace,p_parent_presentation_id: command.workId,p_action: command.action,
          p_input: { jobId: job.id,requestId: request?.id ?? job.requestId,
            note: command.note,resolution: command.resolution },
          p_command_id: command.commandId,p_expected_work_revision: command.expectedRevision,
          p_expected_operate_revision: command.expectedDecisionRevision,
          p_expected_child_deploy_revision: command.expectedServiceDeployRevision
        });
        if (error) return reply({ error: error.message, message: error.message },
          error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409 : 400);
        const result = data as { state?: Record<string, unknown>; revision?: number } | null;
        if (!result?.state || !Number.isInteger(result.revision)) return reply({ error: "invalid_response" }, 502);
        return reply({ state: { ...result.state, revision: result.revision }, synthetic: false });
      }
      if (command.action === "accept-asset") {
        if (!command.assetId || !command.source || !command.note
          || !Number.isInteger(command.expectedDecisionRevision))
          return reply({ error: "invalid_asset_acceptance" }, 400);
        const session = await createRybexSupabaseServerClient();
        const call = session.rpc.bind(session) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
          data: unknown; error: { code?: string; message: string } | null
        }>;
        const { data, error } = await call("d5o_hosted_accept_supported_asset_v1", {
          p_workspace_key: workspace,p_parent_presentation_id: command.workId,
          p_asset_id: command.assetId,p_documentation_source: command.source,
          p_reason: command.note,p_command_id: command.commandId,
          p_expected_source_revision: command.expectedRevision,
          p_expected_operate_revision: command.expectedDecisionRevision
        });
        if (error) return reply({ error: error.message, message: error.message },
          error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409 : 400);
        const result = data as { state?: Record<string, unknown>; revision?: number } | null;
        if (!result?.state || !Number.isInteger(result.revision)) return reply({ error: "invalid_response" }, 502);
        return reply({ state: { ...result.state, revision: result.revision }, synthetic: false });
      }
      if (command.action === "create-job") {
        if (!command.requestId || !command.dueDate || !Number.isInteger(command.expectedDecisionRevision))
          return reply({ error: "invalid_service_job_basis" }, 400);
        const catalog = await context.read("catalog");
        const session = await createRybexSupabaseServerClient();
        const call = session.rpc.bind(session) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
          data: unknown; error: { code?: string; message: string } | null
        }>;
        const { data, error } = await call("d5o_hosted_service_job_command_v1", {
          p_workspace_key: workspace,p_parent_presentation_id: command.workId,
          p_request_id: command.requestId,p_due_date: command.dueDate,
          p_owner: command.owner ?? context.actor.name,p_command_id: command.commandId,
          p_expected_work_revision: command.expectedRevision,
          p_expected_catalog_revision: catalog.revision,
          p_expected_operate_revision: command.expectedDecisionRevision
        });
        if (error) return reply({ error: error.message, message: error.message },
          error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409 : 400);
        const saved = await context.read("work");
        return reply({ state: { ...saved.state, revision: saved.revision },
          relatedIdentity: data, synthetic: false });
      }
      if (!["receive-handoff", "add-asset", "accept-support", "activate", "add-agreement",
        "approve-agreement", "open-request", "triage-request", "update-finance"].includes(command.action))
        return reply({ error: "authoritative_command_unavailable", message: "This Operate action is not connected to the authenticated decision service." }, 409);
      if (!Number.isInteger(command.expectedDeployRevision) || !Number.isInteger(command.expectedDecisionRevision))
        return reply({ error: "invalid_decision_basis" }, 400);
      const session = await createRybexSupabaseServerClient();
      const call = session.rpc.bind(session) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
        data: unknown; error: { code?: string; message: string } | null
      }>;
      const { data, error } = await call("d5o_hosted_operate_command_v1", {
        p_workspace_key: workspace,p_presentation_id: command.workId,p_action: command.action,
        p_input: { note: command.note,workAcceptanceId: selected.deploy?.workAcceptance?.id,
          workAcceptanceRevision: selected.deploy?.workAcceptance?.revision,
          name: command.name,kind: command.kind,location: command.location,
          externalId: command.externalId,owner: command.owner,documentation: command.documentation,
          customerContact: command.customerContact,escalation: command.escalation,
          intakeRoute: command.intakeRoute,warrantyDisposition: command.warrantyDisposition,
          serviceDisposition: command.serviceDisposition,residualOwner: command.residualOwner,
          assetId: command.assetId,effectiveFrom: command.effectiveFrom,
          effectiveTo: command.effectiveTo,includes: command.includes,excludes: command.excludes,
          serviceCategories: command.serviceCategories,laborCovered: command.laborCovered,
          partsCovered: command.partsCovered,travelCovered: command.travelCovered,
          responseHours: command.responseHours,calendar: command.calendar,source: command.source,
          agreementId: command.id,title: command.title,description: command.description,
          impact: command.impact,contact: command.contact,requestId: command.requestId,
          serviceCategory: command.serviceCategory ?? command.kind,status: command.status },
        p_command_id: command.commandId,p_expected_source_revision: command.expectedRevision,
        p_expected_deploy_revision: command.expectedDeployRevision,
        p_expected_operate_revision: command.expectedDecisionRevision
      });
      if (error) return reply({ error: error.message, message: error.message },
        error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409 : 400);
      const result = data as { state?: Record<string, unknown>; revision?: number } | null;
      if (!result?.state || !Number.isInteger(result.revision)) return reply({ error: "invalid_response" }, 502);
      return reply({ state: { ...result.state, revision: result.revision }, synthetic: false });
    }
    const replay = records[index].operate?.events.find((item) => item.commandId === command.commandId);
    if (replay) {
      if (replay.actorId !== context.actor.id || replay.membershipId !== context.actor.membershipId || replay.fingerprint !== operateCommandFingerprint(command)) return reply({ error: "command_reuse_conflict" }, 409);
      return reply({ state: { ...loaded.state, revision: loaded.revision }, synthetic: true, replay: true });
    }
    if (loaded.revision !== command.expectedRevision) return reply({ error: "stale_state" }, 409);
    const config = resolvePublishedPhaseConfiguration(await hostedConfigurationInventory(workspace as WorkRecord["workspace"]), records[index].workspace, records[index].type, records[index]);
    if (records[index].phaseConfigurationVersionId && !config) return reply({ error: "operate_policy_unavailable", message: "The exact pinned Operate configuration is unavailable." }, 409);
    const changed = applyOperateCommand(records[index], records, command, context.actor, config?.operateControls, loaded.state ?? undefined);
    if (changed.related && records.some((item) => item.id === changed.related?.id)) return reply({ error: "related_work_conflict" }, 409);
    const relatedIndex = changed.updatedRelated ? records.findIndex((item) => item.id === changed.updatedRelated?.id) : -1;
    if (changed.updatedRelated && (relatedIndex < 0 || relatedIndex === index || changed.updatedRelated.workspace !== workspace || changed.updatedRelated.serviceSource?.parentWorkId !== command.workId || records[relatedIndex].serviceSource?.parentWorkId !== command.workId)) return reply({ error: "related_work_conflict" }, 409);
    const next = records.map((item, i) => i === index ? changed.work : item);
    if (changed.updatedRelated) next[relatedIndex] = changed.updatedRelated;
    if (authoritativeD5OCommandsReady() && changed.related) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(command.commandId)
        || !records[index].canonicalWorkId)
        return reply({ error: "canonical_parent_required" }, 409);
      const catalog = await context.read("catalog");
      const admin = createRybexSupabaseAdminClient();
      const call = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) =>
        Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
      const created = await call("d5o_hosted_create_related_work_v1", {
        p_workspace_key: workspace, p_command_id: command.commandId,
        p_action: command.action, p_parent_presentation_id: command.workId,
        p_expected_work_revision: loaded.revision,
        p_expected_catalog_revision: catalog.revision,
        p_parent_after: changed.work, p_child: changed.related,
        p_actor_user_id: context.actor.id, p_membership_id: context.actor.membershipId
      });
      if (created.error) return reply({ error: created.error.message },
        created.error.code === "23505" ? 409 : created.error.code === "42501" ? 403 :
          created.error.code === "22023" ? 422 : 503);
      const saved = await context.read("work");
      return reply({ state: { ...saved.state, revision: saved.revision },
        relatedIdentity: created.data, synthetic: true });
    }
    if (changed.related) next.push(changed.related);
    const saved = await context.save("work", loaded.revision, { ...loaded.state, revision: loaded.revision + 1, records: next });
    return reply({ state: { ...saved.state, revision: saved.revision }, synthetic: true });
  } catch (error) {
    if (error instanceof PrototypeWorkError || error instanceof HostedStateError) return reply({ error: error.code, message: error.message }, error.status);
    return reply({ error: "operate_command_unavailable" }, 503);
  }
}
