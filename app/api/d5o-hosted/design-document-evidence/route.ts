import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import { createRybexSupabaseAdminClient } from "@/lib/d5o/auth/supabase-server";
import { HostedStateError, hostedPrototypeContext } from "@/lib/d5o/hosted/prototype-context";
import { hostedWorkerContext } from "@/lib/d5o/hosted/worker-context";
import type { SharedSchedule } from "@/components/d5o/platform/schedule-model";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { d5oCommandRuntime } from "@/lib/d5o/auth/hosted-target";

export const dynamic = "force-dynamic";
const bucket = "d5o-deploy-evidence";
const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" }
});
const pathFor = (workspace: string, workId: string, id: string) =>
  `${workspace}/${createHash("sha256").update(workId).digest("hex")}/design-documents/${id}`;

async function target(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  const isolatedOrigin = process.env.D5O_ISOLATED_APP_ORIGIN;
  const isolatedCustomer = process.env.NODE_ENV === "development" &&
    d5oCommandRuntime() === "pilot" && !!isolatedOrigin &&
    request.headers.get("origin") === isolatedOrigin &&
    new URL(isolatedOrigin).hostname === "127.0.0.1";
  if (!["rybex", "rotork"].includes(workspace) && !isolatedCustomer) return null;
  const context = await hostedPrototypeContext(workspace);
  if (!["admin", "project_manager", "operations_leader"].includes(context.actor.role)) return null;
  const workId = request.nextUrl.searchParams.get("workId") ?? "";
  const documentId = request.nextUrl.searchParams.get("documentId") ?? "";
  const revision = Number(request.nextUrl.searchParams.get("revision"));
  const loaded = await context.read("work");
  const work = (loaded.state?.records as WorkRecord[] | undefined)?.find((item) =>
    item.id === workId && item.workspace === workspace && !!item.canonicalWorkId);
  const document = work?.design?.documents.find((item) =>
    item.id === documentId && item.revision === revision);
  if (!work || !document) return null;
  return { workspace, context, workId, documentId, revision, document };
}

async function assignedWorkerTarget(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (workspace !== "rybex") return null;
  const worker = await hostedWorkerContext(workspace);
  const workId = request.nextUrl.searchParams.get("workId") ?? "";
  const documentId = request.nextUrl.searchParams.get("documentId") ?? "";
  const revision = Number(request.nextUrl.searchParams.get("revision"));
  if (!workId || !documentId || !Number.isInteger(revision) || revision < 1) return null;
  const [workResult, scheduleResult] = await Promise.all([worker.read("work"), worker.read("schedule")]);
  const work = (workResult.state?.records as WorkRecord[] | undefined)?.find((item) =>
    item.id === workId && item.workspace === workspace && !!item.canonicalWorkId);
  const schedule = scheduleResult.state as SharedSchedule | null;
  if (!work || !schedule) return null;
  const reference = `${documentId}@${revision}`;
  const release = work.design?.releases.findLast((item) => item.status === "Accepted" &&
    item.documentRefs.includes(reference) &&
    item.packageRevision === work.design?.packages.find((detail) => detail.packageId === item.packageId)?.revision);
  if (!release || !release.documentSnapshots.some((item) => item.id === documentId &&
    item.revision === revision && item.status === "Issued for use")) return null;
  const assigned = schedule.publications.some((publication) =>
    schedule.publications.filter((item) => item.week === publication.week).at(-1)?.id === publication.id &&
    publication.assignments.some((booking) => booking.workId === workId &&
      booking.packageId === release.packageId && booking.people.includes(worker.person)));
  return assigned ? { workspace, workId, documentId, revision } : null;
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  let uploadedPath = "";
  try {
    const scoped = await target(request);
    if (!scoped || !["admin", "project_manager"].includes(scoped.context.actor.role) ||
      scoped.document.status !== "Draft") return reply({ error: "design_document_upload_denied" }, 403);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.type !== "application/pdf" ||
      file.size < 1 || file.size > 10_485_760)
      return reply({ error: "design_pdf_required" }, 400);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-" ||
      !bytes.subarray(-32).toString("ascii").includes("%%EOF"))
      return reply({ error: "design_pdf_required" }, 400);
    const id = randomUUID(), checksum = createHash("sha256").update(bytes).digest("hex");
    uploadedPath = pathFor(scoped.workspace, scoped.workId, id);
    const admin = createRybexSupabaseAdminClient();
    const saved = await admin.storage.from(bucket).upload(uploadedPath, bytes, {
      contentType: "application/pdf", upsert: false
    });
    if (saved.error) return reply({ error: "private_upload_failed" }, 503);
    const verified = await admin.storage.from(bucket).download(uploadedPath);
    if (verified.error || !verified.data ||
      createHash("sha256").update(Buffer.from(await verified.data.arrayBuffer())).digest("hex") !== checksum)
      throw new Error("uploaded_bytes_changed");
    const call = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
      data: unknown; error: { message: string } | null
    }>;
    const { data, error } = await call("d5o_hosted_register_design_document_evidence_v1", {
      p_workspace_key: scoped.workspace,p_presentation_id: scoped.workId,
      p_document_id: scoped.documentId,p_document_revision: scoped.revision,
      p_evidence_id: id,p_checksum_sha256: checksum,p_filename: file.name,
      p_uploader_id: scoped.context.actor.id
    });
    if (error) throw new Error(error.message);
    return reply(data);
  } catch (error) {
    if (uploadedPath) await createRybexSupabaseAdminClient().storage.from(bucket).remove([uploadedPath]);
    if (error instanceof HostedStateError) return reply({ error: error.code }, error.status);
    if (error instanceof Error && error.message === "unauthenticated") return reply({ error: "unauthenticated" }, 401);
    return reply({ error: "design_document_upload_unavailable" }, 503);
  }
}

