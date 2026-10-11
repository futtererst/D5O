import { redirect } from "next/navigation";
import { D5OPlatform } from "@/components/d5o/platform/D5OPlatform";
import { getRequestContext } from "@/lib/d5o/auth/request-context";
import { assertProofEnvironment } from "@/lib/d5o/work-record/server";
import { crewPersonForUser, scheduleWorkspaceKeys } from "@/lib/d5o/scheduling/crew-identity";
import { loadConfigurationInventory } from "@/lib/d5o/configuration/server";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { d5oCommandRuntime, hostedD5OTargetReady } from "@/lib/d5o/auth/hosted-target";
import { hostedConfigurationInventory } from "@/lib/d5o/hosted/configuration-inventory";
import type { WorkspaceKey } from "@/components/d5o/platform/work-types";
import Link from "next/link";
import "./enterprise.css";
import "./settings/notification-settings.css";
import styles from "./hosted-entry.module.css";

export const metadata = { title: "D5O Work" };
export const dynamic = "force-dynamic";

export default async function WorkHomePage({ searchParams }: {
  searchParams?: Promise<{ workspace?: string }>;
}) {
  const sourceVersion = process.env.D5O_SOURCE_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "source-unidentified";
  const commandRuntime = d5oCommandRuntime();
  const isolatedPilot = commandRuntime === "pilot" || commandRuntime === "rehearsal";
  const authoritativeCommands = commandRuntime !== null;
  if (process.env.D5O_HOSTED_ENABLED === "1") {
    if (!hostedD5OTargetReady()) throw new Error("hosted_target_unavailable");
    const client = await createRybexSupabaseServerClient();
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) redirect("/auth/sign-in?next=%2Fwork");
    const result = await client.rpc("d5o_hosted_workspaces_v1");
    if (result.error || !Array.isArray(result.data)) throw new Error("hosted_workspace_unavailable");
    const entries = result.data as Array<{ workspaceKey: string; workspaceName: string; role: string }>;
    const selected = (await searchParams)?.workspace;
    if (!selected && entries.length === 1 && entries[0].role === "field_worker")
      redirect(`/work/my-schedule?workspace=${encodeURIComponent(entries[0].workspaceKey)}`);
    if (!selected) return <main className={styles.entry}>
      <div className={styles.brand}>D5O <span>System of work</span></div>
      <section className={styles.intro}>
        <p>YOUR WORKSPACES · {isolatedPilot ? "ISOLATED PILOT" : "D5O WORKSPACE"}</p>
        <h1>Choose the work you’re here to move forward.</h1>
        <span>Each workspace has its own people, Work Records, configuration and decisions. Your membership controls which one you can open.</span>
      </section>
      <div className={styles.grid}>{entries.map((entry) => <Link className={styles.card}
        data-workspace={entry.workspaceKey} key={entry.workspaceKey}
        href={`/work?workspace=${encodeURIComponent(entry.workspaceKey)}`}>
        <span className={styles.marker} aria-hidden="true" />
        <div><small>WORKSPACE</small><h2>{entry.workspaceName}</h2>
          <p>{entry.workspaceKey === "rybex" ? "Technical delivery and controlled turnover" : "Modernization, paid pilots and lifecycle service"}</p>
          <span className={styles.role}>Your role: {entry.role.replaceAll("_", " ")}</span></div>
        <strong>Open workspace →</strong>
      </Link>)}</div>
      {!entries.length ? <p role="status">No D5O workspace membership is assigned to this account.</p> : null}
      <p className={styles.notice}>{isolatedPilot ? "Isolated pilot database. Decision authority remains under qualification." : "Authenticated commands govern canonical Work Records. Historical prototype records retain their recorded provenance."} Build {sourceVersion.slice(0, 12)}.</p>
      <Link className={styles.signout} href="/auth/sign-out" prefetch={false}>Switch account</Link>
    </main>;
    const permitted = entries.find((entry) => entry.workspaceKey === selected);
    if (!permitted || selected !== "rybex" && selected !== "rotork")
      return <main className={styles.entry}><h1>Workspace unavailable</h1>
        <p>This account cannot open the requested D5O workspace.</p><Link href="/work">Choose a workspace</Link></main>;
    if (permitted.role === "field_worker")
      redirect(`/work/my-schedule?workspace=${encodeURIComponent(permitted.workspaceKey)}`);
    const workspace = selected as WorkspaceKey;
    return <D5OPlatform initialWorkspace={workspace} actorId={userData.user.id} actorRole={permitted.role}
      configurationInventory={await hostedConfigurationInventory(workspace)}
      actorLabel={`${userData.user.email ?? "Workspace member"} · ${permitted.role.replaceAll("_", " ")} · ${isolatedPilot ? "isolated pilot" : "authenticated workspace"}`}
      hostedPreview authoritativeCommands={authoritativeCommands} sourceVersion={sourceVersion} />;
  }
  assertProofEnvironment();
  const context = await getRequestContext();
  if (!context.authenticated) redirect("/auth/sign-in?next=%2Fwork");
  if (context.status !== "authorized" || !context.workspace) redirect("/auth/sign-in?next=%2Fwork");
  const initialWorkspace = scheduleWorkspaceKeys[context.workspace.id] ?? null;
  if (!initialWorkspace) redirect("/auth/sign-in?next=%2Fwork");
  if (context.user?.id && await crewPersonForUser(initialWorkspace, context.user.id)) redirect("/work/my-schedule");
  const configurationInventory = await loadConfigurationInventory(context.workspace.id);
  const actorLabel = `${context.profile?.displayName ?? context.user?.name ?? "Workspace member"} · ${context.role?.replaceAll("_", " ") ?? "member"}`;
  return <D5OPlatform initialWorkspace={initialWorkspace} configurationInventory={configurationInventory} actorLabel={actorLabel} actorRole={context.role} actorId={context.user?.id} sourceVersion={sourceVersion} />;
}
