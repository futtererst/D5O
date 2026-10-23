import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import "server-only";
import type { WorkspaceKey } from "@/components/d5o/platform/work-types";
import type { ConfigurationInventory } from "@/lib/d5o/configuration/version-inventory";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { hostedSyntheticInventory } from "./synthetic-inventory";

/** The isolated pilot uses a real published pin. Existing hosted previews stay synthetic. */
export async function hostedConfigurationInventory(workspace: WorkspaceKey): Promise<ConfigurationInventory> {
  if (!authoritativeD5OCommandsReady()) return hostedSyntheticInventory(workspace);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
  const { data, error } = await call("d5o_hosted_configuration_inventory_v1", { p_workspace_key: workspace });
  if (error || !data || typeof data !== "object") throw new Error("pilot_configuration_unavailable");
  const inventory = data as ConfigurationInventory;
  if (!["ready", "no_mapping", "unavailable_version", "ambiguous_mapping"].includes(inventory.status))
    throw new Error("pilot_configuration_unavailable");
  if (inventory.status === "ready" && (!inventory.activeVersionId || !inventory.versions?.some((version) => version.id === inventory.activeVersionId)))
    throw new Error("pilot_configuration_unavailable");
  return inventory;
}
