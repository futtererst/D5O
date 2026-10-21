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
import { publishInitialConfiguration } from "./initial-configuration-action";

export const metadata = { title: "D5O Work" };
export const dynamic = "force-dynamic";

export default async function WorkHomePage({ searchParams }: {
  searchParams?: Promise<{ workspace?: string; setupError?: string }>;
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
    const params = await searchParams;
    const selected = params?.workspace;
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
      {!entries.length ? <section role="status" className={styles.setup}>
        <h2>Account ready · workspace access pending</h2>
        <p>Your sign-in account is active, but a workspace administrator has not granted access. Ask your trial operator to review the pending invitation and make a separate access decision. Field workers also need a fictional roster person and account binding before My Schedule opens.</p>
        <p>Signing in does not grant Work, roster, financial or private-document access.</p>
      </section> : null}
      <p className={styles.notice}>{isolatedPilot ? "Isolated pilot database. Decision authority remains under qualification." : "Authenticated commands govern canonical Work Records. Historical prototype records retain their recorded provenance."} Build {sourceVersion.slice(0, 12)}.</p>
      <Link className={styles.signout} href="/auth/sign-out" prefetch={false}>Sign out</Link>
    </main>;
    const permitted = entries.find((entry) => entry.workspaceKey === selected);
    if (!permitted || selected !== "rybex" && selected !== "rotork")
      return <main className={styles.entry}>
        <div className={styles.brand}>D5O <span>System of work</span></div>
        <section className={styles.intro} role="status">
          <p>WORKSPACE ACCESS</p>
          <h1>Workspace unavailable</h1>
          <span>This account cannot open the requested D5O workspace. Your current membership controls which workspace you can enter.</span>
        </section>
        <section className={styles.setup}>
          <h2>What to do next</h2>
          <p>Choose an available workspace, or sign out to use another account.</p>
          <div className={styles.entryActions}>
            <Link href="/work">Choose a workspace</Link>
            <Link href="/auth/sign-out" prefetch={false}>Sign out</Link>
          </div>
        </section>
        <p className={styles.notice}>Workspace access is managed separately from sign-in. Build {sourceVersion.slice(0, 12)}.</p>
      </main>;
    if (permitted.role === "field_worker")
      redirect(`/work/my-schedule?workspace=${encodeURIComponent(permitted.workspaceKey)}`);
    const workspace = selected as WorkspaceKey;
    const configurationInventory = await hostedConfigurationInventory(workspace);
    if (configurationInventory.status !== "ready")
      return <main className={styles.entry}>
        <div className={styles.brand}>D5O <span>System of work</span></div>
        <section className={styles.intro} role="status">
          <p>WORKSPACE SETUP</p>
          <h1>Configuration approval is still needed.</h1>
          <span>{configurationInventory.status === "no_mapping"
            ? "This workspace has no active configuration tenant. Work and decisions remain unavailable until an administrator publishes the first approved version."
            : configurationInventory.status === "unavailable_version"
              ? "This workspace has no current published configuration. Work and decisions remain unavailable until an approved version is active."
              : "More than one configuration mapping applies to this workspace. An administrator must resolve the conflict before work resumes."}</span>
        </section>
        <p className={styles.notice}>{permitted.role === "admin"
          ? "Review the Work Types, phase contract, creation rights and receiving roles with the accountable owner before the first publication. The existing Work Record and decision controls remain locked until then."
          : "Your workspace administrator owns this setup. Your current role cannot publish its business rules."} Build {sourceVersion.slice(0, 12)}.</p>
        {workspace === "rybex" && permitted.role === "admin" && configurationInventory.status === "no_mapping"
          ? <section className={styles.setup}>
            <h2>Publish the first Work configuration</h2>
            <p>Review the approved initial choices. Publication pins these rules to future Work; it does not approve a customer award, spending, field work or support activation.</p>
            <dl><dt>Work Types</dt><dd>Technical delivery; Lifecycle service</dd>
              <dt>Work creation</dt><dd>Admin; Project Manager</dd>
              <dt>Phase order</dt><dd>Discover → Define → Develop → Design → Deploy → Operate</dd></dl>
            <form action={publishInitialConfiguration}>
              <input type="hidden" name="commandId" value={crypto.randomUUID()} />
              <label>Discover → Define receiving role
                <select name="discoverDefine" required defaultValue=""><option value="" disabled>Choose an existing role</option>
                  <option value="admin">Admin</option><option value="project_manager">Project Manager</option>
                  <option value="operations_leader">Operations Leader</option></select></label>
              <label>Design → Deploy receiving role
                <select name="designDeploy" required defaultValue=""><option value="" disabled>Choose an existing role</option>
                  <option value="admin">Admin</option><option value="project_manager">Project Manager</option>
                  <option value="operations_leader">Operations Leader</option></select></label>
              <label>Deploy → Operate receiving role
                <select name="deployOperate" required defaultValue=""><option value="" disabled>Choose an existing role</option>
                  <option value="admin">Admin</option><option value="project_manager">Project Manager</option>
                  <option value="operations_leader">Operations Leader</option></select></label>
              <label>Publication reason<input name="reason" required minLength={8} maxLength={240} placeholder="Record the approved first-configuration basis" /></label>
              {params?.setupError ? <p role="alert">{params.setupError === "receiver"
                ? "That receiving role has no active workspace member. Assign an eligible member or select another approved role."
                : params.setupError === "changed" ? "Configuration changed. Refresh this workspace before deciding again."
                  : params.setupError === "authority" ? "Only an active workspace administrator can publish this configuration."
                    : "Publication did not complete. Review the current configuration before retrying."}</p> : null}
              <button type="submit">Publish reviewed configuration</button>
            </form>
          </section> : null}
        <Link className={styles.signout} href="/work">Choose a workspace</Link>
      </main>;
    return <D5OPlatform initialWorkspace={workspace} actorId={userData.user.id} actorRole={permitted.role}
      configurationInventory={configurationInventory}
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
