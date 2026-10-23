import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { NextRequest, NextResponse } from "next/server";
import type { WorkspaceKey } from "@/components/d5o/platform/schedule-model";
import type { CatalogMutation, SharedWorkCatalog } from "@/components/d5o/platform/work-catalog-model";
import { applyCatalogMutation, CatalogError, initialHostedCatalog } from "@/lib/d5o/work-catalog/store";
import { HostedStateError, hostedPrototypeContext } from "@/lib/d5o/hosted/prototype-context";
import { hostedConfigurationInventory } from "@/lib/d5o/hosted/configuration-inventory";
import { publishedWorkTypePinIsValid } from "@/components/d5o/platform/published-phase-configuration";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { createRybexSupabaseAdminClient, createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { resolvePublishedPhaseConfiguration } from "@/components/d5o/platform/published-phase-configuration";

export const dynamic = "force-dynamic";
const workspaces = new Set(["rybex", "rotork"]);
const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" }
});

export async function GET(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!workspaces.has(workspace)) return reply({ error: "invalid_target" }, 400);
  try {
    const context = await hostedPrototypeContext(workspace);
    const result = await context.read("catalog");
    const catalog = result.state
      ? { ...result.state, revision: result.revision } as SharedWorkCatalog
      : initialHostedCatalog(workspace as WorkspaceKey);
    return reply({ catalog, canEdit: context.canEdit, synthetic: true });
  } catch (error) {
    if (error instanceof HostedStateError) return reply({ error: error.code }, error.status);
    return reply({ error: "catalog_unavailable" }, 503);
  }
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  if (!workspaces.has(workspace)) return reply({ error: "invalid_target" }, 400);
  const body = await request.text();
  if (body.length > 20000) return reply({ error: "command_too_large" }, 413);
  try {
    const input = JSON.parse(body) as CatalogMutation;
    const context = await hostedPrototypeContext(workspace);
    if (!context.canEdit) return reply({ error: "workspace_forbidden" }, 403);
    if (authoritativeD5OCommandsReady() && input.action === "register-record")
      return reply({ error: "connected_creation_required", message: "Canonical work must be created with its identity and catalog row in one transaction." }, 409);
    if (input.action === "create-record" || input.action === "register-record") {
      const candidate = input.action === "create-record" ? input : input.record;
      const inventory = await hostedConfigurationInventory(workspace as WorkspaceKey);
      if (!candidate.phaseConfigurationVersionId ||
        !publishedWorkTypePinIsValid(inventory, workspace as WorkspaceKey,
          candidate.type, candidate.phaseConfigurationVersionId, true))
        return reply({ error: "configuration_changed",
          message: "Select a Work Type from the active published configuration." }, 409);
      if (authoritativeD5OCommandsReady() && input.action === "create-record") {
        const type = resolvePublishedPhaseConfiguration(inventory, workspace as WorkspaceKey, input.type);
        if (!type || !input.commandId || !/^[0-9a-f-]{36}$/i.test(input.commandId))
          return reply({ error: "invalid_connected_command" }, 400);
        const currentWork = await context.read("work");
        const admin = createRybexSupabaseAdminClient();
        const call = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
        const result = await call("d5o_hosted_create_connected_work_v1", {
          p_workspace_key: workspace, p_command_id: input.commandId,
          p_expected_work_revision: currentWork.revision,
          p_expected_catalog_revision: input.expectedRevision,
          p_configuration_version_id: inventory.activeVersionId,
          p_work_type_key: type.workTypeKey,
          p_title: input.title, p_customer: input.customer,
          p_site: input.site, p_owner: input.owner,
          p_initial_discovery: input.initialDiscovery ?? null,
          p_actor_user_id: context.actor.id, p_membership_id: context.actor.membershipId
        });
        if (result.error) return reply({ error: result.error.message },
          result.error.code === "23505" ? 409 : result.error.code === "42501" ? 403 : result.error.code === "22023" ? 422 : 503);
        const identity = result.data as { presentationId?: string; workRevision?: number } | null;
        const [saved, savedWork] = await Promise.all([context.read("catalog"), context.read("work")]);
        const catalog = { ...saved.state, revision: saved.revision } as SharedWorkCatalog;
        const created = catalog.records.find((item) => item.id === identity?.presentationId);
        if (!created || !savedWork.state) return reply({ error: "connected_result_unavailable" }, 502);
        return reply({ catalog, created, canonicalWorkId: created.canonicalWorkId,
          workRevision: identity?.workRevision,
          workState: { ...savedWork.state, revision: savedWork.revision }, synthetic: false }, 201);
      }
      if (input.action === "register-record") {
        // Registration connects a Work Record created by a governed command to
        // the shared package catalog; it cannot import an arbitrary browser row.
        const workState = await context.read("work");
        const existing = (workState.state?.records as Array<Record<string, unknown>> | undefined)
          ?.find((record) => record.id === input.record.id && record.workspace === workspace);
        if (!existing || existing.stage !== input.record.stage || existing.type !== input.record.type
          || existing.phaseConfigurationVersionId !== input.record.phaseConfigurationVersionId)
          return reply({ error: "unregistered_work_import" }, 409);
      }
    }
    if (input.action === "create-package") {
      const workState = await context.read("work");
      const candidate = (workState.state?.records as Array<Record<string, unknown>> | undefined)
        ?.find((record) => record.id === input.workId);
      const discovery = candidate?.discovery as { pursuitControl?: unknown; outcome?: string;
        designHandoff?: { status?: string } } | undefined;
      if (discovery?.pursuitControl && (discovery.outcome !== "Won"
        || discovery.designHandoff?.status !== "accepted"))
        return reply({ error: "design_handoff_required" }, 409);
      if (authoritativeD5OCommandsReady() && candidate?.canonicalWorkId) {
        const isService = !!candidate.serviceSource;
        if (isService && (candidate.serviceExecutionBasis as { status?: string } | undefined)?.status !== "accepted")
          return reply({ error: "accepted_service_basis_required" }, 409);
        if (!input.commandId || !Number.isInteger(input.expectedWorkRevision)
          || !Number.isInteger(input.expectedHandoffRevision)
          || !Number.isInteger(input.expectedPackageCount))
          return reply({ error: "invalid_connected_package_command" }, 400);
        const client = await createRybexSupabaseServerClient();
        const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
          data: unknown; error: { code?: string; message: string } | null
        }>;
        const { data, error } = await call(isService
          ? "d5o_hosted_create_service_package_v1" : "d5o_hosted_create_connected_package_v2", {
          p_workspace_key: workspace, p_presentation_id: input.workId,
          p_name: input.name, p_owner: input.owner, p_command_id: input.commandId,
          p_expected_work_revision: input.expectedWorkRevision,
          p_expected_catalog_revision: input.expectedRevision,
          ...(isService ? { p_expected_basis_revision: input.expectedHandoffRevision }
            : { p_expected_handoff_revision: input.expectedHandoffRevision }),
          p_expected_package_count: input.expectedPackageCount
        });
        if (error) return reply({ error: error.message, message: error.message },
          error.code === "42501" ? 403 : error.code === "23505" || error.code === "23514" ? 409 :
            error.code === "22023" ? 400 : 503);
        const created = data as { created?: Record<string, unknown>; workRevision?: number } | null;
        const [savedCatalog, savedWork] = await Promise.all([context.read("catalog"), context.read("work")]);
        if (!created?.created || !savedCatalog.state || !savedWork.state)
          return reply({ error: "connected_result_unavailable" }, 502);
        return reply({ catalog: { ...savedCatalog.state, revision: savedCatalog.revision },
          created: created.created, workRevision: created.workRevision,
          workState: { ...savedWork.state, revision: savedWork.revision }, synthetic: false }, 201);
      }
    }
    const loaded = await context.read("catalog");
    const catalog = loaded.state
      ? { ...loaded.state, revision: loaded.revision } as SharedWorkCatalog
      : initialHostedCatalog(workspace as WorkspaceKey);
    const { created, changed } = applyCatalogMutation(workspace as WorkspaceKey,
      context.actor, catalog, input);
    if (!changed) return reply({ catalog, created, synthetic: true });
    const saved = await context.save("catalog", loaded.revision, catalog as unknown as Record<string, unknown>);
    return reply({ catalog: { ...saved.state, revision: saved.revision }, created, synthetic: true });
  } catch (error) {
    if (error instanceof HostedStateError || error instanceof CatalogError)
      return reply({ error: error.code, message: error.message }, error.status);
    return reply({ error: "invalid_request" }, 400);
  }
}
