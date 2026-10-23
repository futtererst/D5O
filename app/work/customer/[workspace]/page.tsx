import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { customerWorkScope, customerWorkspaceKey } from "@/lib/d5o/hosted/customer-work-scope";
import { HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { CustomerWorkExperience } from "@/components/d5o/customer-work/CustomerWorkExperience";
import "./work.css";

export const dynamic = "force-dynamic";
export default async function CustomerWorkPage({ params, searchParams }: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ work?: string }>;
}) {
  const { workspace } = await params;
  if (!customerWorkspaceKey.test(workspace) || workspace === "rybex" || workspace === "rotork")
    notFound();
  let scope: Awaited<ReturnType<typeof customerWorkScope>>;
  try { scope = await customerWorkScope(workspace); }
  catch (error) {
    if (error instanceof HostedStateError && error.code === "unauthenticated")
      redirect(`/auth/sign-in?next=${encodeURIComponent(`/work/customer/${workspace}`)}`);
    notFound();
  }
  const { work } = await searchParams;
  return <main className="d5o-customer-work">
    <header className="d5o-customer-work-header">
      <div><p>D5O · Customer Work</p><h1>Work lifecycle</h1>
        <span>Six phases. One governed Work record and its published operating policy.</span></div>
      <nav aria-label="Workspace navigation"><Link href="/work">Switch organization</Link>
        {["admin", "project_manager"].includes(scope.context.actor.role) &&
          <Link href={`/work/connected-work?workspace=${encodeURIComponent(workspace)}`}>Create Work</Link>}
        {scope.context.actor.role === "admin" &&
          <Link href={`/work/admin/configuration?workspace=${encodeURIComponent(workspace)}`}>Configuration</Link>}</nav>
    </header>
    <CustomerWorkExperience key={workspace} workspace={workspace} initialWorkId={work ?? ""} />
  </main>;
}
