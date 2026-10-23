import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadPlatformTenants } from "@/lib/d5o/admin/platform-directory";
import styles from "./platform-admin.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform administration | D5O" };

export default async function PlatformAdminPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  let tenants;
  try { tenants = await loadPlatformTenants(); }
  catch (error) {
    if (error instanceof Error && error.message === "platform_unauthenticated")
      redirect(`/auth/sign-in?next=${encodeURIComponent("/platform-admin")}`);
    if (error instanceof Error && error.message === "platform_forbidden") notFound();
    throw error;
  }
  const q = ((await searchParams).q ?? "").trim().slice(0, 120);
  const visible = tenants.filter((tenant) => `${tenant.name} ${tenant.workspaceKey}`.toLowerCase().includes(q.toLowerCase()));
  return <main className={styles.shell}><aside className={styles.rail} aria-label="Platform administration navigation">
    <strong>D5O Platform Administration</strong><nav><Link href="/platform-admin" aria-current="page">Tenant directory</Link></nav>
    <p>Provisioning, billing, support access and monitoring are unavailable until their authoritative services are established.</p>
  </aside><div className={styles.main}><p className={styles.eyebrow}>Platform / Tenants</p><h1>Tenant directory</h1>
    <p>Read-only workspace status and published configuration. Customer decision rights are never inherited by platform administrators.</p>
    <form method="get" className={styles.search}><label htmlFor="tenant-search">Search tenants</label><input id="tenant-search" name="q" defaultValue={q} maxLength={120} /><button>Search</button></form>
    <p role="status">{visible.length} of {tenants.length} tenant(s)</p>
    {visible.length ? <div className={styles.tableWrap}><table><thead><tr><th scope="col">Tenant</th><th scope="col">Status</th><th scope="col">Active configuration</th><th scope="col">Versions</th><th scope="col">Details</th></tr></thead>
      <tbody>{visible.map((tenant) => <tr key={tenant.workspaceId}><th scope="row">{tenant.name}<small>{tenant.workspaceKey}</small></th><td>{tenant.status}</td><td>{tenant.activeVersion ? `v${tenant.activeVersion}` : "Unavailable"}</td><td>{tenant.versionCount}</td><td><Link href={`/platform-admin/tenants/${encodeURIComponent(tenant.workspaceKey)}`}>View tenant</Link></td></tr>)}</tbody></table></div>
      : <p>No tenants match this search.</p>}</div></main>;
}
