"use server";

import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { revalidatePath } from "next/cache";
import { getRequestContext } from "@/lib/d5o/auth/request-context";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { assertProofEnvironment } from "@/lib/d5o/work-record/server";
import { validatePublishedPhaseContract, type PublishedPhaseContract } from "@/components/d5o/platform/published-phase-configuration";
import { validateDiscoverPolicy, type DiscoverPolicy } from "@/components/d5o/platform/discover-decision";
import type { WorkspaceKey } from "@/components/d5o/platform/work-types";
import { loadConfigurationInventory } from "@/lib/d5o/configuration/server";
import { hostedConfigurationInventory } from "@/lib/d5o/hosted/configuration-inventory";

type ActionResult = { ok: true; draftVersionId?: string; publishedVersionId?: string } | { ok: false; error: string };

async function adminClient(workspaceId: string) {
  assertProofEnvironment();
  const context = await getRequestContext();
  if (context.status !== "authorized" || context.workspace?.id !== workspaceId || context.role !== "admin") {
    throw new Error("configuration_admin_required");
  }
  return createRybexSupabaseServerClient();
}

type ConfigurationRpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Configuration command failed.";
}

export async function verifyActiveConfigurationPin(workspaceId: string, expectedVersionId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (authoritativeD5OCommandsReady()) {
      const inventory = await hostedConfigurationInventory("rybex");
      if (inventory.workspaceId !== workspaceId || inventory.activeVersionId !== expectedVersionId)
        throw new Error("configuration_default_changed_refresh_required");
      return { ok: true };
    }
    assertProofEnvironment();
    const context = await getRequestContext();
    if (context.status !== "authorized" || context.workspace?.id !== workspaceId || !context.membership) throw new Error("configuration_workspace_forbidden");
    const inventory = await loadConfigurationInventory(workspaceId);
    if (inventory.status !== "ready" || inventory.activeVersionId !== expectedVersionId) throw new Error("configuration_default_changed_refresh_required");
    return { ok: true };
  } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function createConfigurationDraft(workspaceId: string, activeVersionId: string): Promise<ActionResult> {
  try {
    const client = await adminClient(workspaceId);
    const result = await (client.rpc as unknown as ConfigurationRpc)("d5o_configuration_create_draft_v1", { p_workspace: workspaceId, p_expected_active: activeVersionId });
    if (result.error) throw result.error;
    revalidatePath("/work");
    return { ok: true, draftVersionId: (result.data as { draftVersionId: string }).draftVersionId };
  } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function saveConfigurationDraft(workspaceId: string, draftVersionId: string, labels: Record<string, string>, reason: string, phaseContract: PublishedPhaseContract, workspace: WorkspaceKey, discoverPolicy: Omit<DiscoverPolicy, "version">): Promise<ActionResult> {
  try {
    const client = await adminClient(workspaceId);
    const errors = validatePublishedPhaseContract(phaseContract, workspace);
    if (errors.length) throw new Error(`Invalid phase contract: ${errors[0]}`);
    const policyErrors = validateDiscoverPolicy(discoverPolicy);
    if (policyErrors.length) throw new Error(`Invalid Discover decision policy: ${policyErrors[0]}`);
    const current = await client.from("config_configuration_versions").select("config_manifest_json")
      .eq("id", draftVersionId).eq("status", "draft").single() as unknown as { data: { config_manifest_json: Record<string, unknown> } | null; error: Error | null };
    if (current.error || !current.data) throw new Error("draft_unavailable");
    const source = (current.data as { config_manifest_json: Record<string, unknown> }).config_manifest_json;
    const allowed = ["discover", "define", "develop", "design", "deploy", "operate"];
    if (Object.keys(labels).some((key) => !allowed.includes(key))) throw new Error("invalid_phase_label");
    const phaseLabels = Object.fromEntries(allowed.map((key) => [key, String(labels[key] ?? "").trim()]));
    if (Object.values(phaseLabels).some((value) => value.length < 2 || value.length > 80)) throw new Error("invalid_phase_label");
    const manifest = { ...source, d5oPresentation: { schemaVersion: 1, phaseLabels, changeReason: reason.trim(), phaseContract, discoverDecisionPolicy: { ...discoverPolicy, source: "published" } } };
    const result = await (client.rpc as unknown as ConfigurationRpc)("d5o_configuration_save_draft_v1", { p_workspace: workspaceId, p_draft: draftVersionId, p_manifest: manifest });
    if (result.error) throw result.error;
    revalidatePath("/work");
    return { ok: true, draftVersionId };
  } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function publishConfigurationDraft(workspaceId: string, draftVersionId: string, activeVersionId: string): Promise<ActionResult> {
  try {
    const client = await adminClient(workspaceId);
    const result = await (client.rpc as unknown as ConfigurationRpc)("d5o_configuration_publish_v1", {
      p_workspace: workspaceId, p_draft: draftVersionId, p_expected_active: activeVersionId,
    });
    if (result.error) throw result.error;
    revalidatePath("/work");
    return { ok: true, publishedVersionId: (result.data as { publishedVersionId: string }).publishedVersionId };
  } catch (error) { return { ok: false, error: errorMessage(error) }; }
}

export async function activateConfigurationVersion(workspaceId: string, candidateVersionId: string, activeVersionId: string): Promise<ActionResult> {
  try {
    const client = await adminClient(workspaceId);
    const result = await (client.rpc as unknown as ConfigurationRpc)("d5o_configuration_activate_v1", {
      p_workspace: workspaceId, p_candidate: candidateVersionId, p_expected_active: activeVersionId,
    });
    if (result.error) throw result.error;
    revalidatePath("/work");
    return { ok: true, publishedVersionId: (result.data as { activeVersionId: string }).activeVersionId };
  } catch (error) { return { ok: false, error: errorMessage(error) }; }
}
