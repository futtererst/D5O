import "server-only";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";

export type PlatformTenant = { workspaceId: string; workspaceKey: string; name: string;
  status: string; configurationTenantId: string | null; activeVersionId: string | null;
  activeVersion: number | null; activeSince: string | null; versionCount: number;
  serviceApproval: { thresholdMinor?: number; currency?: string; authorityRole?: string } | null };

export async function loadPlatformTenants(): Promise<PlatformTenant[]> {
  const client = await createRybexSupabaseServerClient();
  const user = await client.auth.getUser();
  if (user.error || !user.data.user) throw new Error("platform_unauthenticated");
  const { data, error } = await (client.rpc as unknown as (name: string) => Promise<{
    data: unknown; error: { code?: string } | null }>)("d5o_platform_tenant_directory_v1");
  if (error?.code === "42501") throw new Error("platform_forbidden");
  if (error || !Array.isArray(data)) throw new Error("platform_directory_unavailable");
  return data as PlatformTenant[];
}
