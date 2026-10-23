import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/lib/d5o/auth/request-context";
import { assertProofEnvironment } from "@/lib/d5o/work-record/server";
import { crewPersonForUser, scheduleWorkspaceKeys } from "@/lib/d5o/scheduling/crew-identity";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { loadSchedule } from "@/lib/d5o/scheduling/store";
import { applyDeployCommand, deployCommandFingerprint, type DeployCommand } from "@/lib/d5o/prototype-work/deploy-command";
import { mutatePrototypeWork, loadPrototypeWork, PrototypeWorkError } from "@/lib/d5o/prototype-work/store";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import { deployWorkerProjection } from "@/lib/d5o/prototype-work/deploy-worker-projection";
import { loadConfigurationInventory } from "@/lib/d5o/configuration/server";
import { resolvePublishedPhaseConfiguration } from "@/components/d5o/platform/published-phase-configuration";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const root = path.join(process.cwd(), ".rybexos-local", "d5o-deploy-evidence-v1");
const types = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const storedPath = (workspace: string, workId: string, evidenceId: string) => path.join(root, workspace, createHash("sha256").update(workId).digest("hex"), evidenceId);
export async function POST(request: NextRequest) {
  try {
    assertProofEnvironment();
    const context = await getRequestContext();
    const workspace = context.status === "authorized" && context.workspace && context.membership?.status === "active" ? scheduleWorkspaceKeys[context.workspace.id] : undefined;
    if (!workspace || !context.user?.id || !context.membership) return reply({ error: "unauthorized" }, context.authenticated ? 403 : 401);
    if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
    const raw = await request.text(); if (raw.length > 100_000) return reply({ error: "command_too_large" }, 413);
    const command = JSON.parse(raw) as DeployCommand;
    if (!command?.workId || !Number.isInteger(command.expectedRevision) || !command.commandId || !command.action) return reply({ error: "invalid_command" }, 400);
    if (command.action === "attach-evidence") return reply({ error: "upload_required", message: "Upload actual file bytes through the evidence endpoint." }, 400);
    const actor = { id: context.user.id, name: context.profile?.displayName ?? context.user.name, membershipId: context.membership.id, role: context.membership.role, person: await crewPersonForUser(workspace, context.user.id) };
    const schedule = await loadSchedule(workspace);
    const prior = await loadPrototypeWork(workspace);
    const priorWork = prior.records.find((item) => item.id === command.workId) as WorkRecord | undefined;
    const replay = priorWork?.deploy?.events.find((event) => event.commandId === command.commandId);
    if (replay) {
      if (replay.actorId !== actor.id || replay.membershipId !== actor.membershipId || replay.fingerprint !== deployCommandFingerprint(command)) return reply({ error: "command_reuse_conflict" }, 409);
      if (actor.person) {
        const assignment = schedule.publications.flatMap((item) => item.assignments).find((item) => item.id === command.bookingId && item.workId === command.workId && item.people.includes(actor.person!));
        return reply({ state: { revision: prior.revision, records: assignment ? [deployWorkerProjection(priorWork!, assignment.packageId, assignment.id, actor.id)] : [] }, synthetic: true, replay: true });
      }
      return reply({ state: prior, synthetic: true, replay: true });
    }
    const inventory = await loadConfigurationInventory(context.workspace!.id);
    const state = await mutatePrototypeWork(workspace, command.expectedRevision, command.workId, (record, current) => {
      const work = record as WorkRecord, config = resolvePublishedPhaseConfiguration(inventory, workspace, work.type, work);
      if (work.phaseConfigurationVersionId && !config) throw new PrototypeWorkError("deploy_policy_unavailable", 409, "The pinned Deploy configuration is unavailable.");
      return applyDeployCommand(work, command, actor, schedule, undefined, config?.deployControls, current.records as WorkRecord[]) as unknown as Record<string, unknown>;
    });
    if (actor.person) {
      const assignment = schedule.publications.flatMap((item) => item.assignments).find((item) => item.id === command.bookingId && item.workId === command.workId && item.people.includes(actor.person!));
      const work = state.records.find((item) => item.id === command.workId) as WorkRecord | undefined;
      return reply({ state: { revision: state.revision, records: work && assignment ? [deployWorkerProjection(work, assignment.packageId, assignment.id, actor.id)] : [] }, synthetic: true });
    }
    return reply({ state, synthetic: true });
  } catch (error) {
    if (error instanceof PrototypeWorkError) return reply({ error: error.code, message: error.message }, error.status);
    return reply({ error: "deploy_command_unavailable" }, 503);
  }
}

