import { redirect } from "next/navigation";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { InitialAdminAcceptance } from "@/components/d5o/admin/InitialAdminAcceptance";
import styles from "../invitation/invitation.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accept customer administrator invitation | D5O" };
export default async function InitialInvitationPage({ searchParams }: {
  searchParams: Promise<{ workspace?: string; request?: string }>;
}) {
  const { workspace = "", request = "" } = await searchParams;
  if (!/^[a-z][a-z0-9_-]{2,63}$/.test(workspace) || !request || request.length > 130) redirect("/work");
  const client = await createRybexSupabaseServerClient();
  const { data } = await client.auth.getUser();
  if (!data.user) redirect(`/auth/sign-in?next=${encodeURIComponent(`/work/initial-invitation?workspace=${workspace}&request=${request}`)}`);
  return <main className={styles.page}><div className={styles.brand}>D5O <span>System of work</span></div>
    <section className={styles.panel} aria-labelledby="invitation-title">
      <p className={styles.eyebrow}>Customer onboarding</p><h1 id="invitation-title">Administrator invitation</h1>
      <p className={styles.context}>Workspace <strong>{workspace}</strong></p>
      <p className={styles.description}>Signed in as <strong>{data.user.email}</strong>. Acceptance grants tenant administration after the server verifies this exact offer and recipient.</p>
      <InitialAdminAcceptance workspace={workspace} invitationId={request} />
    </section></main>;
}
