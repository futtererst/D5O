import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/lib/d5o/auth/request-context";
import { assertProofEnvironment } from "@/lib/d5o/work-record/server";
import { crewPersonForUser, scheduleWorkspaceKeys } from "@/lib/d5o/scheduling/crew-identity";
import { loadSchedule, respondToPublishedBooking, ScheduleError, type CrewResponseMutation } from "@/lib/d5o/scheduling/store";
import { scheduleBookingContext, type SharedSchedule, type WorkspaceKey } from "@/components/d5o/platform/schedule-model";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { loadPrototypeWork } from "@/lib/d5o/prototype-work/store";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import { workerPackageProgress } from "@/lib/d5o/prototype-work/deploy-worker-projection";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function scope() {
  assertProofEnvironment();
  const context = await getRequestContext();
  const workspace = context.status === "authorized" && context.workspace && context.membership?.status === "active"
    ? scheduleWorkspaceKeys[context.workspace.id] : undefined;
  const person = workspace && context.user?.id ? await crewPersonForUser(workspace, context.user.id) : null;
  return { context, workspace, person };
}

function view(state: SharedSchedule, workspace: WorkspaceKey, person: string, records: WorkRecord[]) {
  const latestByWeek = new Map<number, typeof state.publications[number]>();
  for (const publication of state.publications) latestByWeek.set(publication.week, publication);
  const bookings = [...latestByWeek.values()].flatMap((publication) => publication.assignments
    .filter((assignment) => assignment.people.includes(person))
    .map((assignment) => ({ publicationId: publication.id, publishedAt: publication.publishedAt,
      assignmentId: assignment.id, crew: assignment.crew, date: assignment.date, shift: assignment.shift, ...scheduleBookingContext(assignment),
      workId: assignment.workId, packageId: assignment.packageId,
      progress: records.find((record) => record.id === assignment.workId && record.workspace === workspace)
        ? workerPackageProgress(records.find((record) => record.id === assignment.workId && record.workspace === workspace)!, assignment.packageId) : undefined,
      response: state.receipts.find((receipt) => receipt.publicationId === publication.id
        && receipt.assignmentId === assignment.id && receipt.recipient === person) ?? null })))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return { workspace, person, revision: state.revision, bookings };
}

export async function GET() {
  try {
    const { context, workspace, person } = await scope();
    if (!workspace || !person) return reply({ error: "unauthorized" }, context.authenticated ? 403 : 401);
    const [schedule, work] = await Promise.all([loadSchedule(workspace), loadPrototypeWork(workspace)]);
    return reply(view(schedule, workspace, person, work.records as WorkRecord[]));
  } catch { return reply({ error: "schedule_unavailable" }, 500); }
}

export async function POST(request: NextRequest) {
  try {
    const { context, workspace, person } = await scope();
    if (!workspace || !person || !context.user) return reply({ error: "unauthorized" }, context.authenticated ? 403 : 401);
    if (!validLocalScheduleOrigin(request.headers))
      return reply({ error: "invalid_origin", message: "The crew response did not come from this local workspace address. Reload the page and try again." }, 403);
    const input = await request.json() as CrewResponseMutation;
    const state = await respondToPublishedBooking(workspace, { id: context.user.id, name: context.user.name, role: context.role ?? "" }, person, input);
    const work = await loadPrototypeWork(workspace);
    return reply(view(state, workspace, person, work.records as WorkRecord[]));
  } catch (error) {
    if (error instanceof ScheduleError) return reply({ error: error.code, message: error.message }, error.status);
    return reply({ error: "invalid_request" }, 400);
  }
}
