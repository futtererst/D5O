import { NextRequest, NextResponse } from "next/server";
import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const workspace = q.get("workspace") ?? "";
  const workId = q.get("workId") ?? "";
  const category = q.get("category") ?? "";
  const subjectId = q.get("subjectId") ?? "";
  const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!["rybex", "rotork"].includes(workspace) ||
    (category !== "internal_design_rate" && !/^[\w-]{8,120}$/.test(workId))
    || !["work_authority", "design_authority", "design_commitment", "purchase_order",
      "subcontract_allocation", "subcontract_agreement", "subcontract_variation", "field_labor_authority",
      "internal_design_rate"].includes(category)
    || !/^[0-9a-f-]{36}$/i.test(subjectId)) return respond({ error: "invalid_target" }, 400);
  if (!authoritativeD5OCommandsReady()) return respond({ error: "authoritative_runtime_unavailable" }, 503);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
  const subcontractFocus = category.startsWith("subcontract_")
    ? `subcontract-review-${category.slice("subcontract_".length)}` : null;
  const { data, error } = category === "internal_design_rate"
    ? await call("d5o_internal_design_rate_my_review_v1", {
        p_workspace_key: workspace, p_rate_id: subjectId
      })
    : category === "field_labor_authority"
    ? await call("d5o_field_labor_my_review_v1", {
        p_workspace_key: workspace, p_presentation_id: workId, p_authority_id: subjectId
      })
    : category === "purchase_order"
    ? await call("d5o_purchase_order_my_review_v1", {
        p_workspace_key: workspace, p_presentation_id: workId, p_order_id: subjectId
      })
    : subcontractFocus
      ? await call("d5o_subcontract_my_review_v1", {
          p_workspace_key: workspace, p_presentation_id: workId,
          p_focus: subcontractFocus, p_subject_id: subjectId
        })
    : await call("d5o_spending_delegate_my_review_v1", {
        p_workspace_key: workspace, p_presentation_id: workId, p_category: category, p_subject_id: subjectId
      });
  return error ? respond({ error: error.message }, error.code === "42501" ? 403 : 503) : respond(data);
}
