import { NextRequest, NextResponse } from "next/server";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import { createRybexSupabaseAdminClient } from "@/lib/d5o/auth/supabase-server";
import { HostedStateError, hostedPrototypeContext } from "@/lib/d5o/hosted/prototype-context";

export const dynamic = "force-dynamic";
type Receipt = { id: string; work_id: string; kind: string; scope_id: string | null;
  document_id: string | null; revision: number; filename: string;
  checksum_sha256: string; size_bytes: number; uploaded_at: string };
const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "private, no-store" }
});

export async function GET(request: NextRequest) {
  try {
    const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
    if (!["rybex", "rotork"].includes(workspace) || !Number.isInteger(offset) ||
      offset < 0 || offset > 10000) return reply({ error: "invalid_scope" }, 400);
    const context = await hostedPrototypeContext(workspace);
    const role = context.actor.role;
    const designAllowed = ["admin", "project_manager", "operations_leader"].includes(role);
    const customerAllowed = ["project_manager", "operations_leader", "field_supervisor"].includes(role);
    if (!designAllowed && !customerAllowed) return reply({ error: "evidence_scope_denied" }, 403);
    const loaded = await context.read("work");
    const work = new Map(((loaded.state?.records ?? []) as WorkRecord[])
      .filter((item) => item.workspace === workspace && !!item.canonicalWorkId)
      .map((item) => [item.id, item]));
    const admin = createRybexSupabaseAdminClient();
    const call = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    const { data, error } = await call("d5o_hosted_private_evidence_index_v1", {
      p_workspace_key: workspace, p_offset: offset, p_limit: 100
    });
    if (error || !Array.isArray(data)) return reply({ error: "evidence_index_unavailable" }, 503);
    const rows = (data as Receipt[]).filter((item) => work.has(item.work_id) &&
      (item.kind === "design-document" ? designAllowed : customerAllowed));
    return reply({
      entries: rows.map((item) => {
        const record = work.get(item.work_id)!;
        const document = item.kind === "design-document"
          ? record.design?.documents.find((entry) => entry.id === item.document_id &&
            entry.revision === item.revision) : undefined;
        const params = new URLSearchParams({ workspace, workId: item.work_id });
        if (item.kind === "design-document") {
          params.set("documentId", item.document_id ?? "");
          params.set("revision", String(item.revision));
          params.set("download", "1");
        } else params.set("evidenceId", item.id);
        return { id: item.id, workId: item.work_id, workTitle: record.title,
          customer: record.customer, site: record.site, kind: item.kind,
          scopeId: item.scope_id, revision: item.revision,
          name: document?.title ?? item.filename, filename: item.filename,
          status: document?.status ?? "Retained receipt",
          checksumSha256: item.checksum_sha256, sizeBytes: item.size_bytes,
          uploadedAt: item.uploaded_at,
          downloadUrl: `/api/d5o-hosted/${item.kind === "design-document"
            ? "design-document-evidence" : "customer-decision-evidence"}?${params}` };
      }),
      nextOffset: data.length === 100 ? offset + 100 : null
    });
  } catch (error) {
    if (error instanceof HostedStateError) return reply({ error: error.code }, error.status);
    if (error instanceof Error && error.message === "unauthenticated")
      return reply({ error: "unauthenticated" }, 401);
    return reply({ error: "evidence_index_unavailable" }, 503);
  }
}

