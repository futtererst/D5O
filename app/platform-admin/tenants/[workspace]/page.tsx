import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadPlatformProvisioning } from "@/lib/d5o/admin/platform-provisioning";
import { PlatformTenantActions } from "@/components/d5o/admin/PlatformTenantActions";
import styles from "../../platform-admin.module.css";

export const dynamic = "force-dynamic";
export default async function PlatformTenantPage({ params }: { params: Promise<{ workspace: string }> }) {
  let result;
  try { result = await loadPlatformProvisioning(); }
  catch (error) {
    if (error instanceof Error && error.message === "platform_unauthenticated")
      redirect("/auth/sign-in?next=%2Fplatform-admin");
    if (error instanceof Error && error.message === "platform_forbidden") notFound();
    throw error;
  }
  const { workspace } = await params;
  const tenant = result.tenants.find((item) => item.workspaceKey === workspace);
  if (!tenant) notFound();
  return <main className={styles.shell}><aside className={styles.rail} aria-label="Platform administration navigation">
    <strong>D5O Platform Administration</strong><nav><Link href="/platform-admin">Tenant directory</Link>
      <span aria-current="page">Tenant detail</span></nav></aside>
    <div className={styles.main}><p className={styles.eyebrow}>Platform / Tenants / {tenant.name}</p>
      <h1>{tenant.name}</h1><p>Provisioning and configuration oversight. Vendor authority does not grant customer decision rights.</p>
      <dl className={styles.details}><div><dt>Lifecycle</dt><dd>{tenant.status.replaceAll("_", " ")}</dd></div>
        <div><dt>Tenant key</dt><dd>{tenant.workspaceKey}</dd></div>
        <div><dt>Legal name</dt><dd>{tenant.legalName ?? "Existing pilot"}</dd></div>
        <div><dt>Template</dt><dd>{tenant.templateName ? `${tenant.templateName} · v${tenant.templateVersion}` : "Existing pilot"}</dd></div>
        <div><dt>Configuration</dt><dd>{tenant.configurationVersion ? `v${tenant.configurationVersion}` : "Unavailable"}</dd></div>
        <div><dt>Initial administrator</dt><dd>{tenant.initialAdministrator ?? "Existing pilot"}</dd></div>
        <div><dt>Invitation</dt><dd>{tenant.invitationStatus ?? "Not applicable"}</dd></div>
        <div><dt>Service-work threshold</dt><dd>{typeof tenant.serviceApproval?.thresholdMinor === "number"
          ? `${tenant.serviceApproval.currency} ${(tenant.serviceApproval.thresholdMinor / 100).toFixed(2)}` : "Setup required"}</dd></div>
      </dl>
      {tenant.failureCode && <p role="alert">Provisioning issue: {tenant.failureCode}</p>}
      {tenant.invitationId && <p>Initial administrator acceptance: <Link href={`/work/initial-invitation?workspace=${encodeURIComponent(workspace)}&request=${encodeURIComponent(tenant.invitationId)}`}>Open invitation page</Link></p>}
      <PlatformTenantActions tenant={tenant} />
      <section className={styles.section}><h2>Provisioning activity</h2>
        {tenant.audit.length ? <div className={styles.tableWrap}><table><thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Reason</th></tr></thead>
          <tbody>{tenant.audit.map((event, index) => <tr key={`${event.action}-${event.occurredAt}-${index}`}>
            <td>{new Date(event.occurredAt).toLocaleString()}</td><td>{event.action}</td><td>{event.reason}</td></tr>)}</tbody></table></div>
          : <p>No provisioning activity is recorded for this pilot tenant.</p>}</section>
      <Link href="/platform-admin">← Back to directory</Link>
    </div></main>;
}
