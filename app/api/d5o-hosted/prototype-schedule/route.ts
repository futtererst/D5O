import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { NextRequest, NextResponse } from "next/server";
import type { WorkspaceKey } from "@/components/d5o/platform/schedule-model";
import type { SharedWorkCatalog } from "@/components/d5o/platform/work-catalog-model";
import { applyScheduleMutation, initialHostedSchedule, ScheduleError,
  type ScheduleMutation } from "@/lib/d5o/scheduling/store";
import { HostedStateError, hostedPrototypeContext } from "@/lib/d5o/hosted/prototype-context";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";

export const dynamic = "force-dynamic";
const workspaces = new Set(["rybex", "rotork"]);
const delivery = { sent: 0, failed: 0, attempting: 0, unavailable: true };
const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" }
});
async function withLaborHours(workspace: string, schedule: Record<string, unknown>, role: string) {
  if (!authoritativeD5OCommandsReady() || !["admin", "project_manager", "operations_leader"].includes(role)) return schedule;
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) =>
    Promise<{ data: unknown; error: { message?: string } | null }>;
  const { data, error } = await call("d5o_schedule_labor_hours_v1", { p_workspace_key: workspace });
  if (error) throw new Error("schedule_labor_hours_unavailable");
  const hours = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const assignments = Array.isArray(schedule.assignments) ? schedule.assignments as Array<Record<string, unknown>> : [];
  return { ...schedule, assignments: assignments.map((assignment) => {
    const value = hours[String(assignment.id)];
    return typeof value === "number" ? { ...assignment, personHoursPerWorker: value } : assignment;
  }) };
}

export async function GET(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!workspaces.has(workspace)) return reply({ error: "invalid_target" }, 400);
  try {
    const context = await hostedPrototypeContext(workspace);
    const loaded = await context.read("schedule");
    const schedule = loaded.state
      ? { ...loaded.state, revision: loaded.revision }
      : initialHostedSchedule(workspace as WorkspaceKey);
    return reply({ schedule: await withLaborHours(workspace, schedule, context.actor.role), canEdit: authoritativeD5OCommandsReady()
      ? ["admin", "project_manager", "operations_leader"].includes(context.actor.role) : context.canEdit,
      canManageAvailability: authoritativeD5OCommandsReady() && context.actor.role === "admin",
      delivery, requiresPublication: authoritativeD5OCommandsReady(), synthetic: true });
  } catch (error) {
    if (error instanceof HostedStateError) return reply({ error: error.code }, error.status);
    return reply({ error: "schedule_unavailable" }, 503);
  }
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!workspaces.has(workspace)) return reply({ error: "invalid_target" }, 400);
  const body = await request.text();
  if (body.length > 1_000_000) return reply({ error: "command_too_large" }, 413);
  try {
    const input = JSON.parse(body) as ScheduleMutation | { action: "record-unavailability" | "clear-unavailability"; data: Record<string, unknown>; expectedRevision: number; commandId?: string };
    const context = await hostedPrototypeContext(workspace);
    if (authoritativeD5OCommandsReady()) {
      const availabilityAction = input.action === "record-unavailability" || input.action === "clear-unavailability";
      if (availabilityAction ? context.actor.role !== "admin"
        : !["admin", "project_manager", "operations_leader"].includes(context.actor.role))
        return reply({ error: availabilityAction ? "admin_availability_required" : "scheduling_authority_required" }, 403);
      if (input.action !== "save-booking" && input.action !== "publish" && !availabilityAction)
        return reply({ error: "typed_schedule_command_required" }, 409);
      const commandId = (input as ScheduleMutation & { commandId?: string }).commandId;
      if (!commandId || !Number.isInteger(input.expectedRevision))
        return reply({ error: "command_identity_required" }, 400);
      const client = await createRybexSupabaseServerClient();
      const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
        data: unknown; error: { code?: string; message: string } | null
      }>;
      const { data, error } = await call(availabilityAction ? "d5o_hosted_availability_command_v1" : "d5o_hosted_crew_command_v1", {
        p_workspace_key: workspace,
        p_action: availabilityAction ? input.action : input.action === "publish" ? "publish-week" : "save-booking",
        p_input: input.action === "publish" ? { week: input.week }
          : input.action === "save-booking" ? { assignment: input.assignment }
          : "data" in input ? input.data : {},
        p_command_id: commandId,
        p_expected_revision: input.expectedRevision
      });
      if (error) return reply({ error: error.message, message: error.message },
        error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409 : 400);
      const result = data as { state?: Record<string, unknown>; revision?: number } | null;
      if (!result?.state || !Number.isInteger(result.revision)) return reply({ error: "invalid_response" }, 502);
      return reply({ schedule: await withLaborHours(workspace, { ...result.state, revision: result.revision }, context.actor.role), delivery,
        requiresPublication: true,
        deliveryWarning: availabilityAction ? "Availability recorded. Existing bookings remain in place; scheduling conflicts need review."
          : input.action === "publish"
          ? "The published booking is available in-app. External notification is not configured for this hosted pilot."
          : "Booking saved as a draft. Publish this week before workers can see it. External notification is not configured.",
        synthetic: false });
    }
    if (!context.canEdit) return reply({ error: "workspace_forbidden" }, 403);
    if (input.action === "save-demand") {
      const workState = await context.read("work");
      const record = (workState.state?.records as Array<Record<string, unknown>> | undefined)?.find((item) => item.id === input.demand.workId);
      const discovery = record?.discovery as { pursuitControl?: unknown; outcome?: string; designHandoff?: { status?: string } } | undefined;
      if (discovery?.pursuitControl && (discovery.outcome !== "Won" || discovery.designHandoff?.status !== "accepted"))
        return reply({ error: "design_handoff_required", message: "Receive the awarded Develop handoff before setting Work Package crew demand." }, 409);
    }
    const loaded = await context.read("schedule");
    const schedule = loaded.state
      ? { ...loaded.state, revision: loaded.revision } as ReturnType<typeof initialHostedSchedule>
      : initialHostedSchedule(workspace as WorkspaceKey);
    const catalogResult = await context.read("catalog");
    const catalog = catalogResult.state as SharedWorkCatalog | null;
    const changed = await applyScheduleMutation(schedule, workspace as WorkspaceKey,
      context.actor, input as ScheduleMutation,
      async (workId, packageId) => Boolean(catalog?.packages.some((item) =>
        item.workId === workId && item.id === packageId)));
    if (!changed) return reply({ schedule, delivery, synthetic: true });
    const saved = await context.save("schedule", loaded.revision,
      schedule as unknown as Record<string, unknown>);
    return reply({ schedule: { ...saved.state, revision: saved.revision }, delivery,
      deliveryWarning: "The booking is shared in-app. External notification is not configured for this hosted prototype.",
      synthetic: true });
  } catch (error) {
    if (error instanceof HostedStateError || error instanceof ScheduleError)
      return reply({ error: error.code, message: error.message }, error.status);
    return reply({ error: "invalid_request" }, 400);
  }
}
