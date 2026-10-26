import "server-only";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { HostedStateError, hostedPrototypeContext } from "@/lib/d5o/hosted/prototype-context";

export const customerWorkspaceKey = /^[a-z][a-z0-9_-]{1,63}$/;
export type CustomerRpcError = { code?: string; message: string };
export type CustomerRpcResult = { data: unknown; error: CustomerRpcError | null };

export async function customerWorkScope(workspace: string) {
  if (!customerWorkspaceKey.test(workspace)) throw new HostedStateError("invalid_workspace", 400);
  // Existing pilot workspaces retain their established route and allowlists.
  if (workspace === "rybex" || workspace === "rotork")
    throw new HostedStateError("pilot_route_required", 403);
  const context = await hostedPrototypeContext(workspace);
  // Field resources use their assignment-scoped schedule, not the tenant-wide
  // management directory. Keep the new route aligned with /work dispatch.
  if (context.actor.role === "field_worker")
    throw new HostedStateError("work_role_forbidden", 403);
  const client = await createRybexSupabaseServerClient();
  const call = client.rpc.bind(client) as unknown as
    (name: string, args: Record<string, unknown>) => Promise<CustomerRpcResult>;
  const feature = await call("d5o_hosted_capability_read_v1", { p_workspace_key: workspace });
  if (feature.error || (feature.data as { connectedWork?: boolean } | null)?.connectedWork !== true)
    throw new HostedStateError("connected_work_unavailable", 403);
  return { context, call };
}
