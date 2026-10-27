import { NextRequest, NextResponse } from "next/server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";
import { customerWorkScope, type CustomerRpcError } from "@/lib/d5o/hosted/customer-work-scope";
import { HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { defineTasks, designTasks, designReceiptTasks, developTasks, serviceTasks,
  type ServiceTaskWork, type ServiceApprovalTaskState, type CustomerWorkTask } from "@/lib/d5o/hosted/customer-work-tasks";
import { buildCustomerDefineDraft, parseDefineDraft } from "@/lib/d5o/hosted/customer-define-draft";
import { deliveryRoleActions } from "@/lib/d5o/hosted/delivery-role-actions";
import { supportRoleActions } from "@/lib/d5o/hosted/support-role-actions";
import { hostedConfigurationInventory } from "@/lib/d5o/hosted/configuration-inventory";
import { resolvePublishedPhaseConfiguration } from "@/components/d5o/platform/published-phase-configuration";
import type { WorkRecord } from "@/components/d5o/platform/work-types";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body,
  { status, headers: { "Cache-Control": "no-store" } });
type WorkRow = { id: string; canonicalWorkId?: string; title: string;
  phaseConfigurationVersionId?: string; customer?: string; site?: string; owner?: string;
  type?: string; workspace?: string;
  discovery?: { outcome?:string;
    estimate?: {status?:string;revision?:number;review?:{submittedByActorId?:string;approverRole?:string}};
    proposal?: {status?:string;package?:{revision?:number};review?:{submittedByActorId?:string;authorityRole?:string}};
    pursuitControl?: { status?: string; revision?: number;
    submission?: { actorId?: string; revision?: number };
    handoff?: { status?: string; actorId?: string; receiverRole?: string;
      receiverActorId?: string } } };
  develop?: {revision?:number;review?:{status?:string;revision?:number;
    approverRole?:string;submittedByActorId?:string}};
  design?: { authorityRevision?: number;
    packages?: Array<{ packageId: string }>;
    documents?: Array<{ id: string; status: string; submittedByActorId?: string }>;
    reviews?: Array<{ id: string; packageId: string; discipline: string; status: string; requestedByActorId?: string }>;
    releases?: Array<{ id: string; packageId: string; status: string; issuedByActorId?: string }> };
  deploy?: { permits?: Array<{ packageId?: string; status?: string }>;
    workAcceptance?: { id?: string; receipt?: string; revision?: number } };
  operate?: { activation?: { status?: string }; source?: { workAcceptanceId?: string }; requests?: Array<{
    id: string; status?: string; serviceEstimate?: { status?: string } }> };
  definition?: { status?: string; authorityRevision?: number;
    reviews?: { commercial?: string; delivery?: string };
    decisions?: Array<{ action?: string; actorId?: string; reviewRole?: string }>;
    developHandoff?: { status?: string; submittedByActorId?: string } } };
const permittedArguments = new Set([
  "p_action", "p_input", "p_expected_source_revision",
  "p_expected_deploy_revision", "p_expected_operate_revision",
]);
function errorStatus(error: CustomerRpcError) {
  return error.code === "42501" ? 403 : error.code === "23505" ? 409
    : error.code === "23514" || error.code === "22023" ? 422 : 503;
}

