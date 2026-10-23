import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { HostedStateError, hostedPrototypeContext } from "@/lib/d5o/hosted/prototype-context";
import { MemberAccessPanel } from "@/components/d5o/platform/MemberAccessPanel";
import { CrewAccessPanel } from "@/components/d5o/platform/CrewAccessPanel";
import { AdminConfigurationEditor } from "@/components/d5o/admin/AdminConfigurationEditor";
import { SpendingDelegationAdmin } from "@/components/d5o/platform/SpendingDelegationAdmin";
import { DesignInternalRateControl } from "@/components/d5o/platform/DesignInternalRateControl";
import { AdminAudit } from "@/components/d5o/admin/AdminAudit";
import { AdminOverview } from "@/components/d5o/admin/AdminOverview";
import { AdminIdentityBoundary } from "@/components/d5o/admin/AdminIdentityBoundary";
import { D5OProductHeader } from "@/components/d5o/platform/D5OProductHeader";
import styles from "./admin.module.css";
import "../../enterprise.css";
import "../../settings/notification-settings.css";
import "./admin-console.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workspace administration | D5O" };

const sections = [
  ["overview", "Overview"], ["users", "Users & access"],
  ["workforce", "Workforce"], ["configuration", "Configuration"],
  ["authority", "Authority and rates"], ["audit", "Audit"],
] as const;

export default async function WorkspaceAdminPage({ params, searchParams }: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<{ workspace?: string; subject?: string }>;
}) {
  const [{ section }, query] = await Promise.all([params, searchParams]);
  const workspace = query.workspace ?? "rybex";
  if (workspace !== "rybex" || (section?.length ?? 0) > 2) notFound();
  const active = section?.[0] ?? "overview";
  if (!sections.some(([key]) => key === active)) notFound();
  if (section?.length === 2 && !["users", "workforce"].includes(active)) notFound();
  const selectedId = section?.[1];
  if (selectedId && !/^[0-9a-f-]{36}$/i.test(selectedId)) notFound();
  let context: Awaited<ReturnType<typeof hostedPrototypeContext>>;
  try { context = await hostedPrototypeContext(workspace); }
  catch (error) {
    if (error instanceof HostedStateError && error.status === 401) {
      const path = `/work/admin${section?.length ? `/${section.join("/")}` : ""}?workspace=${workspace}`;
      redirect(`/auth/sign-in?next=${encodeURIComponent(path)}`);
    }
    if (error instanceof HostedStateError && error.status === 403) notFound();
    throw error;
  }
  if (context.actor.role !== "admin") notFound();
  const href = (key: string) => `/work/admin/${key}?workspace=${workspace}`;
  return <AdminIdentityBoundary userId={context.actor.id}><><D5OProductHeader workspace="rybex" homeHref="/work?workspace=rybex" area="Administration" hostedPreview /><main className={`${styles.shell} d5o-admin-console`}>
    <div className={styles.frame}>
      <aside className={styles.rail} aria-label="Administration navigation">
        <p className={styles.railLabel}>Rybex · Administration</p>
        <nav className={styles.nav} aria-label="Administrator sections">{sections.map(([key, label]) =>
          <Link key={key} href={href(key)} aria-current={active === key ? "page" : undefined}>{label}</Link>)}</nav>
        <Link className={styles.returnLink} href={`/work?workspace=${workspace}`}>← Return to Work</Link>
      </aside>
      <div className={styles.mainColumn}>
        <details className={styles.mobileNav}><summary>Admin sections · {sections.find(([key]) => key === active)?.[1]}</summary>
          <nav aria-label="Administrator sections on small screens">{sections.map(([key, label]) =>
            <Link key={key} href={href(key)} aria-current={active === key ? "page" : undefined}>{label}</Link>)}</nav>
          <Link href={`/work?workspace=${workspace}`}>← Return to Work</Link>
        </details>
        <header className={styles.header}>
          <div><p>RYBEX / ADMINISTRATION</p><h1>{sections.find(([key]) => key === active)?.[1]}</h1></div>
        </header>
        <p className={styles.notice}>Synthetic beta workspace · Administrative changes retain their governed decision history. Build {(process.env.D5O_SOURCE_SHA ?? "source-unidentified").slice(0, 12)}.</p>
    <section className={styles.content}>
      {active === "overview" && <AdminOverview workspace="rybex" />}
      {active === "users" && <MemberAccessPanel workspace="rybex" selectedUserId={selectedId} />}
      {active === "workforce" && <CrewAccessPanel selectedPersonId={selectedId} />}
      {active === "configuration" && <AdminConfigurationEditor workspace="rybex" />}
      {active === "authority" && <div className={styles.authority}><SpendingDelegationAdmin workspace="rybex" />
        <DesignInternalRateControl workspace="rybex" role="admin" /></div>}
      {active === "audit" && <AdminAudit workspace="rybex" initialSubject={query.subject ?? ""} />}
    </section>
      </div>
    </div>
  </main></></AdminIdentityBoundary>;
}
