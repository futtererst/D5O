import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseAdminClient, createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { hostedD5OTargetReady } from "@/lib/d5o/auth/hosted-target";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { peopleProfiles } from "@/components/d5o/platform/schedule-model";

export const dynamic = "force-dynamic";
const workspace = "rybex";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
type RpcResult = { data: unknown; error: { code?: string } | null };

async function adminContext() {
  if (!hostedD5OTargetReady()) return { error: "hosted_unavailable", status: 503 };
  const session = await createRybexSupabaseServerClient();
  const { data: userData, error } = await session.auth.getUser();
  if (error || !userData.user) return { error: "unauthenticated", status: 401 };
  const call = session.rpc.bind(session) as unknown as (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  const actor = await call("d5o_hosted_actor_v1", { p_workspace_key: workspace });
  const member = actor.data as { role?: string; membershipId?: string } | null;
  if (actor.error || member?.role !== "admin" || !member.membershipId)
    return { error: "admin_membership_required", status: 403 };
  return { userId: userData.user.id, membershipId: member.membershipId };
}
function failure(error: RpcResult["error"]) {
  if (error?.code === "42501") return reply({ error: "admin_membership_required" }, 403);
  if (error?.code === "23503") return reply({ error: "confirmed_worker_missing", message: "The worker needs a confirmed sign-in account first." }, 409);
  if (error?.code === "23505") return reply({ error: "crew_identity_conflict", message: "This account or crew person is assigned differently." }, 409);
  if (error?.code === "22023") return reply({ error: "invalid_worker_identity" }, 400);
  return reply({ error: "worker_access_unavailable" }, 503);
}

export async function GET() {
  const context = await adminContext();
  if (!context.userId || !context.membershipId) return reply({ error: context.error }, context.status);
  try {
    const admin = createRybexSupabaseAdminClient();
    const call = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
    const result = await call("d5o_hosted_worker_access_v1", {
      p_workspace_key: workspace, p_admin_user_id: context.userId, p_admin_membership_id: context.membershipId
    });
    if (result.error) return failure(result.error);
    return reply({ bindings: result.data, people: peopleProfiles.rybex.map((person) => person.name), synthetic: true });
  } catch { return reply({ error: "worker_access_unavailable" }, 503); }
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const context = await adminContext();
  if (!context.userId || !context.membershipId) return reply({ error: context.error }, context.status);
  try {
    const raw = await request.text();
    if (raw.length > 1000) return reply({ error: "request_too_large" }, 413);
    const input = JSON.parse(raw) as { person?: string; email?: string };
    const person = input.person?.trim() ?? "", email = input.email?.trim().toLowerCase() ?? "";
    if (!peopleProfiles.rybex.some((entry) => entry.name === person) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return reply({ error: "invalid_worker_identity" }, 400);
    const admin = createRybexSupabaseAdminClient();
    const call = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
    const result = await call("d5o_hosted_bind_worker_v1", {
      p_workspace_key: workspace, p_admin_user_id: context.userId, p_admin_membership_id: context.membershipId,
      p_worker_email: email, p_person: person
    });
    if (result.error) return failure(result.error);
    return reply({ binding: result.data, synthetic: true });
  } catch (error) { return error instanceof SyntaxError ? reply({ error: "invalid_request" }, 400) : reply({ error: "worker_access_unavailable" }, 503); }
}
