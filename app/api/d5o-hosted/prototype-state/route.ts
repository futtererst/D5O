import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { hostedD5OTargetReady } from "@/lib/d5o/auth/hosted-target";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { hostedPrototypeContext } from "@/lib/d5o/hosted/prototype-context";
import { applyPricingPolicyCommand, type PricingPolicyCommand } from "@/lib/d5o/prototype-work/pricing-policy-command";
import { assertSnapshotCommercialIntegrity } from "@/lib/d5o/prototype-work/commercial-command";
import { assertSnapshotDefineIntegrity } from "@/lib/d5o/prototype-work/define-command";
import { assertSnapshotDesignIntegrity } from "@/lib/d5o/prototype-work/design-command";
import { assertSnapshotDeployIntegrity } from "@/lib/d5o/prototype-work/deploy-command";
import { assertSnapshotOperateIntegrity } from "@/lib/d5o/prototype-work/operate-command";
import { assertSnapshotPositionIntegrity } from "@/lib/d5o/prototype-work/position-integrity";

export const dynamic = "force-dynamic";

type StateKey = "work" | "catalog" | "schedule";
type RpcError = { code?: string; message: string };
type RpcResult = { data: unknown; error: RpcError | null };
type RpcName = "d5o_hosted_actor_v1" | "d5o_hosted_prototype_read_v1" |
  "d5o_hosted_prototype_save_v1";
type PrototypeResult = { revision: number; state: Record<string, unknown> | null };
const editors = new Set(["admin", "operations_leader", "project_manager", "field_supervisor"]);
const workspacePattern = /^[a-z][a-z0-9_-]{1,63}$/;
const stateKeys = new Set<StateKey>(["work", "catalog", "schedule"]);

const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" }
});

function errorReply(error: RpcError | null) {
  // A concurrent typed decision can make a previously valid draft obsolete
  // after the route's preflight read. Preserve the database guard and report
  // that conflict as a changed basis, not as lost workspace membership.
  if (error?.code === "42501" && error.message === "typed_command_required")
    return reply({ error: "protected_state_changed" }, 409);
  if (error?.code === "42501") return reply({ error: "workspace_forbidden", ...(process.env.D5O_ISOLATED_PILOT === "1" ? { message: error.message } : {}) }, 403);
  if (error?.code === "23505") return reply({ error: "stale_state" }, 409);
  if (error?.code === "22023" || error?.code === "23514") return reply({ error: "invalid_state" }, 422);
  return reply({ error: "state_unavailable" }, 503);
}

async function scoped(workspace: string) {
  if (!hostedD5OTargetReady()) return { error: "hosted_unavailable", status: 503 as const };
  const client = await createRybexSupabaseServerClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return { error: "unauthenticated", status: 401 as const };
  const call = client.rpc.bind(client) as unknown as
    (name: RpcName, args: Record<string, unknown>) => Promise<RpcResult>;
  const actor = await call("d5o_hosted_actor_v1", { p_workspace_key: workspace });
  if (actor.error || !actor.data || typeof actor.data !== "object")
    return { error: "workspace_forbidden", status: 403 as const };
  const role = (actor.data as { role?: string }).role ?? "";
  return { call, role, canEdit: editors.has(role), status: 200 as const };
}

function keyFrom(value: string | null): StateKey | null {
  return value && stateKeys.has(value as StateKey) ? value as StateKey : null;
}

