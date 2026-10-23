import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/d5o/auth/request-context";
import { assertProofEnvironment } from "@/lib/d5o/work-record/server";
import { crewPersonForUser, scheduleWorkspaceKeys } from "@/lib/d5o/scheduling/crew-identity";
import { CrewScheduleView } from "./CrewScheduleView";
import { hostedD5OTargetReady } from "@/lib/d5o/auth/hosted-target";
import { hostedWorkerContext } from "@/lib/d5o/hosted/worker-context";
import { HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { WorkerSurfaceStatus } from "./WorkerSurfaceStatus";
import "./crew-schedule.css";
import "../settings/notification-settings.css";

export const metadata = { title: "My crew schedule | D5O" };

export default async function MyCrewSchedulePage() {
  if (hostedD5OTargetReady()) {
    let person = "";
    let failure = "";
    try { person = (await hostedWorkerContext("rybex")).person; }
    catch (error) { failure = error instanceof HostedStateError ? error.code : "worker_unavailable"; }
    if (failure === "unauthenticated") redirect("/auth/sign-in?next=%2Fwork%2Fmy-schedule");
    if (failure) return <WorkerSurfaceStatus title="My assigned work is unavailable" message="Your account needs an active field-worker role and roster assignment. Ask your System Administrator to check your access." showScheduleLink={false} />;
    return <CrewScheduleView workspace="rybex" person={person} hosted />;
  }
  assertProofEnvironment();
  const context = await getRequestContext();
  if (!context.authenticated) redirect("/auth/sign-in?next=%2Fwork%2Fmy-schedule");
  const workspace = context.status === "authorized" && context.workspace && context.membership?.status === "active"
    ? scheduleWorkspaceKeys[context.workspace.id] : undefined;
  const person = workspace && context.user?.id ? await crewPersonForUser(workspace, context.user.id) : null;
  if (!workspace || !person) redirect("/work");
  return <CrewScheduleView workspace={workspace} person={person} />;
}