export async function GET(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  const workId = request.nextUrl.searchParams.get("workId");
  try {
    const { context, call } = await customerWorkScope(workspace);
    const loaded = await context.read("work");
    const records = Array.isArray(loaded.state?.records) ? loaded.state.records as WorkRow[] : [];
    if (!workId) {
      const visible = records.filter((work) => work.workspace === workspace && work.canonicalWorkId);
      const catalog = await context.read("catalog");
      const connectedPackages = Array.isArray(catalog.state?.packages)
        ? catalog.state.packages as Array<{ id?: string; workId?: string }> : [];
      const schedule = await context.read("schedule");
      const queued = await call("d5o_hosted_role_actions_v1", { p_workspace_key: workspace });
      if (queued.error || !Array.isArray(queued.data))
        return reply({ error: queued.error?.message ?? "task_queue_unavailable" }, 503);
      const identity=await call("d5o_hosted_work_queue_identity_v1",{p_workspace_key:workspace});
      if(identity.error || !identity.data || typeof identity.data!=="object")
        return reply({error:"queue_identity_unavailable"},503);
      const owned=new Set((identity.data as {ownedIds?:string[]}).ownedIds??[]);
      const discoverTasks:CustomerWorkTask[]=visible.flatMap((work)=>{
        const pursuit=work.discovery?.pursuitControl;
        if(!pursuit)return [];
        const mine=context.actor.role==="project_manager" && owned.has(work.id);
        const result:CustomerWorkTask[]=[];
        const add=(action:string,title:string,status:"available"|"view_only"="available")=>
          result.push({id:`discover:${work.id}:${action}:${pursuit.revision??0}`,
            workId:work.id,title,phase:"Discover",status,revision:pursuit.revision??0,action});
        if(mine && ["draft","returned","held"].includes(pursuit.status??""))
          add("intake","Prepare Discover intake");
        if(pursuit.status==="submitted" && pursuit.submission?.actorId!==context.actor.id &&
          ["admin","billing_commercial_lead","business_development_lead"].includes(context.actor.role))
          add("intake-review","Review Discover intake");
        if(mine && pursuit.status==="qualified" && !["submitted","accepted"].includes(pursuit.handoff?.status??""))
          add("handoff-prep","Prepare Define handoff");
        if(pursuit.status==="qualified" && pursuit.handoff?.status==="submitted" &&
          pursuit.handoff.actorId!==context.actor.id &&
          (pursuit.handoff.receiverRole ? pursuit.handoff.receiverRole===context.actor.role
            : pursuit.handoff.receiverActorId===context.actor.id))
          add("handoff-receive","Receive Define handoff");
        return result;
      });
      const commercialTasks:CustomerWorkTask[]=visible.flatMap((work)=>{
        if(work.definition?.developHandoff?.status!=="accepted")return [];
        const mine=context.actor.role==="project_manager" && owned.has(work.id);
        const result:CustomerWorkTask[]=[];
        const add=(action:string,title:string,revision:number)=>result.push({
          id:`commercial:${work.id}:${action}:${revision}`,workId:work.id,title,
          phase:"Develop",status:"available",revision,action});
        const solution=work.develop;
        if(mine && (!solution?.review || solution.review.status==="Returned" ||
          solution.review.revision!==solution.revision))add("solution-prep","Prepare selected solution",solution?.revision??0);
        if(solution?.review?.status==="Submitted" &&
          solution.review.approverRole===context.actor.role &&
          solution.review.submittedByActorId!==context.actor.id)
          add("solution-review","Review selected solution",solution.revision??0);
        const estimate=work.discovery?.estimate;
        if(mine && solution?.review?.status==="Approved" &&
          !["Pricing review","Approved"].includes(estimate?.status??""))
          add("estimate-prep","Prepare detailed estimate",estimate?.revision??0);
        if(estimate?.status==="Pricing review" && context.actor.role===(estimate.review?.approverRole??"operations_leader") &&
          estimate.review?.submittedByActorId!==context.actor.id)
          add("pricing-review","Review detailed pricing",estimate.revision??0);
        const proposal=work.discovery?.proposal;
        if(mine && estimate?.status==="Approved" &&
          !["Internal review","Approved","Submitted"].includes(proposal?.status??""))
          add("offer-prep","Prepare customer offer",proposal?.package?.revision??0);
        if(proposal?.status==="Internal review" &&
          context.actor.role===(proposal.review?.authorityRole??"operations_leader") &&
          proposal.review?.submittedByActorId!==context.actor.id)
          add("offer-review","Review customer offer",proposal.package?.revision??0);
        if(mine && proposal?.status==="Approved")
          add("customer-submission","Record customer submission",proposal.package?.revision??0);
        if(mine && proposal?.status==="Submitted" && !work.discovery?.outcome)
          add("customer-award","Record customer award",proposal.package?.revision??0);
        return result;
      });
      const visibleIds = new Set(visible.map((item) => item.id));
      const roleTasks = (queued.data as Array<Record<string, unknown>>)
        .filter((item) => typeof item.workId === "string" && visibleIds.has(item.workId)
          && item.phase !== "Design" && item.phase !== "Deploy")
        .map((item): CustomerWorkTask => ({ id: `role:${item.workId}:${item.kind}:${item.packageId ?? ""}:${item.revision}`,
          workId: item.workId as string, title: String(item.title ?? item.kind ?? "Review Work"),
          phase: String(item.phase ?? "Work"), status: "view_only",
          revision: Number(item.revision) || 0,
          dueDate: typeof item.dueDate === "string" ? item.dueDate : undefined,
          packageId: typeof item.packageId === "string" ? item.packageId : undefined }));
      const authorityQueues = await Promise.all([
        call("d5o_purchase_authority_actions_v1", { p_workspace_key: workspace }),
        call("d5o_labor_authority_actions_v1", { p_workspace_key: workspace })]);
      if (authorityQueues.some((item) => item.error || !Array.isArray(item.data)))
        return reply({ error: "authority_queue_unavailable" }, 503);
      const authorityTasks = authorityQueues.flatMap((queue) => (queue.data as Array<Record<string, unknown>>)
        .filter((item) => typeof item.workId === "string" && visibleIds.has(item.workId))
        .map((item): CustomerWorkTask => ({ id: `develop:${item.workId}:${item.kind}:${item.revision}`,
          workId: item.workId as string, title: String(item.kind ?? "Review execution authority"),
          phase: "Develop", status: "available", revision: Number(item.revision) || 0,
          action: String(item.focus ?? "review") })));
      const deployTasks = deliveryRoleActions(visible as unknown as WorkRecord[], context.actor.id,
        context.actor.role).filter((item) => item.position === "available").map((item): CustomerWorkTask => ({
          id: `deploy:${item.workId}:${item.focus}:${item.decisionId}:${item.revision}`,
          workId: item.workId, title: item.kind, phase: "Deploy",
          status: "available",
          revision: item.revision, packageId: item.packageId ?? undefined,
          releaseId: item.releaseId ?? undefined, action: item.focus,
          decisionId: item.decisionId, sourceRevision: item.sourceRevision }));
      const operateTasks: CustomerWorkTask[] = supportRoleActions(visible as WorkRecord[],
        context.actor.id, context.actor.role).filter((item) => item.position !== "waiting")
        .map((item) => ({ id: `operate:${item.workId}:${item.kind}:${item.decisionId}:${item.documentKind ?? ""}`,
          workId: item.workId, title: ({ "receive-handoff": "Receive accepted Deploy handoff",
            "add-asset": "Identify supported asset", "accept-support": "Accept support responsibility",
            activate: "Activate support", "supply-document": "Supply support document",
            "review-document": "Review support document" } as Record<string, string>)[item.kind], phase: "Operate",
          status: item.position === "available" ? "available" : "view_only",
          revision: item.decisionRevision, action: item.kind,
          packageId: item.packageId, decisionId: item.decisionId,
          sourceRevision: item.sourceRevision }));
      const financeTasks: CustomerWorkTask[] = context.actor.role === "billing_commercial_lead"
        ? (visible as WorkRecord[]).filter((item) => item.deploy?.workAcceptance?.receipt === "Accepted" &&
          item.operate?.activation?.status === "Active" && item.operate?.finance?.status === "Pending")
          .map((item) => ({ id: `operate-finance:${item.id}:${item.operate?.authorityRevision ?? 0}`,
            workId: item.id, title: "Review financial closeout obligation", phase: "Operate",
            status: "available", revision: item.operate?.authorityRevision ?? 0,
            action: "update-finance" })) : [];
      const serviceApprovals: Record<string, ServiceApprovalTaskState> = {};
      await Promise.all(visible.flatMap((work) => (work.operate?.requests ?? [])
        .filter((item) => item.serviceEstimate?.status === "Approved")
        .map(async (item) => {
          const result = await call("d5o_hosted_connected_service_approval_read_v1", {
            p_workspace_key: workspace, p_parent_presentation_id: work.id,
            p_request_id: item.id });
          if (!result.error && result.data && typeof result.data === "object")
            serviceApprovals[`${work.id}:${item.id}`] = result.data as ServiceApprovalTaskState;
        })));
      return reply({ workspace, workspaceName: context.actor.workspaceName ?? workspace,
      role: context.actor.role, revision: loaded.revision,
      tasks: [...discoverTasks,...commercialTasks,...defineTasks(visible, context.actor.role, context.actor.id),
        ...designTasks(visible, context.actor.role, context.actor.id, connectedPackages),
        ...designReceiptTasks(visible, context.actor.role, context.actor.id),
        ...developTasks(visible, context.actor.role, schedule.state),
        ...authorityTasks, ...serviceTasks(visible as ServiceTaskWork[], context.actor.role,
          serviceApprovals, context.actor.id), ...roleTasks, ...deployTasks, ...operateTasks, ...financeTasks],
      records: visible
        .map(({ id, title, customer, site, owner, type, phaseConfigurationVersionId }) =>
          ({ id, title, customer, site, owner, type, phaseConfigurationVersionId })) });
    }
    const record = records.find((work) => work.id === workId && work.workspace === workspace
      && work.canonicalWorkId);
    if (!record) return reply({ error: "work_unavailable" }, 404);
    const status = await call("d5o_hosted_phase_status_read_v1",
      { p_workspace_key: workspace, p_presentation_id: workId });
    if (status.error) return reply({ error: status.error.message }, errorStatus(status.error));
    const catalog = await context.read("catalog");
    const connectedPackages = (Array.isArray(catalog.state?.packages) ? catalog.state.packages as
      Array<{ id?: string; workId?: string; name?: string }> : [])
      .filter((item) => item.workId === workId).map((item) => ({ packageId: item.id, name: item.name }));
    const inventory = await hostedConfigurationInventory(workspace as WorkRecord["workspace"]);
    const pinned = resolvePublishedPhaseConfiguration(inventory, workspace as WorkRecord["workspace"],
      record.type ?? "", record as WorkRecord);
    return reply({ workspace, workspaceName: context.actor.workspaceName ?? workspace,
      role: context.actor.role, actorId:context.actor.id, actorName:context.actor.name,
      canEdit: context.canEdit, revision: loaded.revision,
      record, connectedPackages, catalogRevision: catalog.revision,
      operatePolicy: pinned ? { requireDocumentationReview:
        pinned.operateControls?.requireDocumentationReview === true } : null,
      defineActions: defineTasks([record], context.actor.role, context.actor.id),
      designActions: designReceiptTasks([record], context.actor.role, context.actor.id),
      phaseStatus: status.data });
  } catch (error) {
    if (error instanceof HostedStateError) return reply({ error: error.code }, error.status);
    return reply({ error: "customer_work_unavailable" }, 503);
  }
}

