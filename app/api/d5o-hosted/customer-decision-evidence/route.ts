import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import { createRybexSupabaseAdminClient, createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { hostedPrototypeContext } from "@/lib/d5o/hosted/prototype-context";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
const bucket = "d5o-deploy-evidence";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const pathFor = (workspace: string, workId: string, id: string) =>
  `${workspace}/${createHash("sha256").update(workId).digest("hex")}/customer-decisions/${id}`;
type Purpose = "package-acceptance" | "work-acceptance" | "service-authorization" | "field-change-authorization" | "service-billing-terms" | "support-as-built" | "support-inspection";

function exactBasis(work: WorkRecord, purpose: Purpose, scopeId: string) {
  if (purpose === "support-as-built" || purpose === "support-inspection") {
    const acceptance = work.deploy?.workAcceptance;
    const turnover = work.deploy?.turnovers.find((item) => item.id === scopeId);
    const kind = purpose === "support-as-built" ? "as-built" : "inspection";
    const release = work.design?.releases.find((item) =>
      turnover?.releaseIds.length === 1 && item.id === turnover.releaseIds[0] && item.status === "Accepted");
    if (!acceptance || acceptance.receipt !== "Accepted" ||
      !acceptance.turnoverIds.includes(scopeId) || !turnover ||
      turnover.status !== "Client accepted" || turnover.receipt !== "Accepted" || !release ||
      work.operate?.source?.workAcceptanceId !== acceptance.id ||
      work.operate.source.revision !== acceptance.revision ||
      !turnover.obligations.toLowerCase().includes(kind === "as-built" ? "as-built" : "inspection"))
      return null;
    return { scopeRevision: turnover.revision, basis: {
      turnoverId: turnover.id, turnoverRevision: turnover.revision,
      packageId: release.packageId, releaseId: release.id,
      releaseRevision: release.packageRevision,
      workAcceptanceId: acceptance.id, workAcceptanceRevision: acceptance.revision,
      kind
    } };
  }
  if (purpose === "package-acceptance") {
    const turnover = work.deploy?.turnovers.find((item) => item.id === scopeId && item.status === "Draft");
    if (!turnover || !work.design?.authorityRevision) return null;
    return { scopeRevision: turnover.revision, basis: {
      releaseIds: turnover.releaseIds, designRevision: work.design.authorityRevision
    } };
  }
  if (purpose === "work-acceptance") {
    if (scopeId !== work.id || !work.design?.authorityRevision) return null;
    const packages = work.design.packages ?? [];
    const turnovers = packages.map((item) => work.deploy?.turnovers.find((turnover) =>
      turnover.status === "Client accepted" && turnover.releaseIds.some((id) =>
        work.design?.releases.some((release) => release.id === id && release.packageId === item.packageId && release.status === "Accepted"))));
    if (!turnovers.length || turnovers.some((item) => !item)) return null;
    return { scopeRevision: 1, basis: {
      turnoverIds: turnovers.map((item) => item!.id),
      releaseIds: turnovers.flatMap((item) => item!.releaseIds),
      designRevision: work.design.authorityRevision
    } };
  }
  const request = work.operate?.requests.find((item) => item.id === scopeId);
  const estimate = request?.serviceEstimate;
  if (!request || !estimate || estimate.status !== "Approved" ||
    estimate.requestCycleAt !== (request.reopenedAt ?? request.reportedAt)) return null;
  return { scopeRevision: estimate.revision, basis: {
    estimateRevision: estimate.revision, amountMinor: estimate.evaluation.proposedPriceMinor,
    currency: estimate.evaluation.currency,
    requestCycleAt: request.reopenedAt ?? request.reportedAt
  } };
}

async function scope(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!["rybex", "rotork"].includes(workspace)) return null;
  const context = await hostedPrototypeContext(workspace);
  if (!["project_manager", "operations_leader", "field_supervisor", "billing_commercial_lead"].includes(context.actor.role)) return null;
  return { workspace, context };
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  let uploadedPath = "";
  try {
    const target = await scope(request);
    if (!target || target.context.actor.role === "billing_commercial_lead")
      return reply({ error: "customer_evidence_authority_required" }, 403);
    const form = await request.formData();
    const file = form.get("file"), workId = String(form.get("workId") ?? "");
    const purpose = String(form.get("purpose") ?? "") as Purpose;
    const scopeId = String(form.get("scopeId") ?? "");
    if (!(file instanceof File) || file.type !== "application/pdf" || file.size < 1 ||
      file.size > 10_485_760 || !workId || !scopeId ||
      !["package-acceptance", "work-acceptance", "service-authorization", "field-change-authorization", "service-billing-terms", "support-as-built", "support-inspection"].includes(purpose))
      return reply({ error: "signed_pdf_required" }, 400);
    const loaded = await target.context.read("work");
    const work = (loaded.state?.records as WorkRecord[] | undefined)?.find((item) =>
      item.id === workId && item.workspace === target.workspace && !!item.canonicalWorkId);
    if (!work) return reply({ error: "canonical_work_required" }, 404);
    let exact: { scopeRevision: number; basis: Record<string, unknown> } | null =
      purpose === "field-change-authorization" || purpose === "service-billing-terms"
        ? null : exactBasis(work, purpose, scopeId);
    if (purpose === "service-billing-terms") {
      if (target.context.actor.role !== "project_manager")
        return reply({ error: "service_billing_terms_role_required" }, 403);
      const session = await createRybexSupabaseServerClient();
      const read = session.rpc.bind(session) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      const { data, error } = await read("d5o_hosted_service_finance_read_v1", {
        p_workspace_key: target.workspace, p_parent_presentation_id: workId,
        p_request_id: scopeId
      });
      const source = !error && data && typeof data === "object"
        ? (data as { termsSource?: Record<string, unknown> }).termsSource : undefined;
      if (source?.eligibleForFinanceReview === true && Number.isInteger(Number(source.estimateRevision)))
        exact = { scopeRevision: Number(source.estimateRevision), basis: source };
    }
    if (purpose === "field-change-authorization") {
      const session = await createRybexSupabaseServerClient();
      const read = session.rpc.bind(session) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      const { data, error } = await read("d5o_hosted_field_change_read_v1", {
        p_workspace_key: target.workspace, p_presentation_id: workId
      });
      const change = !error && data && typeof data === "object" ?
        (data as { changes?: Array<{ id: string; packageId: string; revision: number; status: string; facts: Record<string, unknown> }> }).changes?.find((item) => item.id === scopeId) : undefined;
      if (change?.status === "Internally approved") exact = { scopeRevision: change.revision,
        basis: { packageId: change.packageId, proposal: change.facts.proposal,
          internalReview: change.facts.internalReview } };
    }
    if ((purpose === "support-as-built" || purpose === "support-inspection") &&
      !["project_manager", "field_supervisor"].includes(target.context.actor.role))
      return reply({ error: "support_document_supplier_required" }, 403);
    if (!exact) return reply({ error: "current_decision_scope_required" }, 409);
    const id = randomUUID(), bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-" || !bytes.subarray(-32).toString("ascii").includes("%%EOF"))
      return reply({ error: "signed_pdf_required" }, 400);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    uploadedPath = pathFor(target.workspace, workId, id);
    const admin = createRybexSupabaseAdminClient();
    const saved = await admin.storage.from(bucket).upload(uploadedPath, bytes, {
      contentType: "application/pdf", upsert: false
    });
    if (saved.error) return reply({ error: "private_upload_failed" }, 503);
    const verified = await admin.storage.from(bucket).download(uploadedPath);
    if (verified.error || !verified.data ||
      createHash("sha256").update(Buffer.from(await verified.data.arrayBuffer())).digest("hex") !== checksum)
      throw new Error("uploaded_bytes_changed");
    const call = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    const supportDocument = purpose === "support-as-built" || purpose === "support-inspection";
    const { data, error } = await call(supportDocument
      ? "d5o_hosted_register_support_document_v1"
      : "d5o_hosted_register_customer_decision_evidence_v1", supportDocument ? {
      p_workspace_key: target.workspace,p_presentation_id: workId,p_evidence_id: id,
      p_turnover_id: scopeId,p_kind: purpose === "support-as-built" ? "as-built" : "inspection",
      p_basis: exact.basis,p_checksum_sha256: checksum,p_filename: file.name,
      p_uploader_id: target.context.actor.id
    } : {
      p_workspace_key: target.workspace,p_presentation_id: workId,p_evidence_id: id,
      p_purpose: purpose,p_scope_id: scopeId,p_scope_revision: exact.scopeRevision,
      p_basis: exact.basis,p_checksum_sha256: checksum,p_filename: file.name,
      p_uploader_id: target.context.actor.id
    });
    if (error) throw new Error(error.message);
    return reply(data);
  } catch (error) {
    if (uploadedPath) await createRybexSupabaseAdminClient().storage.from(bucket).remove([uploadedPath]);
    if (error instanceof Error && error.message === "unauthenticated") return reply({ error: "unauthenticated" }, 401);
    return reply({ error: "customer_evidence_unavailable" }, 503);
  }
}

