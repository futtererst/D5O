import { d5oCommandRuntime } from "@/lib/d5o/auth/hosted-target";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";

/** Keep the production pilot allowlist. The independent tenant is enabled only by the disposable local runtime. */
export function customerAdminWorkspaceAllowed(workspace: string): boolean {
  return workspace === "rybex" || (workspace === "enterprise_test" && d5oCommandRuntime() === "pilot");
}

/** New onboarding tenants use a separate membership-backed administration path. */
export async function customerAdminWorkspaceAuthorized(workspace: string): Promise<boolean> {
  if (customerAdminWorkspaceAllowed(workspace)) return true;
  if (!/^[a-z][a-z0-9_-]{2,63}$/.test(workspace)) return false;
  const client = await createRybexSupabaseServerClient();
  const { data, error } = await (client.rpc as unknown as (name: string, args: Record<string, unknown>) =>
    Promise<{ data: unknown; error: unknown }>)("d5o_hosted_onboarding_read_v1", { p_workspace_key: workspace });
  return !error && Boolean(data);
}
