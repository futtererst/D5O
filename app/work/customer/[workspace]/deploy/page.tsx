import { redirect } from "next/navigation";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import type { SharedSchedule } from "@/components/d5o/platform/schedule-model";
import { CustomerDeployWorkspace } from "@/components/d5o/customer-work/CustomerDeployWorkspace";
import { customerWorkScope } from "@/lib/d5o/hosted/customer-work-scope";
import { HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { hostedConfigurationInventory } from "@/lib/d5o/hosted/configuration-inventory";
import { validateDeployControlPolicy, type DeployControlPolicy } from "@/components/d5o/platform/deploy-policy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deploy decisions | D5O" };

export default async function CustomerDeployPage({ params, searchParams }: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ workId?: string }>;
}) {
  const { workspace } = await params;
  let scoped: Awaited<ReturnType<typeof customerWorkScope>>;
  try { scoped = await customerWorkScope(workspace); }
  catch (error) {
    if (error instanceof HostedStateError && error.code === "unauthenticated")
      redirect(`/auth/sign-in?next=${encodeURIComponent(`/work/customer/${workspace}/deploy`)}`);
    return <main><h1>Deploy unavailable</h1><p>Your organization or role cannot access this Work.</p></main>;
  }
  const { workId } = await searchParams;
  if (!workId) return <main><h1>Select Work</h1><p>Open a Deploy responsibility from My Work.</p></main>;
  const [source, schedule] = await Promise.all([scoped.context.read("work"), scoped.context.read("schedule")]);
  const work = (source.state?.records as WorkRecord[] | undefined)
    ?.find((item) => item.id === workId && item.workspace === workspace && !!item.canonicalWorkId);
  if (!work) return <main><h1>Work unavailable</h1><p>This Work is not available in your organization.</p></main>;
  const inventory = await hostedConfigurationInventory(workspace as WorkRecord["workspace"]);
  const version = inventory.versions.find((item) => item.id === work.phaseConfigurationVersionId &&
    ["published", "superseded"].includes(item.status));
  if (work.phaseConfigurationVersionId && !version)
    return <main><h1>Deploy unavailable</h1><p>The pinned operating configuration could not be resolved.</p></main>;
  const manifest = version?.config_manifest_json?.d5oPresentation as { phaseContract?: {
    workTypes?: Array<{ workTypeKey?: string; workTypeLabel?: string; deployControls?: DeployControlPolicy }> } } | undefined;
  const configured = manifest?.phaseContract?.workTypes?.find((item) => item.workTypeKey === work.type ||
    item.workTypeLabel?.toLowerCase() === work.type.toLowerCase())?.deployControls;
  const policy = configured && validateDeployControlPolicy(configured).length === 0 ? configured : undefined;
  return <main className="d5o-customer-work-page"><CustomerDeployWorkspace initialWork={work}
    initialSchedule={schedule.state ? { ...schedule.state, revision: schedule.revision } as SharedSchedule : null} initialSourceRevision={source.revision}
    initialScheduleRevision={schedule.revision} actorId={scoped.context.actor.id}
    role={scoped.context.actor.role} policy={policy} /></main>;
}
