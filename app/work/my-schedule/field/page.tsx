import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/d5o/auth/request-context";
import { assertProofEnvironment } from "@/lib/d5o/work-record/server";
import { crewPersonForUser, scheduleWorkspaceKeys } from "@/lib/d5o/scheduling/crew-identity";
import { loadSchedule } from "@/lib/d5o/scheduling/store";
import { loadPrototypeWork } from "@/lib/d5o/prototype-work/store";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import { deployWorkerProjection } from "@/lib/d5o/prototype-work/deploy-worker-projection";
import { currentWorkAcceptanceScope } from "@/components/d5o/platform/deploy-model";
import { CrewFieldWork } from "./CrewFieldWork";
import { hostedD5OTargetReady } from "@/lib/d5o/auth/hosted-target";
import { hostedWorkerContext } from "@/lib/d5o/hosted/worker-context";
import { HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import type { SharedSchedule } from "@/components/d5o/platform/schedule-model";
import { WorkerSurfaceStatus } from "../WorkerSurfaceStatus";
import "../../settings/notification-settings.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "My assigned work | D5O" };
export default async function FieldPage({ searchParams }: { searchParams: Promise<{ booking?: string; publication?: string }> }) {
  if (hostedD5OTargetReady()) {
    let worker: Awaited<ReturnType<typeof hostedWorkerContext>> | null = null;
    let failure = "";
    try { worker = await hostedWorkerContext("rybex"); }
    catch (error) { failure = error instanceof HostedStateError ? error.code : "worker_unavailable"; }
    if (failure === "unauthenticated") redirect("/auth/sign-in?next=%2Fwork%2Fmy-schedule");
    if (!worker) return <WorkerSurfaceStatus title="Assigned work is unavailable" message="Ask your scheduler to check your crew binding and hosted worker access." />;
    const query = await searchParams;
    const [scheduleResult, workResult] = await Promise.all([worker.read("schedule"), worker.read("work")]);
    const schedule = scheduleResult.state as SharedSchedule | null;
    const publication = schedule?.publications.find((item) => item.id === query.publication);
    const latest = publication && schedule?.publications.filter((item) => item.week === publication.week).at(-1);
    const assignment = latest?.id === publication?.id ? publication?.assignments.find((item) => item.id === query.booking && item.people.includes(worker.person)) : null;
    const work = (workResult.state?.records as WorkRecord[] | undefined)?.find((item) => item.id === assignment?.workId && item.workspace === "rybex");
    if (!assignment || !work || !publication) return <WorkerSurfaceStatus title="Assigned work changed" message="Review the current booking before entering field work." />;
    return <CrewFieldWork initialWork={deployWorkerProjection(work, assignment.packageId, assignment.id, worker.actor.id)} initialRevision={workResult.revision} initialScheduleRevision={scheduleResult.revision} assignment={assignment} publicationId={publication.id} actorId={worker.actor.id} person={worker.person} packageName={work.packages?.find((item) => item.id === assignment.packageId)?.name ?? assignment.crew} acceptedScope={work.deploy?.workAcceptance?.receipt === "Accepted" && currentWorkAcceptanceScope(work)} hosted />;
  }
  assertProofEnvironment();
  const context = await getRequestContext();
  if (!context.authenticated) redirect("/auth/sign-in?next=%2Fwork%2Fmy-schedule");
  const workspace = context.status === "authorized" && context.workspace && context.membership?.status === "active" ? scheduleWorkspaceKeys[context.workspace.id] : undefined;
  const person = workspace && context.user?.id ? await crewPersonForUser(workspace, context.user.id) : null;
  if (!workspace || !person || !context.user?.id) redirect("/work");
  const query = await searchParams;
  const schedule = await loadSchedule(workspace);
  const latest = schedule.publications.filter((item) => item.week === schedule.publications.find((entry) => entry.id === query.publication)?.week).at(-1);
  const assignment = latest && latest.id === query.publication ? latest.assignments.find((item) => item.id === query.booking && item.people.includes(person)) : null;
  if (!assignment || !latest) return <WorkerSurfaceStatus workspace={workspace} hosted={false} title="Assigned work changed" message="This published booking is no longer current for your signed-in identity. Review your schedule again." />;
  const loaded = await loadPrototypeWork(workspace);
  const work = loaded.records.find((item) => item.id === assignment.workId) as WorkRecord | undefined;
  if (!work) return <WorkerSurfaceStatus workspace={workspace} hosted={false} title="Work Record unavailable" message="Return to My schedule to review the current assignment." />;
  const fieldWork = deployWorkerProjection(work, assignment.packageId, assignment.id, context.user.id);
  return <CrewFieldWork initialWork={fieldWork} initialRevision={loaded.revision} initialScheduleRevision={schedule.revision} assignment={assignment} publicationId={latest.id} actorId={context.user.id} person={person} packageName={work.packages?.find((item) => item.id === assignment.packageId)?.name ?? assignment.crew} acceptedScope={work.deploy?.workAcceptance?.receipt === "Accepted" && currentWorkAcceptanceScope(work)} />;
}
