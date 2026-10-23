import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadPlatformTenants } from "@/lib/d5o/admin/platform-directory";
import styles from "../../platform-admin.module.css";

export const dynamic = "force-dynamic";

export default async function PlatformTenantPage({ params }: { params: Promise<{ workspace: string }> }) {
  let tenants;
  try { tenants = await loadPlatformTenants(); }
  catch (error) {
    if (error instanceof Error && error.message === "platform_unauthenticated") redirect("/auth/sign-in?next=%2Fplatform-admin");
    if (error instanceof Error && error.message === "platform_forbidden") notFound();
    throw error;
  }
  const { workspace } = await params;
  const tenant = tenants.find((item) => item.workspaceKey === workspace);
  if (!tenant) notFound();
  const policy = tenant.serviceApproval;
  return <main className={styles.shell}><aside className={styles.rail} aria-label="Platform administration navigation"><strong>D5O Platform Administration</strong>
    <nav><Link href="/platform-admin">Tenant directory</Link><span aria-current="page">Tenant detail</span></nav></aside>
    <div className={styles.main}><p className={styles.eyebrow}>Platform / Tenants / {tenant.name}</p><h1>{tenant.name}</h1>
      <p>Read-only configuration oversight. No support impersonation or tenant mutation is available.</p>
      <dl className={styles.details}><div><dt>Status</dt><dd>{tenant.status}</dd></div><div><dt>Workspace key</dt><dd>{tenant.workspaceKey}</dd></div>
        <div><dt>Active configuration</dt><dd>{tenant.activeVersion ? `v${tenant.activeVersion}` : "Unavailable"}</dd></div>
        <div><dt>Version count</dt><dd>{tenant.versionCount}</dd></div>
        <div><dt>Effective since</dt><dd>{tenant.activeSince ? new Date(tenant.activeSince).toLocaleString() : "Unavailable"}</dd></div>
        <div><dt>Service-work threshold</dt><dd>{typeof policy?.thresholdMinor === "number" ? `${policy.currency} ${(policy.thresholdMinor / 100).toFixed(2)}` : "Unconfigured"}</dd></div>
        <div><dt>Approval authority</dt><dd>{policy?.authorityRole ?? "Unconfigured"}</dd></div></dl>
      <Link href="/platform-admin">← Back to directory</Link></div></main>;
}