export async function GET(request: NextRequest) {
  try {
    const target = await scope(request);
    if (!target) return reply({ error: "customer_evidence_authority_required" }, 403);
    const workId = request.nextUrl.searchParams.get("workId") ?? "";
    const id = request.nextUrl.searchParams.get("evidenceId") ?? "";
    const requestId = request.nextUrl.searchParams.get("requestId") ?? "";
    const listTerms = request.nextUrl.searchParams.get("list") === "service-billing-terms";
    if (!listTerms && !/^[0-9a-f-]{36}$/i.test(id)) return reply({ error: "invalid_evidence" }, 400);
    const loaded = await target.context.read("work");
    const work = (loaded.state?.records as WorkRecord[] | undefined)?.find((item) =>
      item.id === workId && item.workspace === target.workspace && !!item.canonicalWorkId);
    if (!work) return reply({ error: "work_unavailable" }, 404);
    const admin = createRybexSupabaseAdminClient();
    const call = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    if (listTerms && target.context.actor.role === "field_supervisor")
      return reply({ error: "customer_evidence_authority_required" }, 403);
    if (listTerms || target.context.actor.role === "billing_commercial_lead") {
      if (!requestId) return reply({ error: "request_scope_required" }, 400);
      const listed = await call("d5o_hosted_service_billing_terms_evidence_list_v1", {
        p_workspace_key: target.workspace,p_presentation_id: workId,p_request_id: requestId
      });
      if (listed.error || !Array.isArray(listed.data))
        return reply({ error: "evidence_unavailable" }, 404);
      if (listTerms) return reply(listed.data);
      if (!listed.data.some((item) => !!item && typeof item === "object" &&
        (item as { id?: string }).id === id))
        return reply({ error: "customer_evidence_authority_required" }, 403);
    }
    const { data: rows, error } = await call("d5o_hosted_customer_decision_evidence_read_v1", {
      p_workspace_key: target.workspace,p_presentation_id: workId,p_evidence_id: id
    });
    if (error || !rows || typeof rows !== "object") return reply({ error: "evidence_unavailable" }, 404);
    const receipt = rows as { objectPath: string; checksumSha256: string; filename: string; uploadedBy: string };
    if (target.context.actor.role === "field_supervisor" && receipt.uploadedBy !== target.context.actor.id)
      return reply({ error: "customer_evidence_authority_required" }, 403);
    const file = await admin.storage.from(bucket).download(receipt.objectPath);
    if (file.error || !file.data) return reply({ error: "evidence_unavailable" }, 503);
    const bytes = Buffer.from(await file.data.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== receipt.checksumSha256)
      return reply({ error: "integrity_failed" }, 409);
    return new Response(bytes, { headers: {
      "Content-Type": "application/pdf", "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="${receipt.filename.replace(/[^\w. -]/g, "_")}"`,
      "X-Content-Type-Options": "nosniff"
    } });
  } catch (error) {
    if (error instanceof Error && error.message === "unauthenticated") return reply({ error: "unauthenticated" }, 401);
    return reply({ error: "evidence_unavailable" }, 503);
  }
}
