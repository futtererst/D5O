import Link from "next/link";
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

export const dynamic = "force-dynamic";
export const metadata = { title: "My assigned work | D5O" };
export default async function FieldPage({ searchParams }: { searchParams: Promise<{ booking?: string; publication?: string }> }) {
  if (hostedD5OTargetReady()) {
    let worker: Awaited<ReturnType<typeof hostedWorkerContext>> | null = null;
    let failure = "";
    try { worker = await hostedWorkerContext("rybex"); }
    catch (error) { failure = error instanceof HostedStateError ? error.code : "worker_unavailable"; }
    if (failure === "unauthenticated") redirect("/auth/sign-in?next=%2Fwork%2Fmy-schedule");
    if (!worker) return <main style={{ maxWidth: 720, margin: "3rem auto", padding: "1rem" }}><h1>Assigned work is unavailable</h1><p>Ask your scheduler to check your crew binding and hosted worker access.</p><Link href="/work/my-schedule">Back to my crew schedule</Link></main>;
    const query = await searchParams;
    const [scheduleResult, workResult] = await Promise.all([worker.read("schedule"), worker.read("work")]);
    const schedule = scheduleResult.state as SharedSchedule | null;
    const publication = schedule?.publications.find((item) => item.id === query.publication);
    const latest = publication && schedule?.publications.filter((item) => item.week === publication.week).at(-1);
    const assignment = latest?.id === publication?.id ? publication?.assignments.find((item) => item.id === query.booking && item.people.includes(worker.person)) : null;
    const work = (workResult.state?.records as WorkRecord[] | undefined)?.find((item) => item.id === assignment?.workId && item.workspace === "rybex");
    if (!assignment || !work || !publication) return <main style={{ maxWidth: 720, margin: "3rem auto", padding: "1rem" }}><h1>Assigned work changed</h1><p>Review the current booking before entering field work.</p><Link href="/work/my-schedule">Back to my crew schedule</Link></main>;
    return <CrewFieldWork initialWork={deployWorkerProjection(work, assignment.packageId, assignment.id, worker.actor.id)} initialRevision={workResult.revision} initialScheduleRevision={scheduleResult.revision} assignment={assignment} publicationId={publication.id} actorId={worker.actor.id} person={worker.person} acceptedScope={work.deploy?.workAcceptance?.receipt === "Accepted" && currentWorkAcceptanceScope(work)} hosted />;
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
  if (!assignment || !latest) return <main style={{ maxWidth: 720, margin: "3rem auto", padding: "1rem" }}><h1>Assigned work changed</h1><p>This published booking is no longer current for your signed-in identity. Review your schedule again.</p><Link href="/work/my-schedule">Back to my crew schedule</Link></main>;
  const loaded = await loadPrototypeWork(workspace);
  const work = loaded.records.find((item) => item.id === assignment.workId) as WorkRecord | undefined;
  if (!work) return <main style={{ maxWidth: 720, margin: "3rem auto", padding: "1rem" }}><h1>Work Record unavailable</h1><Link href="/work/my-schedule">Back to my crew schedule</Link></main>;
  const fieldWork = deployWorkerProjection(work, assignment.packageId, assignment.id, context.user.id);
  return <CrewFieldWork initialWork={fieldWork} initialRevision={loaded.revision} initialScheduleRevision={schedule.revision} assignment={assignment} publicationId={latest.id} actorId={context.user.id} person={person} acceptedScope={work.deploy?.workAcceptance?.receipt === "Accepted" && currentWorkAcceptanceScope(work)} />;
}
