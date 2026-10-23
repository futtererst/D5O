"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { defaultPhaseContract, validatePublishedPhaseContract } from "@/components/d5o/platform/published-phase-configuration";
import { createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";

const setupPath = "/work?workspace=rybex";
const receivingRoles = new Set(["admin", "project_manager", "operations_leader"]);

export async function publishInitialConfiguration(formData: FormData): Promise<void> {
  const reason = String(formData.get("reason") ?? "").trim();
  const commandId = String(formData.get("commandId") ?? "");
  const routes = {
    discoverDefine: String(formData.get("discoverDefine") ?? ""),
    designDeploy: String(formData.get("designDeploy") ?? ""),
    deployOperate: String(formData.get("deployOperate") ?? ""),
  };
  if (reason.length < 8 || reason.length > 240 || !/^[0-9a-f-]{36}$/.test(commandId)
    || Object.values(routes).some((role) => !receivingRoles.has(role)))
    redirect(`${setupPath}&setupError=invalid`);

  const phaseContract = defaultPhaseContract("rybex");
  if (validatePublishedPhaseContract(phaseContract, "rybex").length)
    redirect(`${setupPath}&setupError=invalid`);
  const workTypes = phaseContract.workTypes.map((type) => ({
    key: type.workTypeKey, label: type.workTypeLabel,
  }));
  const manifest = {
    d5oPresentation: {
      schemaVersion: 1,
      changeReason: reason,
      phaseContract,
      handoffRoles: routes,
    },
    workTypes,
  };
  const client = await createRybexSupabaseServerClient();
  const { data: user, error: userError } = await client.auth.getUser();
  if (userError || !user.user) redirect("/auth/sign-in?next=%2Fwork");
  const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) =>
    Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
  const { error } = await call("d5o_hosted_publish_initial_configuration_v1", {
    p_workspace_key: "rybex",
    p_command_id: commandId,
    p_manifest: manifest,
    p_work_types: workTypes,
    p_create_roles: ["admin", "project_manager"],
    p_routes: routes,
    p_reason: reason,
  });
  if (error) {
    const kind = error.code === "42501" ? "authority"
      : error.message?.includes("configured_receiver_unavailable") ? "receiver"
        : error.message?.includes("initial_configuration_already_exists") ? "changed"
          : "unavailable";
    redirect(`${setupPath}&setupError=${kind}`);
  }
  revalidatePath("/work");
  redirect(`${setupPath}&view=my-work`);
}
