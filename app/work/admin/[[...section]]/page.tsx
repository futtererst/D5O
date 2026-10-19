import Link from "next/link";
import { notFound } from "next/navigation";
import { hostedPrototypeContext } from "@/lib/d5o/hosted/prototype-context";
import { MemberAccessPanel } from "@/components/d5o/platform/MemberAccessPanel";
import { CrewAccessPanel } from "@/components/d5o/platform/CrewAccessPanel";
import { HandoffRoutingAdmin } from "@/components/d5o/platform/HandoffRoutingAdmin";
import { SpendingDelegationAdmin } from "@/components/d5o/platform/SpendingDelegationAdmin";
import { DesignInternalRateControl } from "@/components/d5o/platform/DesignInternalRateControl";
import { AdminAudit } from "@/components/d5o/admin/AdminAudit";
import { AdminIdentityBoundary } from "@/components/d5o/admin/AdminIdentityBoundary";
import styles from "./admin.module.css";
import "../../enterprise.css";

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
  const context = await hostedPrototypeContext(workspace);
  if (context.actor.role !== "admin") notFound();
  const href = (key: string) => `/work/admin/${key}?workspace=${workspace}`;
  return <AdminIdentityBoundary userId={context.actor.id}><main className={styles.shell}>
    <header className={styles.header}>
      <div><p>D5O / RYBEX / ADMINISTRATION</p><h1>{sections.find(([key]) => key === active)?.[1]}</h1>
        <span>Workspace administration for the synthetic beta. Decisions and Work remain governed by their own commands.</span></div>
      <Link href={`/work?workspace=${workspace}`}>Return to Work →</Link>
    </header>
    <nav className={styles.nav} aria-label="Administrator sections">{sections.map(([key, label]) =>
      <Link key={key} href={href(key)} aria-current={active === key ? "page" : undefined}>{label}</Link>)}</nav>
    <div className={styles.breadcrumb}><Link href={href("overview")}>Admin</Link><span>/</span><strong>{sections.find(([key]) => key === active)?.[1]}</strong></div>
    <section className={styles.content}>
      {active === "overview" && <div className={styles.cards}>
        <article><h2>Users & access</h2><p>Assign confirmed accounts to one workspace role, manage access, and inspect identity history.</p><Link href={href("users")}>Manage users →</Link></article>
        <article><h2>Workforce</h2><p>Maintain roster people, qualifications, capacity and worker-account bindings.</p><Link href={href("workforce")}>Manage people →</Link></article>
        <article><h2>Configuration</h2><p>Review published Work Types and set receiving roles for future Work.</p><Link href={href("configuration")}>Open configuration →</Link></article>
        <article><h2>Authority and rates</h2><p>Manage eligible decision delegates and independently reviewed internal Design rates.</p><Link href={href("authority")}>Open controls →</Link></article>
        <article><h2>Audit</h2><p>Inspect retained administrative commands and decisions in this workspace.</p><Link href={href("audit")}>Inspect audit →</Link></article>
      </div>}
      {active === "users" && <MemberAccessPanel workspace="rybex" selectedUserId={selectedId} />}
      {active === "workforce" && <CrewAccessPanel selectedPersonId={selectedId} />}
      {active === "configuration" && <><HandoffRoutingAdmin workspace="rybex" />
        <p>Published Work Types remain pinned on existing Work. Creation and retirement of Work Types and the hosted phase-policy editor are a separate release.</p>
        <p>Appearance settings in the Work workspace are browser-local preferences, not published operating policy.</p></>}
      {active === "authority" && <><SpendingDelegationAdmin workspace="rybex" />
        <DesignInternalRateControl workspace="rybex" role="admin" />
        <p>Finance prepares internal Design rates; an independent configured administrator approves their exact version. This page does not grant spending authority.</p></>}
      {active === "audit" && <AdminAudit workspace="rybex" initialSubject={query.subject ?? ""} />}
    </section>
  </main></AdminIdentityBoundary>;
}
