import { redirect } from "next/navigation";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { InvitationAcceptance } from "@/components/d5o/admin/InvitationAcceptance";
import styles from "./invitation.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accept organization invitation | D5O" };
export default async function InvitationPage({ searchParams }: {
  searchParams: Promise<{ workspace?: string; request?: string }>;
}) {
  const { workspace = "", request = "" } = await searchParams;
  if (!workspace || !request || request.length > 120) redirect("/work");
  const client = await createRybexSupabaseServerClient();
  const { data } = await client.auth.getUser();
  if (!data.user) redirect(`/auth/sign-in?next=${encodeURIComponent(`/work/invitation?workspace=${workspace}&request=${request}`)}`);
  return <main className={styles.page}>
    <div className={styles.brand}>D5O <span>System of work</span></div>
    <section className={styles.panel} aria-labelledby="invitation-title">
      <p className={styles.eyebrow}>People &amp; access</p>
      <h1 id="invitation-title">Organization invitation</h1>
      <p className={styles.context}>Workspace <strong>{workspace}</strong></p>
      <p className={styles.description}>Signed in as <strong>{data.user.email}</strong>. Accepting grants the offered role in this workspace after server verification.</p>
      <InvitationAcceptance workspace={workspace} request={request} />
    </section>
  </main>;
}
