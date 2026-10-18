import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseAdminClient, createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { hostedPrototypeContext, HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
const bucket = "d5o-deploy-evidence";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status,
  headers: { "Cache-Control": "private, no-store" } });
type Claim = { id: string; status: string; prepared_by: string };
type Receipt = { evidenceId: string; objectPath: string; checksumSha256: string;
  filename: string; sizeBytes: number; uploadedBy: string; uploadedAt: string };
type RpcResult = { data: unknown; error: { message: string } | null };

async function scope(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  const workId = request.nextUrl.searchParams.get("workId") ?? "";
  const claimId = request.nextUrl.searchParams.get("claimId") ?? "";
  if (!["rybex", "rotork"].includes(workspace) || !/^[\w-]{8,120}$/.test(workId) ||
    !/^[0-9a-f-]{36}$/i.test(claimId)) return null;
  const context = await hostedPrototypeContext(workspace);
  if (!["project_manager", "billing_commercial_lead"].includes(context.actor.role)) return null;
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as
    (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  const { data, error } = await call("d5o_hosted_design_cost_read_v1", {
    p_workspace_key: workspace, p_presentation_id: workId
  });
  const claim = !error && data && typeof data === "object"
    ? (data as { claims: Claim[] }).claims?.find((item) => item.id === claimId) : undefined;
  return claim ? { workspace, workId, claimId, claim, context } : null;
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  let uploadedPath = "";
  try {
    const selected = await scope(request);
    if (!selected || selected.context.actor.role !== "project_manager" ||
      selected.claim.status !== "Prepared" || selected.claim.prepared_by !== selected.context.actor.id)
      return reply({ error: "design_cost_evidence_scope_denied" }, 403);
    const file = (await request.formData()).get("file");
    if (!(file instanceof File) || file.type !== "application/pdf" ||
      file.size < 1 || file.size > 10_485_760) return reply({ error: "design_cost_pdf_required" }, 400);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-" ||
      !bytes.subarray(-32).toString("ascii").includes("%%EOF"))
      return reply({ error: "design_cost_pdf_required" }, 400);
    const id = randomUUID(), checksum = createHash("sha256").update(bytes).digest("hex");
    uploadedPath = `${selected.workspace}/${createHash("sha256").update(selected.workId).digest("hex")}/design-cost/${id}`;
    const admin = createRybexSupabaseAdminClient();
    const saved = await admin.storage.from(bucket).upload(uploadedPath, bytes, {
      contentType: "application/pdf", upsert: false
    });
    if (saved.error) return reply({ error: "private_upload_failed" }, 503);
    const verified = await admin.storage.from(bucket).download(uploadedPath);
    if (verified.error || !verified.data ||
      createHash("sha256").update(Buffer.from(await verified.data.arrayBuffer())).digest("hex") !== checksum)
      throw new Error("uploaded_bytes_changed");
    const call = admin.rpc.bind(admin) as unknown as
      (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
    const { data, error } = await call("d5o_hosted_register_design_cost_evidence_v1", {
      p_workspace_key: selected.workspace, p_presentation_id: selected.workId,
      p_claim_id: selected.claimId, p_evidence_id: id,
      p_checksum_sha256: checksum, p_filename: file.name,
      p_uploader_id: selected.context.actor.id
    });
    if (error) throw new Error(error.message);
    return reply(data);
  } catch (error) {
    if (uploadedPath) await createRybexSupabaseAdminClient().storage.from(bucket).remove([uploadedPath]);
    if (error instanceof HostedStateError) return reply({ error: error.code }, error.status);
    return reply({ error: "design_cost_evidence_unavailable" }, 503);
  }
}

export async function GET(request: NextRequest) {
  try {
    const selected = await scope(request);
    if (!selected) return reply({ error: "design_cost_evidence_scope_denied" }, 403);
    const admin = createRybexSupabaseAdminClient();
    const call = admin.rpc.bind(admin) as unknown as
      (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
    const { data, error } = await call("d5o_hosted_design_cost_evidence_read_v1", {
      p_workspace_key: selected.workspace, p_presentation_id: selected.workId,
      p_claim_id: selected.claimId
    });
    if (error || !data || typeof data !== "object") return reply({ error: "design_cost_evidence_missing" }, 404);
    const receipt = data as Receipt;
    if (request.nextUrl.searchParams.get("download") !== "1") return reply({
      evidenceId: receipt.evidenceId, claimId: selected.claimId,
      checksumSha256: receipt.checksumSha256, filename: receipt.filename,
      sizeBytes: receipt.sizeBytes, uploadedBy: receipt.uploadedBy,
      uploadedAt: receipt.uploadedAt
    });
    const file = await admin.storage.from(bucket).download(receipt.objectPath);
    if (file.error || !file.data) return reply({ error: "design_cost_evidence_missing" }, 503);
    const bytes = Buffer.from(await file.data.arrayBuffer());
    if (bytes.length !== receipt.sizeBytes ||
      createHash("sha256").update(bytes).digest("hex") !== receipt.checksumSha256)
      return reply({ error: "design_cost_evidence_integrity_failed" }, 409);
    return new Response(bytes, { headers: {
      "Content-Type": "application/pdf", "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="${receipt.filename.replace(/[^\w. -]/g, "_")}"`,
      "X-Content-Type-Options": "nosniff"
    } });
  } catch (error) {
    if (error instanceof HostedStateError) return reply({ error: error.code }, error.status);
    return reply({ error: "design_cost_evidence_unavailable" }, 503);
  }
}
