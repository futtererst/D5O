import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { hostedWorkerContext } from "@/lib/d5o/hosted/worker-context";
import { HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { customerWorkspaceKey } from "@/lib/d5o/hosted/customer-work-scope";
import { CustomerDevelopAssignments } from "@/components/d5o/customer-work/CustomerDevelopAssignments";
import "../work.css";

export const dynamic = "force-dynamic";
export default async function CustomerAssignmentsPage({ params }: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  if (!customerWorkspaceKey.test(workspace) || workspace === "rybex" || workspace === "rotork") notFound();
  let worker;
  try { worker = await hostedWorkerContext(workspace); }
  catch (error) {
    if (error instanceof HostedStateError && error.code === "unauthenticated")
      redirect(`/auth/sign-in?next=${encodeURIComponent(`/work/customer/${workspace}/assignments`)}`);
    notFound();
  }
  return <main className="d5o-customer-work"><header className="d5o-customer-work-header">
    <div><p>D5O · Employee Work · {worker.workspaceName}</p><h1>My assigned Work</h1>
      <span>Only your published crew assignments are available here.</span></div>
    <nav aria-label="Workspace navigation"><Link href="/work">Switch organization</Link></nav>
  </header><CustomerDevelopAssignments workspace={workspace} /></main>;
}
