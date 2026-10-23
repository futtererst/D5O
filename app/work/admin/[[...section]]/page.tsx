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
import { AdminMobileNav } from "@/components/d5o/admin/AdminMobileNav";
import { AdminIdentityBoundary } from "@/components/d5o/admin/AdminIdentityBoundary";
import { OrgAdminPanel } from "@/components/d5o/admin/OrgAdminPanel";
import { D5OProductHeader } from "@/components/d5o/platform/D5OProductHeader";
import { customerAdminWorkspaceAuthorized } from "@/lib/d5o/admin/customer-workspace";
import styles from "./admin.module.css";
import "../../enterprise.css";
import "../../settings/notification-settings.css";
import "./admin-console.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workspace administration | D5O" };

const sections = [
  ["organization", "Organization"], ["organization-settings", "Settings"],
  ["business-units", "Business units"], ["locations", "Locations"], ["teams", "Teams"],
  ["people", "People"], ["invitations", "Invitations"], ["roles", "Roles & access"],
  ["activity", "Administration activity"],
  ["overview", "Pilot overview"], ["users", "Pilot access"],
  ["workforce", "Workforce"], ["configuration", "Configuration"],
  ["authority", "Authority and rates"], ["audit", "Audit"],
] as const;

export default async function WorkspaceAdminPage({ params, searchParams }: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<{ workspace?: string; subject?: string; search?: string; offset?: string;
    actor?: string; action?: string; from?: string; to?: string }>;
}) {
  const [{ section }, query] = await Promise.all([params, searchParams]);
  const workspace = query.workspace ?? "rybex";
  if (!await customerAdminWorkspaceAuthorized(workspace) || (section?.length ?? 0) > 2) notFound();
  const active = section?.[0] ?? "overview";
  if (!sections.some(([key]) => key === active)) notFound();
  const newSections = ["organization", "organization-settings", "business-units", "locations",
    "teams", "people", "invitations", "roles", "activity"];
  const visibleSections = sections.filter(([key]) => (workspace === "rybex" || key === "configuration" || newSections.includes(key))
    && !["overview", "users"].includes(key));
  if (workspace !== "rybex" && active !== "configuration" && !newSections.includes(active)) notFound();
  if (section?.length === 2 && !["users", "workforce"].includes(active)) notFound();
  const selectedId = section?.[1];
  if (selectedId && !/^[0-9a-f-]{36}$/i.test(selectedId)) notFound();
  const offset = Math.max(0, Math.min(10000, Number.parseInt(query.offset ?? "0", 10) || 0));
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
  return <AdminIdentityBoundary userId={context.actor.id}><>{workspace === "rybex" && <D5OProductHeader workspace="rybex" homeHref="/work?workspace=rybex" area="Administration" hostedPreview />}<main className={`${styles.shell} d5o-admin-console`}>
    <div className={styles.frame}>
      <aside className={styles.rail} aria-label="Administration navigation">
        <p className={styles.railLabel}>{context.actor.workspaceName ?? workspace} · Administration</p>
        <nav className={styles.nav} aria-label="Administrator sections">{visibleSections.map(([key, label]) =>
          <Link key={key} href={href(key)} aria-current={active === key ? "page" : undefined}>{label}</Link>)}</nav>
        {workspace === "rybex" && <Link className={styles.returnLink} href={`/work?workspace=${workspace}`}>← Return to Work</Link>}
      </aside>
      <div className={styles.mainColumn}>
        <AdminMobileNav active={active} sections={visibleSections} workspace={workspace} />
        <header className={styles.header}>
          <div><p>Administration / {sections.find(([key]) => key === active)?.[1]}</p><h1>{sections.find(([key]) => key === active)?.[1]}</h1></div>
        </header>
        <p className={styles.notice}>Tenant: {workspace} · Administrative changes retain their governed decision history.</p>
    <section className={styles.content}>
      {newSections.includes(active) && <OrgAdminPanel workspace={workspace} settingsOnly={active === "organization-settings"} kind={
        active === "organization" || active === "organization-settings" ? "overview" :
        active === "business-units" ? "units" : active as "locations" | "teams" | "people" | "invitations" | "roles" | "activity"} />}
      {active === "overview" && <AdminOverview workspace="rybex" />}
      {active === "users" && <MemberAccessPanel workspace="rybex" selectedUserId={selectedId}
        initialSearch={(query.search ?? "").slice(0, 120)} initialOffset={offset} />}
      {active === "workforce" && <CrewAccessPanel selectedPersonId={selectedId} />}
      {active === "configuration" && <AdminConfigurationEditor workspace={workspace} />}
      {active === "authority" && <div className={styles.authority}><SpendingDelegationAdmin workspace="rybex" />
        <DesignInternalRateControl workspace="rybex" role="admin" /></div>}
      {active === "audit" && <AdminAudit workspace="rybex" initialOffset={offset} initialFilters={{
        actor:(query.actor ?? "").slice(0,120), action:(query.action ?? "").slice(0,120),
        subject:(query.subject ?? "").slice(0,120), from:query.from ?? "", to:query.to ?? "" }} />}
    </section>
        <footer className={styles.diagnostic}>Build {(process.env.D5O_SOURCE_SHA ?? "source-unidentified").slice(0, 12)}</footer>
      </div>
    </div>
  </main></></AdminIdentityBoundary>;
}