export async function GET(request: NextRequest) {
  try {
    const scoped = await target(request) ?? await assignedWorkerTarget(request);
    if (!scoped) return reply({ error: "design_document_scope_denied" }, 403);
    const admin = createRybexSupabaseAdminClient();
    const call = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
      data: unknown; error: { message: string } | null
    }>;
    const { data, error } = await call("d5o_hosted_design_document_evidence_read_v1", {
      p_workspace_key: scoped.workspace,p_presentation_id: scoped.workId,
      p_document_id: scoped.documentId,p_document_revision: scoped.revision
    });
    if (error || !data || typeof data !== "object") return reply({ error: "design_document_missing" }, 404);
    const receipt = data as { evidenceId: string; objectPath: string; checksumSha256: string;
      filename: string; sizeBytes: number; uploadedBy: string; uploadedAt: string };
    if (request.nextUrl.searchParams.get("download") !== "1") return reply({
      evidenceId: receipt.evidenceId,checksumSha256: receipt.checksumSha256,
      filename: receipt.filename,sizeBytes: receipt.sizeBytes,
      uploadedBy: receipt.uploadedBy,uploadedAt: receipt.uploadedAt
    });
    const file = await admin.storage.from(bucket).download(receipt.objectPath);
    if (file.error || !file.data) return reply({ error: "design_document_missing" }, 503);
    const bytes = Buffer.from(await file.data.arrayBuffer());
    if (bytes.length !== receipt.sizeBytes ||
      createHash("sha256").update(bytes).digest("hex") !== receipt.checksumSha256)
      return reply({ error: "integrity_failed" }, 409);
    return new Response(bytes, { headers: {
      "Content-Type": "application/pdf", "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="${receipt.filename.replace(/[^\w. -]/g, "_")}"`,
      "X-Content-Type-Options": "nosniff"
    } });
  } catch (error) {
    if (error instanceof HostedStateError && error.status === 403) return reply({ error: "design_document_scope_denied" }, 403);
    if (error instanceof Error && error.message === "unauthenticated") return reply({ error: "unauthenticated" }, 401);
    return reply({ error: "design_document_unavailable" }, 503);
  }
}
