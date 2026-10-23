import "server-only";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";

export type PlatformTemplate = { id: string; templateKey: string; name: string; description: string;
  templateStatus: string; version: number; status: string; schemaVersion: number;
  publishedAt: string | null; valid: boolean; usage: number };
export type ProvisionedTenant = { workspaceId: string; workspaceKey: string; name: string;
  legalName: string | null; country: string | null; timeZone: string; currency: string;
  status: string; revision: number | null; templateName: string | null; templateVersion: number | null;
  templateVersionId: string | null; initialAdministrator: string | null;
  invitationId: string | null; invitationStatus: string | null;
  invitationExpiresAt: string | null; configurationVersion: number | null;
  configurationVersionId: string | null; createdAt: string; failureCode: string | null;
  serviceApproval: { thresholdMinor?: number; currency?: string } | null;
  audit: Array<{ action: string; actorUserId: string; occurredAt: string; reason: string }> };

export async function loadPlatformProvisioning(): Promise<{
  tenants: ProvisionedTenant[]; templates: PlatformTemplate[] }> {
  const client = await createRybexSupabaseServerClient();
  const user = await client.auth.getUser();
  if (!user.data.user) throw new Error("platform_unauthenticated");
  const rpc = client.rpc.bind(client) as unknown as
    (name: string) => Promise<{ data: unknown; error: { code?: string } | null }>;
  const [directory, templates] = await Promise.all([
    rpc("d5o_platform_provisioning_directory_v1"), rpc("d5o_platform_templates_v1")]);
  const error = directory.error ?? templates.error;
  if (error?.code === "42501") throw new Error("platform_forbidden");
  if (error || !Array.isArray(directory.data) || !Array.isArray(templates.data))
    throw new Error("platform_directory_unavailable");
  return { tenants: directory.data as ProvisionedTenant[], templates: templates.data as PlatformTemplate[] };
}
