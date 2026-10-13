import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { NextRequest, NextResponse } from "next/server";
import { applyDeployCommand, deployCommandFingerprint, type DeployCommand } from "@/lib/d5o/prototype-work/deploy-command";
import { PrototypeWorkError } from "@/lib/d5o/prototype-work/store-error";
import { HostedStateError, hostedPrototypeContext } from "@/lib/d5o/hosted/prototype-context";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import type { SharedSchedule } from "@/components/d5o/platform/schedule-model";
import { hostedConfigurationInventory } from "@/lib/d5o/hosted/configuration-inventory";
import { resolvePublishedPhaseConfiguration } from "@/components/d5o/platform/published-phase-configuration";
import { createRybexSupabaseAdminClient } from "@/lib/d5o/auth/supabase-server";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { createHash, randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const bucket = "d5o-deploy-evidence";
const types = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const objectPath = (workspace: string, workId: string, id: string) => `${workspace}/${createHash("sha256").update(workId).digest("hex")}/${id}`;
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!["rybex", "rotork"].includes(workspace)) return reply({ error: "invalid_target" }, 400);
  const raw = await request.text(); if (raw.length > 100_000) return reply({ error: "command_too_large" }, 413);
  try {
    const command = JSON.parse(raw) as DeployCommand;
    if (!command?.workId || !Number.isInteger(command.expectedRevision) || !command.commandId || !command.action) return reply({ error: "invalid_command" }, 400);
    const context = await hostedPrototypeContext(workspace);
    if (!context.canEdit) return reply({ error: "workspace_forbidden" }, 403);
    const loaded = await context.read("work");
    if (!loaded.state) return reply({ error: "work_unavailable" }, 404);
    const records = loaded.state.records;
    if (!Array.isArray(records)) return reply({ error: "work_unavailable" }, 404);
    const index = records.findIndex((item) => item && typeof item === "object" && (item as WorkRecord).id === command.workId && (item as WorkRecord).workspace === workspace);
    if (index < 0) return reply({ error: "work_unavailable" }, 404);
    const selected = records[index] as WorkRecord;
    if (authoritativeD5OCommandsReady() && selected.canonicalWorkId) {
      if (!command.packageId || !Number.isInteger(command.expectedDesignRevision)
        || !Number.isInteger(command.expectedScheduleRevision)
        || !Number.isInteger(command.expectedDecisionRevision))
        return reply({ error: "invalid_decision_basis" }, 400);
      const client = await createRybexSupabaseServerClient();
      const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
        data: unknown; error: { code?: string; message: string } | null
      }>;
      const startAction = ["authorize-start", "hold", "resume"].includes(command.action);
      const factAction = ["save-report", "submit-report", "review-report", "record-inspection",
        "review-inspection", "review-completion"].includes(command.action);
      const evidenceAction = command.action === "review-evidence";
      const acceptanceAction = ["assemble-turnover", "accept-client", "accept-work",
        "respond-operate", "respond-operate-work"].includes(command.action);
      if (!startAction && !factAction && !evidenceAction && !acceptanceAction)
        return reply({ error: "authoritative_command_unavailable", message: "This action is not connected to the authenticated decision service." }, 409);
      const common = {
        p_workspace_key: workspace,p_presentation_id: command.workId,
        p_package_id: command.packageId,p_action: command.action,
        p_expected_source_revision: command.expectedRevision,
        p_expected_design_revision: command.expectedDesignRevision,
        p_expected_schedule_revision: command.expectedScheduleRevision,
        p_expected_deploy_revision: command.expectedDecisionRevision
      };
      const { data, error } = await call(startAction ? "d5o_hosted_field_start_command_v1"
        : evidenceAction ? "d5o_hosted_field_evidence_command_v1"
          : acceptanceAction ? "d5o_hosted_acceptance_command_v1" : "d5o_hosted_field_fact_command_v1",
      startAction ? { ...common, p_reason: command.note ?? "", p_command_id: command.commandId }
        : { ...(acceptanceAction ? {
          p_workspace_key: workspace, p_presentation_id: command.workId,
          p_package_id: command.packageId, p_action: command.action,
          p_expected_source_revision: command.expectedRevision,
          p_expected_design_revision: command.expectedDesignRevision,
          p_expected_deploy_revision: command.expectedDecisionRevision
        } : common), p_input: factAction ? {
          bookingId: command.bookingId, reportId: command.reportId, inspectionId: command.inspectionId,
          quantity: command.quantity, unit: command.unit, laborHours: command.laborHours,
          material: command.material, summary: command.summary, capturedAt: command.capturedAt,
          evidenceIds: command.evidenceIds,
          requirementId: command.requirementId, requirement: command.requirement,
          method: command.method, result: command.result, supersedesId: command.supersedesId,
          decision: command.decision, note: command.note
        } : acceptanceAction ? { turnoverId: command.turnoverId, operateOwner: command.operateOwner,
          obligations: command.obligations, signerName: command.signerName,
          signerOrganization: command.signerOrganization, signerRole: command.signerRole,
          authorityBasis: command.authorityBasis, source: command.source,
          evidenceId: command.evidenceId,
          conditions: command.conditions, exclusions: command.exclusions,
          decision: command.decision, note: command.note }
          : { evidenceId: command.evidenceId, decision: command.decision, note: command.note },
        p_command_id: command.commandId });
      if (error) return reply({ error: error.message, message: error.message },
        error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409 : 400);
      const result = data as { state?: Record<string, unknown>; revision?: number } | null;
      if (!result?.state || !Number.isInteger(result.revision)) return reply({ error: "invalid_response" }, 502);
      return reply({ state: { ...result.state, revision: result.revision }, synthetic: false });
    }
    const replay = (records[index] as WorkRecord).deploy?.events.find((event) => event.commandId === command.commandId);
    if (replay) {
      if (replay.actorId !== context.actor.id || replay.membershipId !== context.actor.membershipId || replay.fingerprint !== deployCommandFingerprint(command)) return reply({ error: "command_reuse_conflict" }, 409);
      return reply({ state: { ...loaded.state, revision: loaded.revision }, synthetic: true, replay: true });
    }
    if (loaded.revision !== command.expectedRevision) return reply({ error: "stale_state" }, 409);
    const schedule = (await context.read("schedule")).state as SharedSchedule | null;
    const actor = { ...context.actor, person: null }; // Hosted crew identity binding is not yet provisioned; field self-service remains blocked.
    const work = records[index] as WorkRecord;
    const config = resolvePublishedPhaseConfiguration(await hostedConfigurationInventory(workspace as WorkRecord["workspace"]), work.workspace, work.type, work);
    if (work.phaseConfigurationVersionId && !config) return reply({ error: "deploy_policy_unavailable" }, 409);
    const next = applyDeployCommand(work, command, actor, schedule, undefined, config?.deployControls, records as WorkRecord[]);
    const saved = await context.save("work", loaded.revision, { ...loaded.state, revision: loaded.revision + 1, records: records.map((item, i) => i === index ? next : item) });
    return reply({ state: { ...saved.state, revision: saved.revision }, synthetic: true });
  } catch (error) {
    if (error instanceof HostedStateError || error instanceof PrototypeWorkError) return reply({ error: error.code, message: error.message }, error.status);
    return reply({ error: "deploy_command_unavailable" }, 503);
  }
}