export async function GET(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  const key = keyFrom(request.nextUrl.searchParams.get("key"));
  if (!workspacePattern.test(workspace) || !key) return reply({ error: "invalid_target" }, 400);
  if (key === "work" && request.nextUrl.searchParams.get("pricing") === "1") {
    try {
      const context = await hostedPrototypeContext(workspace);
      const loaded = await context.read("work");
      return reply({ revision: loaded.revision, policies: loaded.state?.pricingPolicies ?? [], active: loaded.state?.activePricingPolicy ?? null, history: context.actor.role === "admin" ? loaded.state?.pricingPolicyHistory ?? [] : [], canAdmin: context.actor.role === "admin", synthetic: true });
    } catch { return reply({ error: "policy_unavailable" }, 503); }
  }
  const scope = await scoped(workspace);
  if (!scope.call) return reply({ error: scope.error }, scope.status);
  const result = await scope.call("d5o_hosted_prototype_read_v1", {
    p_workspace_key: workspace, p_state_key: key
  });
  if (result.error) return errorReply(result.error);
  const read = result.data as PrototypeResult | null;
  if (!read || !Number.isInteger(read.revision)) return reply({ error: "invalid_response" }, 502);
  return reply({ state: read.state ? { ...read.state, revision: read.revision } : null,
    revision: read.revision, canEdit: scope.canEdit, synthetic: true });
}

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const text = await request.text();
  if (request.nextUrl.searchParams.get("pricing") === "1") {
    if (text.length > 100_000) return reply({ error: "policy_too_large" }, 413);
    try {
      const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
      if (!["rybex", "rotork"].includes(workspace)) return reply({ error: "invalid_target" }, 400);
      const command = JSON.parse(text) as PricingPolicyCommand;
      if (!command || !["save-draft", "publish", "activate"].includes(command.action) || !Number.isInteger(command.expectedRevision)) return reply({ error: "invalid_command" }, 400);
      if (authoritativeD5OCommandsReady()) {
        const scopedClient = await createRybexSupabaseServerClient();
        const call = scopedClient.rpc.bind(scopedClient) as unknown as
          (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
        const { data, error } = await call("d5o_hosted_pricing_policy_command_v1", {
          p_workspace_key: workspace,p_action: command.action,
          p_policy: command.action === "save-draft" ? command.policy : null,
          p_policy_id: command.policyId,p_policy_version: command.policyVersion,
          p_command_id: command.commandId,p_expected_work_revision: command.expectedRevision
        });
        if (error) return errorReply(error);
        const result = data as PrototypeResult | null;
        if (!result?.state || !Number.isInteger(result.revision)) return reply({ error: "invalid_response" }, 502);
        return reply({ revision: result.revision, policies: result.state.pricingPolicies,
          active: result.state.activePricingPolicy,history: result.state.pricingPolicyHistory,
          synthetic: false });
      }
      const context = await hostedPrototypeContext(workspace);
      if (context.actor.role !== "admin") return reply({ error: "pricing_config_forbidden" }, 403);
      const loaded = await context.read("work");
      if (loaded.revision !== command.expectedRevision || !loaded.state) return reply({ error: "stale_state" }, 409);
      const next = applyPricingPolicyCommand(loaded.state, workspace as "rybex" | "rotork", context.actor, command);
      const saved = await context.save("work", loaded.revision, { ...next, revision: loaded.revision + 1 });
      return reply({ revision: saved.revision, policies: saved.state?.pricingPolicies, active: saved.state?.activePricingPolicy, history: saved.state?.pricingPolicyHistory, synthetic: true });
    } catch (error) { return reply({ error: error instanceof Error && "code" in error ? error.code : "policy_unavailable", message: error instanceof Error ? error.message : undefined }, error instanceof Error && "status" in error ? Number(error.status) : 503); }
  }
  if (text.length > 2_100_000) return reply({ error: "state_too_large" }, 413);
  let input: Record<string, unknown>;
  try { input = JSON.parse(text) as Record<string, unknown>; }
  catch { return reply({ error: "invalid_request" }, 400); }
  const workspace = input.workspace;
  const key = keyFrom(typeof input.key === "string" ? input.key : null);
  if (typeof workspace !== "string" || !workspacePattern.test(workspace) || !key
    || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0
    || !input.state || typeof input.state !== "object" || Array.isArray(input.state))
    return reply({ error: "invalid_request" }, 400);
  if (key !== "work") return reply({ error: "command_only_state" }, 403);
  if (key === "work" && (!Array.isArray((input.state as Record<string, unknown>).records) ||
      ((input.state as Record<string, unknown>).records as unknown[]).some((record) =>
        !record || typeof record !== "object" || Array.isArray(record) ||
        (record as Record<string, unknown>).workspace !== workspace)))
    return reply({ error: "workspace_mismatch" }, 400);
  const scope = await scoped(workspace);
  const scopedAt = performance.now();
  if (!scope.call) return reply({ error: scope.error }, scope.status);
  if (!scope.canEdit) return reply({ error: "workspace_forbidden" }, 403);
  const [prior, catalog] = await Promise.all([
    scope.call("d5o_hosted_prototype_read_v1", { p_workspace_key: workspace, p_state_key: "work" }),
    scope.call("d5o_hosted_prototype_read_v1", { p_workspace_key: workspace, p_state_key: "catalog" })
  ]);
  const preflightAt = performance.now();
  if (prior?.error) return errorReply(prior.error);
  if (catalog.error) return errorReply(catalog.error);
  const preserved = (prior?.data as PrototypeResult | null)?.state;
  const catalogRecords = ((catalog.data as PrototypeResult | null)?.state?.records ?? []) as Record<string, unknown>[];
  if (key === "work" && Array.isArray(preserved?.records)) {
    try { assertSnapshotCommercialIntegrity(preserved.records, (input.state as { records: Record<string, unknown>[] }).records); assertSnapshotDefineIntegrity(preserved.records, (input.state as { records: Record<string, unknown>[] }).records); assertSnapshotDesignIntegrity(preserved.records, (input.state as { records: Record<string, unknown>[] }).records); assertSnapshotDeployIntegrity(preserved.records, (input.state as { records: Record<string, unknown>[] }).records); assertSnapshotOperateIntegrity(preserved.records, (input.state as { records: Record<string, unknown>[] }).records); assertSnapshotPositionIntegrity(preserved.records, (input.state as { records: Record<string, unknown>[] }).records, catalogRecords); }
    catch (error) { return reply({ error: error instanceof Error && "code" in error ? error.code : "protected_state_changed", message: error instanceof Error ? error.message : undefined }, error instanceof Error && "status" in error ? Number(error.status) : 409); }
  }
  const guardedAt = performance.now();
  const state = { ...(input.state as Record<string, unknown>) };
  if (key === "work") for (const field of ["pricingPolicies", "activePricingPolicy", "pricingPolicyHistory"] as const) {
    delete state[field];
    if (preserved && Object.prototype.hasOwnProperty.call(preserved, field)) state[field] = preserved[field];
  }
  const result = await scope.call("d5o_hosted_prototype_save_v1", {
    p_workspace_key: workspace, p_state_key: key,
    p_expected_revision: input.expectedRevision, p_state: state
  });
  const savedAt = performance.now();
  if (result.error) return errorReply(result.error);
  const saved = result.data as PrototypeResult | null;
  if (!saved || !Number.isInteger(saved.revision) || !saved.state)
    return reply({ error: "invalid_response" }, 502);
  // A generic draft writer returns the unfiltered snapshot. Supervisors must
  // receive the same server-scoped read projection as the ordinary GET path.
  const visible = scope.role === "field_supervisor"
    ? await scope.call("d5o_hosted_prototype_read_v1", {
      p_workspace_key: workspace, p_state_key: key
    }) : null;
  if (visible?.error) return errorReply(visible.error);
  const response = visible ? visible.data as PrototypeResult | null : saved;
  if (!response?.state || !Number.isInteger(response.revision))
    return reply({ error: "invalid_response" }, 502);
  const output = reply({ state: { ...response.state, revision: response.revision },
    revision: response.revision, canEdit: true, synthetic: true });
  if (process.env.D5O_COMMAND_RUNTIME === "rehearsal") {
    const serializedAt = performance.now();
    output.headers.set("Server-Timing", [
      `scope;dur=${(scopedAt - startedAt).toFixed(1)}`,
      `preflight;dur=${(preflightAt - scopedAt).toFixed(1)}`,
      `guards;dur=${(guardedAt - preflightAt).toFixed(1)}`,
      `command;dur=${(savedAt - guardedAt).toFixed(1)}`,
      `response;dur=${(serializedAt - savedAt).toFixed(1)}`
    ].join(", "));
  }
  return output;
}
