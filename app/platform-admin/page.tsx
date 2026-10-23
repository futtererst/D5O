import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadPlatformProvisioning } from "@/lib/d5o/admin/platform-provisioning";
import { PlatformProvisioningPanel } from "@/components/d5o/admin/PlatformProvisioningPanel";
import styles from "./platform-admin.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform administration | D5O" };

export default async function PlatformAdminPage() {
  let result;
  try { result = await loadPlatformProvisioning(); }
  catch (error) {
    if (error instanceof Error && error.message === "platform_unauthenticated")
      redirect(`/auth/sign-in?next=${encodeURIComponent("/platform-admin")}`);
    if (error instanceof Error && error.message === "platform_forbidden") notFound();
    throw error;
  }
  return <main className={styles.shell}><aside className={styles.rail} aria-label="Platform administration navigation">
    <strong>D5O Platform Administration</strong><nav><Link href="/platform-admin" aria-current="page">Tenant directory</Link>
      <a href="#create-customer">Create customer</a><a href="#template-directory">Templates</a></nav>
    <p>Provisioning is vendor-controlled. Customer decision rights remain separate.</p>
  </aside><div className={styles.main}><p className={styles.eyebrow}>Platform / Tenants</p>
    <h1>Customer onboarding</h1><p>Create a customer, apply a published template, invite its first administrator and review readiness before activation.</p>
    <PlatformProvisioningPanel tenants={result.tenants} templates={result.templates} />
  </div></main>;
}