export async function PUT(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!["rybex", "rotork"].includes(workspace)) return reply({ error: "invalid_target" }, 400);
  let uploadedPath = "";
  let admin: ReturnType<typeof createRybexSupabaseAdminClient> | null = null;
  try {
    const context = await hostedPrototypeContext(workspace);
    if (!context.canEdit) return reply({ error: "workspace_forbidden" }, 403);
    admin = createRybexSupabaseAdminClient();
    const form = await request.formData(), file = form.get("file");
    const workId = String(form.get("workId") ?? ""), packageId = String(form.get("packageId") ?? ""), bookingId = String(form.get("bookingId") ?? "");
    const expectedRevision = Number(form.get("expectedRevision")), purpose = String(form.get("purpose") ?? "").trim(), caption = String(form.get("caption") ?? "").trim();
    if (!(file instanceof File) || !types.has(file.type) || file.size < 1 || file.size > 10_485_760 || !workId || !packageId || !purpose || !caption || !Number.isInteger(expectedRevision)) return reply({ error: "invalid_file" }, 400);
    const [loaded, scheduleResult] = await Promise.all([context.read("work"), context.read("schedule")]);
    const records = loaded.state?.records as WorkRecord[] | undefined;
    const index = records?.findIndex((item) => item.id === workId && item.workspace === workspace) ?? -1;
    if (index < 0 || !records) return reply({ error: "work_unavailable" }, 404);
    if (expectedRevision !== loaded.revision) return reply({ error: "stale_state" }, 409);
    const work = records[index], config = resolvePublishedPhaseConfiguration(await hostedConfigurationInventory(workspace as WorkRecord["workspace"]), work.workspace, work.type, work);
    if (authoritativeD5OCommandsReady() && work.canonicalWorkId)
      return reply({ error: "worker_upload_required", message: "The assigned worker must upload this package evidence from My assigned work." }, 403);
    if (work.phaseConfigurationVersionId && !config) return reply({ error: "deploy_policy_unavailable" }, 409);
    const bytes = Buffer.from(await file.arrayBuffer()), id = randomUUID();
    uploadedPath = objectPath(workspace, workId, id);
    const uploaded = await admin.storage.from(bucket).upload(uploadedPath, bytes, { contentType: file.type, upsert: false });
    if (uploaded.error) throw new HostedStateError("evidence_storage_unavailable", 503);
    const command: DeployCommand = { action: "attach-evidence", workId, packageId, bookingId, expectedRevision, commandId: randomUUID(), purpose, caption };
    const next = applyDeployCommand(work, command, { ...context.actor, person: null }, scheduleResult.state as SharedSchedule | null, { id, filename: file.name.slice(0, 200), mimeType: file.type, sizeBytes: bytes.length, checksumSha256: createHash("sha256").update(bytes).digest("hex") }, config?.deployControls, records);
    const saved = await context.save("work", loaded.revision, { ...loaded.state, revision: loaded.revision + 1, records: records.map((item, i) => i === index ? next : item) });
    return reply({ evidenceId: id, state: { ...saved.state, revision: saved.revision }, synthetic: true });
  } catch (error) {
    if (uploadedPath && admin) await admin.storage.from(bucket).remove([uploadedPath]);
    if (error instanceof HostedStateError || error instanceof PrototypeWorkError) return reply({ error: error.code, message: error.message }, error.status);
    return reply({ error: "evidence_upload_unavailable" }, 503);
  }
}

