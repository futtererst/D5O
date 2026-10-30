import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseAdminClient, createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { graybarDocumentAssistant } from "@/lib/d5o/graybar/document-assistant";
import { scanHostedUpload } from "@/lib/d5o/hosted/scan-upload";
import { customerWorkspaceKey } from "@/lib/d5o/hosted/customer-work-scope";

export const dynamic = "force-dynamic";
const bucket = "d5o-deploy-evidence";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const kinds = new Set(["quote", "specification", "acknowledgment", "delivery", "supplier_invoice", "other"]);
function target(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  const workId = request.nextUrl.searchParams.get("workId") ?? "";
  return customerWorkspaceKey.test(workspace) && /^[\w-]{8,120}$/.test(workId) ? { workspace, workId } : null;
}
async function actorAndScope(request: NextRequest) {
  const selected = target(request);
  if (!selected || !authoritativeD5OCommandsReady()) return null;
  const client = await createRybexSupabaseServerClient();
  const user = await client.auth.getUser();
  if (!user.data.user) return null;
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  const read = await call("d5o_graybar_read_v1", { p_workspace_key: selected.workspace, p_presentation_id: selected.workId });
  if (read.error) return null;
  return { ...selected, actorId: user.data.user.id };
}
function parseCsvLine(row: string): string[] {
  const cells: string[] = []; let cell = "", quoted = false;
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === '"' && quoted && row[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { cells.push(cell.trim()); cell = ""; }
    else cell += char;
  }
  cells.push(cell.trim()); return cells;
}
async function extract(file: File, bytes: Buffer) {
  if (/\.csv$/i.test(file.name)) return { method: "deterministic CSV columns; review required", rows: bytes.toString("utf8").split(/\r?\n/).filter(Boolean).slice(0, 200).map(parseCsvLine) };
  if (/\.xlsx$/i.test(file.name)) {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as never);
    const sheet = workbook.worksheets[0];
    return { method: "deterministic XLSX cells; review required", rows: sheet ? sheet.getRows(1, Math.min(sheet.rowCount, 200))?.map((row) => row.values) ?? [] : [] };
  }
  try {
    const pdf = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document = await pdf.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true }).promise;
    const pages: string[] = [];
    for (let index = 1; index <= Math.min(document.numPages, 15); index++) {
      const content = await (await document.getPage(index)).getTextContent();
      pages.push(content.items.map((item) => "str" in item ? String(item.str) : "").join(" "));
    }
    return { method: "PDF text extraction; review required", text: pages.join("\n").slice(0, 30000) };
  } catch (error) {
    console.warn("graybar_pdf_extraction_unavailable", error instanceof Error ? error.message : "unknown");
    return { method: "PDF retained; automated text unavailable, manual review required", text: "" };
  }
}
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const scoped = await actorAndScope(request);
  if (!scoped) return reply({ error: "document_scope_denied" }, 403);
  const form = await request.formData();
  const file = form.get("file"), kind = String(form.get("kind") ?? "");
  if (!(file instanceof File) || !kinds.has(kind) || file.size<1 || file.size>20_000_000 ||
    !/\.(pdf|csv|xlsx)$/i.test(file.name)) return reply({ error: "pdf_csv_or_xlsx_required" }, 400);
  const bytes = Buffer.from(await file.arrayBuffer());
  const mediaType = /\.pdf$/i.test(file.name) ? "application/pdf" : /\.csv$/i.test(file.name) ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (mediaType === "application/pdf" && bytes.subarray(0, 5).toString("ascii") !== "%PDF-") return reply({ error: "invalid_pdf" }, 400);
  if (mediaType.endsWith("sheet") && bytes.subarray(0, 2).toString("ascii") !== "PK") return reply({ error: "invalid_xlsx" }, 400);
  const id = randomUUID();
  const scan = await scanHostedUpload({ evidenceId: id, filename: file.name,
    mimeType: mediaType, bytes });
  if (scan) return reply({ error: scan.error }, scan.status);
  let extraction: Awaited<ReturnType<typeof extract>>;
  try { extraction = await extract(file, bytes); }
  catch { return reply({ error: "unreadable_document" }, 400); }
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const path = `${scoped.workspace}/${createHash("sha256").update(scoped.workId).digest("hex")}/graybar/${id}`;
  const admin = createRybexSupabaseAdminClient();
  const stored = await admin.storage.from(bucket).upload(path, bytes, { contentType: mediaType, upsert: false });
  if (stored.error) return reply({ error: "private_upload_failed" }, 503);
  try {
    const download = await admin.storage.from(bucket).download(path);
    if (download.error || !download.data || createHash("sha256").update(Buffer.from(await download.data.arrayBuffer())).digest("hex") !== checksum)
      throw new Error("private_upload_integrity_failed");
    const call = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    const registered = await call("d5o_graybar_register_document_v1", { p_workspace_key: scoped.workspace,
      p_presentation_id: scoped.workId, p_kind: kind, p_filename: file.name, p_media_type: mediaType,
      p_storage_path: path, p_sha256: checksum, p_byte_count: bytes.length, p_actor: scoped.actorId,
      p_extraction: extraction });
    if (registered.error) throw new Error(registered.error.message);
    return reply({ documentId: registered.data, sha256: checksum, extraction,
      ai: graybarDocumentAssistant.status === "unavailable" ? "No configured AI provider; deterministic extraction and human acceptance only" : "Provider suggestions require human review" });
  } catch {
    await admin.storage.from(bucket).remove([path]);
    return reply({ error: "document_registration_failed" }, 503);
  }
}
export async function GET(request: NextRequest) {
  const scoped = await actorAndScope(request);
  if (!scoped) return reply({ error: "document_scope_denied" }, 403);
  const documentId = request.nextUrl.searchParams.get("documentId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return reply({ error: "invalid_document" }, 400);
  const admin = createRybexSupabaseAdminClient();
  const call = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  const result = await call("d5o_graybar_document_v1", { p_workspace_key: scoped.workspace,
    p_presentation_id: scoped.workId, p_document_id: documentId, p_actor: scoped.actorId });
  if (result.error || !result.data) return reply({ error: "document_missing" }, 404);
  const metadata = result.data as { storagePath: string; sha256: string; byteCount: number; mediaType: string; filename: string };
  const downloaded = await admin.storage.from(bucket).download(metadata.storagePath);
  if (downloaded.error || !downloaded.data) return reply({ error: "private_bytes_missing" }, 503);
  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  if (bytes.length !== metadata.byteCount || createHash("sha256").update(bytes).digest("hex") !== metadata.sha256)
    return reply({ error: "document_integrity_failed" }, 409);
  return new Response(bytes, { headers: { "Content-Type": metadata.mediaType, "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff", "Content-Disposition": `inline; filename="${metadata.filename.replace(/[^\w. -]/g, "_")}"` } });
}
