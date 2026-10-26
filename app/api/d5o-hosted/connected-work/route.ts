import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseAdminClient, createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { hostedPrototypeContext, HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import type { ConfigurationInventory } from "@/lib/d5o/configuration/version-inventory";

export const dynamic = "force-dynamic";
type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status,
  headers: { "Cache-Control": "no-store" } });
const rpc = (client: Awaited<ReturnType<typeof createRybexSupabaseServerClient>>,
  name: string, args: Record<string, unknown>) => (client.rpc as unknown as
  (name: string, args: Record<string, unknown>) => Promise<RpcResult>)(name,args);

async function scope(workspace: string) {
  const context = await hostedPrototypeContext(workspace);
  const client = await createRybexSupabaseServerClient();
  const [feature, configuration] = await Promise.all([
    rpc(client,"d5o_hosted_capability_read_v1",{ p_workspace_key: workspace }),
    rpc(client,"d5o_hosted_configuration_inventory_v1",{ p_workspace_key: workspace })]);
  if (feature.error || configuration.error) throw new HostedStateError("workspace_forbidden",403);
  const available = (feature.data as { connectedWork?: boolean } | null)?.connectedWork === true;
  const inventory = configuration.data as ConfigurationInventory;
  if (!inventory || inventory.status !== "ready" || !inventory.activeVersionId)
    throw new HostedStateError("configuration_unavailable",409);
  const active = inventory.versions.find((version) => version.id === inventory.activeVersionId);
  const workTypes = (active?.config_manifest_json?.workTypes ?? []) as
    Array<{ key: string; label: string; status: string }>;
  return { context, available, versionId: inventory.activeVersionId, versionNumber: active?.version ?? null,
    workTypes: workTypes.filter((item) => item.status === "active") };
}

export async function GET(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(workspace)) return reply({error:"invalid_workspace"},400);
  try {
    const selected = await scope(workspace);
    return reply({available:selected.available,versionId:selected.versionId,
      versionNumber:selected.versionNumber,
      workTypes:selected.available ? selected.workTypes : []});
  } catch(error) {
    if (error instanceof HostedStateError) return reply({error:error.code},error.status);
    return reply({error:"connected_work_unavailable"},503);
  }
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({error:"invalid_origin"},403);
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(workspace)) return reply({error:"invalid_workspace"},400);
  let input: Record<string,unknown>;
  try {const raw=await request.text();if(raw.length>6000)return reply({error:"request_too_large"},413);
    input=JSON.parse(raw) as Record<string,unknown>;}catch{return reply({error:"invalid_request"},400);}
  if(typeof input.commandId!=="string" || !/^[0-9a-f-]{36}$/i.test(input.commandId)
    || typeof input.title!=="string" || typeof input.customer!=="string"
    || typeof input.site!=="string" || typeof input.owner!=="string"
    || typeof input.workTypeKey!=="string" || typeof input.configurationVersionId!=="string")
    return reply({error:"invalid_request"},400);
  try {
    const selected=await scope(workspace);
    if(!selected.available || !selected.context.canEdit) return reply({error:"capability_unavailable"},403);
    if(input.configurationVersionId!==selected.versionId ||
      !selected.workTypes.some((item)=>item.key===input.workTypeKey))
      return reply({error:"configuration_changed"},409);
    const [work,catalog]=await Promise.all([selected.context.read("work"),selected.context.read("catalog")]);
    const admin=createRybexSupabaseAdminClient();
    const call=admin.rpc.bind(admin) as unknown as
      (name:string,args:Record<string,unknown>)=>Promise<RpcResult>;
    const result=await call("d5o_hosted_create_connected_work_v1",{
      p_workspace_key:workspace,p_command_id:input.commandId,
      p_expected_work_revision:work.revision,p_expected_catalog_revision:catalog.revision,
      p_configuration_version_id:selected.versionId,p_work_type_key:input.workTypeKey,
      p_title:input.title,p_customer:input.customer,p_site:input.site,p_owner:input.owner,
      p_initial_discovery:input.initialDiscovery ?? null,
      p_actor_user_id:selected.context.actor.id,
      p_membership_id:selected.context.actor.membershipId });
    if(result.error) return reply({error:result.error.message},result.error.code==="42501"?403:
      result.error.code==="23505"?409:result.error.code==="22023" || result.error.code==="23514"?422:503);
    return reply({result:result.data},201);
  }catch(error){
    if(error instanceof HostedStateError)return reply({error:error.code},error.status);
    return reply({error:"connected_work_unavailable"},503);
  }
}
