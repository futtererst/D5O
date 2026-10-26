import { redirect } from "next/navigation";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import type { SharedSchedule } from "@/components/d5o/platform/schedule-model";
import { currentWorkAcceptanceScope } from "@/components/d5o/platform/deploy-model";
import { CrewFieldWork } from "@/app/work/my-schedule/field/CrewFieldWork";
import { WorkerSurfaceStatus } from "@/app/work/my-schedule/WorkerSurfaceStatus";
import { deployWorkerProjection } from "@/lib/d5o/prototype-work/deploy-worker-projection";
import { hostedWorkerContext } from "@/lib/d5o/hosted/worker-context";
import { customerWorkspaceKey } from "@/lib/d5o/hosted/customer-work-scope";
import { HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assigned field execution | D5O" };

export default async function CustomerFieldPage({ params, searchParams }: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ booking?: string; publication?: string }>;
}) {
  const { workspace } = await params;
  if (!customerWorkspaceKey.test(workspace) || workspace === "rybex" || workspace === "rotork") {
    return <WorkerSurfaceStatus title="Assigned work is unavailable" message="Open your organization's current assignment." />;
  }
  let worker: Awaited<ReturnType<typeof hostedWorkerContext>>;
  try { worker = await hostedWorkerContext(workspace); }
  catch (error) {
    if (error instanceof HostedStateError && error.code === "unauthenticated")
      redirect(`/auth/sign-in?next=${encodeURIComponent(`/work/customer/${workspace}/assignments`)}`);
    return <WorkerSurfaceStatus title="Assigned work is unavailable" message="Your active field assignment or access could not be verified." />;
  }
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown; error: { message: string } | null }>;
  const { data, error } = await call("d5o_hosted_capability_read_v1", { p_workspace_key: workspace });
  if (error || (data as { connectedWork?: boolean } | null)?.connectedWork !== true)
    return <WorkerSurfaceStatus title="Field execution is unavailable" message="This organization does not currently have connected Work access." />;
  const query = await searchParams;
  const [scheduleResult, workResult] = await Promise.all([worker.read("schedule"), worker.read("work")]);
  const schedule = scheduleResult.state as SharedSchedule | null;
  const publication = schedule?.publications.find((item) => item.id === query.publication);
  const latest = publication && schedule?.publications.filter((item) => item.week === publication.week).at(-1);
  const assignment = latest?.id === publication?.id
    ? publication?.assignments.find((item) => item.id === query.booking && item.people.includes(worker.person)) : null;
  const work = (workResult.state?.records as WorkRecord[] | undefined)
    ?.find((item) => item.id === assignment?.workId && item.workspace === workspace);
  if (!assignment || !work?.canonicalWorkId || !publication)
    return <WorkerSurfaceStatus title="Assigned work changed" message="Review the current booking in My Work before entering field work." />;
  return <CrewFieldWork initialWork={deployWorkerProjection(work, assignment.packageId, assignment.id, worker.actor.id)}
    initialRevision={workResult.revision} initialScheduleRevision={scheduleResult.revision}
    assignment={assignment} publicationId={publication.id} actorId={worker.actor.id}
    person={worker.person} packageName={work.packages?.find((item) => item.id === assignment.packageId)?.name ?? assignment.crew}
    acceptedScope={work.deploy?.workAcceptance?.receipt === "Accepted" && currentWorkAcceptanceScope(work)}
    hosted tenantNeutral organizationName={worker.workspaceName} />;
}
