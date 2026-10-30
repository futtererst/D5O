import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { customerWorkspaceKey } from "@/lib/d5o/hosted/customer-work-scope";
export const dynamic = "force-dynamic";
const reply = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
type Order = { id: string; status: string; accountReference: string; shipTo: string; requiredDate: string; amountMinor: number; currency: string; lines: Array<{ materialId: string; graybarSku: string; quoteId: string; quoteLineNumber: string; quantity: string; unit: string; unitPriceMinor: string; packSize: string }> };
type SourceQuote = { id: string; quoteNumber: string; quoteRevision: string; lines: Array<{ lineNumber: string; description: string; manufacturer: string; manufacturerPartNumber: string }> };
export async function GET(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "", workId = request.nextUrl.searchParams.get("workId") ?? "", orderId = request.nextUrl.searchParams.get("orderId") ?? "";
  if (!customerWorkspaceKey.test(workspace) || !/^[\w-]{8,120}$/.test(workId) || !/^[0-9a-f-]{36}$/i.test(orderId)) return reply("invalid_target", 400);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  const result = await call("d5o_graybar_read_v1", { p_workspace_key: workspace, p_presentation_id: workId });
  if (result.error || !result.data) return reply("procurement_scope_denied", 403);
  const source = (result.data as { state: { orders: Order[]; quotes: SourceQuote[] } }).state;
  const order = (source.orders ?? []).find((item) => item.id === orderId);
  if (!order || !["Approved", "Test submitted", "Acknowledged"].includes(order.status)) return reply("approved_order_required", 409);
  const document = await PDFDocument.create(), font = await document.embedFont(StandardFonts.Helvetica), bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage([612, 792]), y = 744;
  const line = (text: string, size = 10, strong = false) => { if (y < 60) { page = document.addPage([612, 792]); y = 744; } page.drawText(text.slice(0, 92), { x: 48, y, size, font: strong ? bold : font, color: rgb(0.06, 0.17, 0.27) }); y -= size + 9; };
  line("RYBEX  /  PURCHASE ORDER", 20, true); y -= 10;
  line(`PO ${order.id}  |  ${order.status.toUpperCase()}`, 11, true);
  line(`Distributor: Graybar  |  Account: ${order.accountReference}`);
  line(`Work: ${workId}  |  Ship to: ${order.shipTo}`);
  line(`Required date: ${order.requiredDate || "Not stated"}  |  Currency: ${order.currency}`);
  line("Approved document/export only. Supplier transmission is a separate recorded action.", 9);
  y -= 12; line("APPROVED MATERIALS AND ACCOUNT OFFER", 10, true);
  for (const item of order.lines) {
    const quote = source.quotes.find((entry) => entry.id === item.quoteId);
    const offer = quote?.lines.find((entry) => entry.lineNumber === item.quoteLineNumber);
    line(`${offer?.description ?? "Product description not stated"}  |  Graybar SKU ${item.graybarSku}`, 9, true);
    line(`Manufacturer: ${offer?.manufacturer || "Not stated"}  |  Manufacturer part: ${offer?.manufacturerPartNumber || "Not stated"}`, 9);
    line(`${item.quantity} ${item.unit}  |  ${item.packSize} ${item.unit} per priced unit  |  USD ${(Number(item.unitPriceMinor) / 100).toFixed(2)}`, 9);
    line(`Source: ${quote?.quoteNumber ?? "Not stated"} rev ${quote?.quoteRevision ?? "Not stated"} line ${item.quoteLineNumber}`, 9);
  }
  y -= 8; line(`APPROVED PO VALUE: USD ${(Number(order.amountMinor) / 100).toFixed(2)}`, 12, true);
  line("Substitutions are not authorized. Differences require separate review.", 9);
  const bytes = await document.save();
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": `attachment; filename="rybex-po-${order.id.slice(0, 8)}.pdf"` } });
}