export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return reply({ error: "invalid_origin" }, 403);
  const workspace = request.nextUrl.searchParams.get("workspace") ?? "";
  let body: { workId?: string; command?: string; commandId?: string;
    arguments?: Record<string, unknown> };
  try { const raw = await request.text(); if (raw.length > 30000) return reply({ error: "command_too_large" }, 413);
    body = JSON.parse(raw) as typeof body; } catch { return reply({ error: "invalid_command" }, 400); }
  if (!["operate", "define", "define-draft", "design-receipt"].includes(body.command ?? "") || !body.workId || !/^[0-9a-f-]{36}$/i.test(body.commandId ?? "")
    || !body.arguments || typeof body.arguments !== "object" || Array.isArray(body.arguments))
    return reply({ error: "invalid_command" }, 400);
  const allowedArguments = body.command === "define-draft"
    ? new Set(["p_expected_source_revision", "fields"])
    : body.command === "design-receipt"
    ? new Set(["p_action", "p_input", "p_expected_source_revision", "p_expected_decision_revision"])
    : body.command === "define"
    ? new Set(["p_action", "p_review_role", "p_reason", "p_expected_source_revision", "p_expected_decision_revision"])
    : permittedArguments;
  if (Object.keys(body.arguments).some((key) => !allowedArguments.has(key)))
    return reply({ error: "invalid_command_argument" }, 400);
  if (body.command === "define-draft" && (!Number.isInteger(body.arguments.p_expected_source_revision)
    || !parseDefineDraft(body.arguments.fields)))
    return reply({ error: "invalid_define_draft" }, 400);
  if (body.command === "design-receipt" && (
    body.arguments.p_action !== "respond-receipt"
    || !Number.isInteger(body.arguments.p_expected_source_revision)
    || !Number.isInteger(body.arguments.p_expected_decision_revision)
    || !body.arguments.p_input || typeof body.arguments.p_input !== "object"
    || Array.isArray(body.arguments.p_input)
    || Object.keys(body.arguments.p_input).some((key) => !["releaseId", "response", "note"].includes(key))
    || typeof (body.arguments.p_input as Record<string, unknown>).releaseId !== "string"
    || !["Accepted", "Returned"].includes(String((body.arguments.p_input as Record<string, unknown>).response))
    || typeof (body.arguments.p_input as Record<string, unknown>).note !== "string"
    || String((body.arguments.p_input as Record<string, unknown>).note).trim().length < 15))
    return reply({ error: "invalid_design_receipt" }, 400);
  if (body.command === "operate" && ((body.arguments.p_action !== "receive-handoff" && body.arguments.p_action !== "activate")
    || typeof body.arguments.p_input !== "object" || body.arguments.p_input === null
    || Array.isArray(body.arguments.p_input)
    || !Number.isInteger(body.arguments.p_expected_source_revision)
    || !Number.isInteger(body.arguments.p_expected_deploy_revision)
    || !Number.isInteger(body.arguments.p_expected_operate_revision)))
    return reply({ error: "invalid_command_argument" }, 400);
  if (body.command === "define" && (
    !["submit", "approve-review", "return-review", "submit-handoff", "accept-handoff", "return-handoff"].includes(String(body.arguments.p_action))
    || !Number.isInteger(body.arguments.p_expected_source_revision)
    || !Number.isInteger(body.arguments.p_expected_decision_revision)
    || typeof body.arguments.p_reason !== "string" || !body.arguments.p_reason.trim()
    || (["approve-review", "return-review"].includes(String(body.arguments.p_action))
      ? !["commercial", "delivery"].includes(String(body.arguments.p_review_role))
      : body.arguments.p_review_role != null)))
    return reply({ error: "invalid_command_argument" }, 400);
  try {
    const { context, call } = await customerWorkScope(workspace);
    if (body.command === "define-draft") {
      if (!["admin", "project_manager", "operations_leader"].includes(context.actor.role))
        return reply({ error: "define_submit_denied" }, 403);
      const current = await context.read("work");
      if (current.revision !== body.arguments.p_expected_source_revision)
        return reply({ error: "stale_state" }, 409);
      const state = current.state;
      const records = Array.isArray(state?.records) ? state.records as WorkRow[] : [];
      const index = records.findIndex((work) => work.id === body.workId
        && work.workspace === workspace && work.canonicalWorkId);
      if (index < 0) return reply({ error: "work_unavailable" }, 404);
      const record = records[index];
      if (record.discovery?.pursuitControl?.handoff?.status !== "accepted")
        return reply({ error: "define_intake_handoff_required" }, 409);
      if (record.definition && record.definition.status !== "Draft")
        return reply({ error: "define_draft_locked" }, 409);
      const fields = parseDefineDraft(body.arguments.fields);
      if (!fields) return reply({ error: "invalid_define_draft" }, 400);
      const nextRecords = [...records];
      nextRecords[index] = { ...record,
        definition: buildCustomerDefineDraft(fields, record.owner ?? context.actor.name,
          record.definition as Record<string, unknown> | undefined) };
      const saved = await call("d5o_hosted_prototype_save_v1", {
        p_workspace_key: workspace, p_state_key: "work",
        p_expected_revision: current.revision,
        p_state: { ...state, records: nextRecords }
      });
      if (saved.error) return reply({ error: saved.error.message }, errorStatus(saved.error));
      return reply({ revision: (saved.data as { revision?: number })?.revision,
        status: "Draft" });
    }
    if (body.command === "operate" && context.actor.role !== "operations_leader") return reply({ error: "role_forbidden" }, 403);
    if (body.command === "design-receipt" && !["admin", "project_manager", "operations_leader"].includes(context.actor.role))
      return reply({ error: "design_release_role_denied" }, 403);
    if (body.command === "define" && !["admin", "project_manager", "operations_leader", "billing_commercial_lead"].includes(context.actor.role))
      return reply({ error: "role_forbidden" }, 403);
    const loaded = await context.read("work");
    const records = Array.isArray(loaded.state?.records) ? loaded.state.records as WorkRow[] : [];
    if (!records.some((work) => work.id === body.workId && work.workspace === workspace
      && work.canonicalWorkId)) return reply({ error: "work_unavailable" }, 404);
    const args = { ...body.arguments, p_workspace_key: workspace,
      p_presentation_id: body.workId,
      p_command_id: body.commandId };
    const result = await call(body.command === "define" ? "d5o_hosted_define_command_v1"
      : body.command === "design-receipt" ? "d5o_hosted_design_release_command_v1"
      : "d5o_hosted_operate_command_v1", args);
    if (result.error) return reply({ error: result.error.message }, errorStatus(result.error));
    const refreshed = await call("d5o_hosted_phase_status_read_v1",
      { p_workspace_key: workspace, p_presentation_id: body.workId });
    return reply({ result: result.data, phaseStatus: refreshed.error ? null : refreshed.data });
  } catch (error) {
    if (error instanceof HostedStateError) return reply({ error: error.code }, error.status);
    return reply({ error: "customer_work_unavailable" }, 503);
  }
}