export async function GET(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!["rybex", "rotork"].includes(workspace)) return reply({ error: "invalid_target" }, 400);
  try {
    const context = await hostedPrototypeContext(workspace);
    if (!context.canEdit) return reply({ error: "workspace_forbidden" }, 403);
    const workId = request.nextUrl.searchParams.get("workId") ?? "", id = request.nextUrl.searchParams.get("evidenceId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply({ error: "invalid_evidence" }, 400);
    const loaded = await context.read("work");
    const work = (loaded.state?.records as WorkRecord[] | undefined)?.find((item) => item.id === workId && item.workspace === workspace);
    const evidence = work?.deploy?.evidence.find((item) => item.id === id);
    if (!evidence) return reply({ error: "evidence_missing" }, 404);
    const file = await createRybexSupabaseAdminClient().storage.from(bucket).download(objectPath(workspace, workId, id));
    if (file.error || !file.data) return reply({ error: "evidence_unavailable" }, 503);
    const bytes = Buffer.from(await file.data.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== evidence.checksumSha256) return reply({ error: "integrity_failed" }, 409);
    return new Response(bytes, { headers: { "Content-Type": evidence.mimeType, "Content-Disposition": `inline; filename="${evidence.filename.replace(/[^\w. -]/g, "_")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    if (error instanceof HostedStateError) return reply({ error: error.code }, error.status);
    return reply({ error: "evidence_unavailable" }, 503);
  }
}
