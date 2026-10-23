import { notFound, redirect } from "next/navigation";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { OnboardingChecklist, type Readiness } from "@/components/d5o/admin/OnboardingChecklist";
import styles from "@/app/platform-admin/platform-admin.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer onboarding | D5O" };
export default async function CustomerOnboardingPage({ searchParams }: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const workspace = (await searchParams).workspace ?? "";
  if (!/^[a-z][a-z0-9_-]{2,63}$/.test(workspace)) notFound();
  const client = await createRybexSupabaseServerClient();
  const user = await client.auth.getUser();
  if (!user.data.user) redirect(`/auth/sign-in?next=${encodeURIComponent(`/work/onboarding?workspace=${workspace}`)}`);
  const { data, error } = await (client.rpc as unknown as (name: string, args: Record<string, unknown>) =>
    Promise<{ data: unknown; error: { code?: string } | null }>)(
    "d5o_hosted_onboarding_read_v1", { p_workspace_key: workspace });
  if (error?.code === "42501") notFound();
  if (error || !data) throw new Error("onboarding_unavailable");
  return <main className={styles.main}><p className={styles.eyebrow}>Customer administration / Onboarding</p>
    <h1>Set up {(data as Readiness).displayName}</h1><p>Complete required organization and policy checks, then submit readiness for vendor activation.</p>
    <OnboardingChecklist initial={data as Readiness} />
  </main>;
}
