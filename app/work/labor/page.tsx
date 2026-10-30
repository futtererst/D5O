import { redirect } from "next/navigation";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { LaborAuthorityWorkspace } from "@/components/d5o/platform/LaborAuthorityWorkspace";
import { D5OProductHeader } from "@/components/d5o/platform/D5OProductHeader";
import { customerWorkspaceKey } from "@/lib/d5o/hosted/customer-work-scope";
import "../enterprise.css";
import "../settings/notification-settings.css";

export const dynamic = "force-dynamic";
export default async function LaborPage({ searchParams }: {
  searchParams: Promise<{ workspace?: string; workId?: string; step?: string; sourceRevision?: string; decision?: string }>
}) {
  const params = await searchParams;
  const workspace = params.workspace ?? "", workId = params.workId ?? "";
  if (!customerWorkspaceKey.test(workspace) || !/^[\w-]{8,120}$/.test(workId)) redirect("/work");
  const client = await createRybexSupabaseServerClient();
  const user = await client.auth.getUser();
  if (!user.data.user) redirect("/auth/sign-in?next=" + encodeURIComponent("/work/labor?workspace=" + workspace + "&workId=" + workId));
  const workspaces = await client.rpc("d5o_hosted_workspaces_v1");
  const role = (Array.isArray(workspaces.data) ? workspaces.data as Array<{ workspaceKey: string; role: string }> : [])
    .find((item) => item.workspaceKey === workspace)?.role;
  if (!role || !["admin", "project_manager", "operations_leader", "billing_commercial_lead"].includes(role)) redirect("/work?workspace=" + workspace);
  return <><D5OProductHeader workspace={workspace as "rybex" | "rotork"} homeHref={`/work?workspace=${workspace}`} area="Labor authority" hostedPreview />
    <LaborAuthorityWorkspace workspace={workspace} workId={workId} role={role}
      build={process.env.D5O_SOURCE_SHA ?? "source-unidentified"}
      task={params.sourceRevision ? { step: params.step ?? "", revision: Number(params.sourceRevision), decision: params.decision ?? "" } : undefined} /></>;
}
