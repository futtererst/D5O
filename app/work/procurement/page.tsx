import { redirect } from "next/navigation";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { GraybarWorkspace } from "@/components/d5o/platform/GraybarWorkspace";
import "../enterprise.css";

export const dynamic = "force-dynamic";
export default async function ProcurementPage({ searchParams }: { searchParams: Promise<{ workspace?: string; workId?: string; step?: string; sourceRevision?: string; decision?: string }> }) {
  const params = await searchParams;
  const workspace = params.workspace ?? "", workId = params.workId ?? "";
  if (!["rybex", "rotork"].includes(workspace) || !/^[\w-]{8,120}$/.test(workId)) redirect("/work");
  const client = await createRybexSupabaseServerClient();
  const user = await client.auth.getUser();
  if (!user.data.user) redirect(`/auth/sign-in?next=${encodeURIComponent(`/work/procurement?workspace=${workspace}&workId=${workId}`)}`);
  const workspaces = await client.rpc("d5o_hosted_workspaces_v1");
  const role = (Array.isArray(workspaces.data) ? workspaces.data as Array<{ workspaceKey: string; role: string }> : []).find((item) => item.workspaceKey === workspace)?.role;
  if (!role || role === "field_worker") redirect(`/work?workspace=${workspace}`);
  return <GraybarWorkspace workspace={workspace} workId={workId} role={role} build={process.env.D5O_SOURCE_SHA ?? "source-unidentified"} initialSection={params.step}
    task={params.sourceRevision ? { step: params.step ?? "quote", sourceRevision: Number(params.sourceRevision), decision: params.decision ?? "" } : undefined} />;
}