export async function PUT(request: NextRequest) {
  let target = "";
  try {
    assertProofEnvironment();
    const context = await getRequestContext();
    const workspace = context.status === "authorized" && context.workspace && context.membership?.status === "active" ? scheduleWorkspaceKeys[context.workspace.id] : undefined;
    if (!workspace || !context.user?.id || !context.membership) return reply({ error: "unauthorized" }, context.authenticated ? 403 : 401);
    if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
    const form = await request.formData();
    const file = form.get("file"), workId = String(form.get("workId") ?? ""), packageId = String(form.get("packageId") ?? ""), bookingId = String(form.get("bookingId") ?? "");
    const expectedRevision = Number(form.get("expectedRevision")), purpose = String(form.get("purpose") ?? "").trim(), caption = String(form.get("caption") ?? "").trim();
    if (!(file instanceof File) || !types.has(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024 || !workId || !packageId || !Number.isInteger(expectedRevision) || !purpose || !caption) return reply({ error: "invalid_file", message: "Choose a JPEG, PNG, WebP or PDF up to 10 MB, with purpose and caption." }, 400);
    const actor = { id: context.user.id, name: context.profile?.displayName ?? context.user.name, membershipId: context.membership.id, role: context.membership.role, person: await crewPersonForUser(workspace, context.user.id) };
    const schedule = await loadSchedule(workspace);
    const inventory = await loadConfigurationInventory(context.workspace!.id);
    const bytes = Buffer.from(await file.arrayBuffer()), id = randomUUID();
    target = storedPath(workspace, workId, id);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
    const command: DeployCommand = { action: "attach-evidence", workId, packageId, bookingId, expectedRevision, commandId: randomUUID(), purpose, caption };
    const state = await mutatePrototypeWork(workspace, expectedRevision, workId, (record, current) => {
      const work = record as WorkRecord, config = resolvePublishedPhaseConfiguration(inventory, workspace, work.type, work);
      if (work.phaseConfigurationVersionId && !config) throw new PrototypeWorkError("deploy_policy_unavailable", 409, "The pinned Deploy configuration is unavailable.");
      return applyDeployCommand(work, command, actor, schedule, { id, filename: file.name.slice(0, 200), mimeType: file.type, sizeBytes: bytes.length, checksumSha256: createHash("sha256").update(bytes).digest("hex") }, config?.deployControls, current.records as WorkRecord[]) as unknown as Record<string, unknown>;
    });
    if (actor.person) {
      const assignment = schedule.publications.flatMap((item) => item.assignments).find((item) => item.id === bookingId && item.workId === workId && item.people.includes(actor.person!));
      const work = state.records.find((item) => item.id === workId) as WorkRecord | undefined;
      return reply({ evidenceId: id, state: { revision: state.revision, records: work && assignment ? [deployWorkerProjection(work, packageId, assignment.id, actor.id)] : [] }, synthetic: true });
    }
    return reply({ evidenceId: id, state, synthetic: true });
  } catch (error) {
    if (target) await rm(target, { force: true }).catch(() => undefined);
    if (error instanceof PrototypeWorkError) return reply({ error: error.code, message: error.message }, error.status);
    return reply({ error: "evidence_upload_unavailable" }, 503);
  }
}

export async function GET(request: NextRequest) {
  try {
    assertProofEnvironment();
    const context = await getRequestContext();
    const workspace = context.status === "authorized" && context.workspace && context.membership?.status === "active" ? scheduleWorkspaceKeys[context.workspace.id] : undefined;
    if (!workspace || !context.user?.id || !context.membership) return reply({ error: "unauthorized" }, context.authenticated ? 403 : 401);
    const workId = request.nextUrl.searchParams.get("workId") ?? "", evidenceId = request.nextUrl.searchParams.get("evidenceId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(evidenceId)) return reply({ error: "invalid_evidence" }, 400);
    const state = await loadPrototypeWork(workspace);
    const work = state.records.find((item) => item.id === workId) as WorkRecord | undefined;
    const evidence = work?.deploy?.evidence?.find((item) => item.id === evidenceId);
    if (!evidence) return reply({ error: "evidence_missing" }, 404);
    const person = await crewPersonForUser(workspace, context.user.id);
    const reviewer = new Set(["admin", "operations_leader", "project_manager", "field_supervisor"]);
    if (!reviewer.has(context.membership.role) && (evidence.uploaderId !== context.user.id || !person || !(await loadSchedule(workspace)).publications.some((publication) => publication.assignments.some((assignment) => assignment.workId === workId && assignment.packageId === evidence.packageId && assignment.people.includes(person))))) return reply({ error: "forbidden" }, 403);
    const bytes = await readFile(storedPath(workspace, workId, evidenceId));
    if (createHash("sha256").update(bytes).digest("hex") !== evidence.checksumSha256) return reply({ error: "integrity_failed" }, 409);
    return new Response(bytes, { headers: { "Content-Type": evidence.mimeType, "Content-Disposition": `inline; filename="${evidence.filename.replace(/[^\w. -]/g, "_")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return reply({ error: "evidence_unavailable" }, 503); }
}
