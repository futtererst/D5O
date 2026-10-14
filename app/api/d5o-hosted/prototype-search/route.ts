import { NextRequest, NextResponse } from "next/server";
import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { createRybexSupabaseAdminClient, createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { deliveryRoleActions } from "@/lib/d5o/hosted/delivery-role-actions";
import { supportRoleActions } from "@/lib/d5o/hosted/support-role-actions";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import { connectedLifecyclePosition } from "@/components/d5o/platform/connected-work-position";
import { assessDesignPackage, designState } from "@/components/d5o/platform/design-model";
import { serviceExecutionBasisIssue } from "@/lib/d5o/prototype-work/service-execution-basis";
import type { PackageCrewDemand } from "@/components/d5o/platform/schedule-model";
import { resolvePublishedPhaseConfiguration } from "@/components/d5o/platform/published-phase-configuration";
import { hostedConfigurationInventory } from "@/lib/d5o/hosted/configuration-inventory";
import { hostedPrototypeContext, HostedStateError } from "@/lib/d5o/hosted/prototype-context";
import { initialHostedCatalog } from "@/lib/d5o/work-catalog/store";
import { lifecycleProfiles, stateFor } from "@/components/d5o/platform/lifecycle-profiles";
import type { WorkspaceKey } from "@/components/d5o/platform/work-types";

export const dynamic = "force-dynamic";
type Work = Record<string, unknown> & { id: string; title: string; customer: string; site: string; type: string;
  stage: string; owner: string; status: "attention" | "moving" | "complete"; progress: number;
  blockers: string[]; nextAction: string; value: string };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const str = (value: unknown) => typeof value === "string" ? value : "";
function project(value: Record<string, unknown>): Work | null {
  if (!str(value.id) || !str(value.title)) return null;
  return { ...value, id: str(value.id), title: str(value.title), customer: str(value.customer), site: str(value.site),
    type: str(value.type), stage: str(value.stage), owner: str(value.owner),
    status: value.status === "attention" || value.status === "complete" ? value.status : "moving",
    progress: Number(value.progress) || 0, blockers: Array.isArray(value.blockers) ? value.blockers.filter((item): item is string => typeof item === "string") : [],
    nextAction: str(value.nextAction), value: str(value.value) };
}
const pricing = (r: Work) => { const e = (r.discovery as { estimate?: { status?: string; revision?: number; review?: { revision?: number } } } | undefined)?.estimate;
  return e?.status === "Pricing review" && e.review?.revision === e.revision; };
const proposal = (r: Work) => { const p = (r.discovery as { proposal?: { status?: string; package?: { revision?: number }; review?: { revision?: number; authorityRole?: string } } } | undefined)?.proposal;
  return p?.status === "Internal review" && p.review?.revision === p.package?.revision; };
const definition = (r: Work) => { const d = r.definition as { status?: string; revision?: number; reviews?: { revision?: number; commercial?: string; delivery?: string } } | undefined;
  return d?.status === "In review" && d.reviews?.revision === d.revision && (d.reviews?.commercial === "Pending" || d.reviews?.delivery === "Pending"); };

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const workspace = p.get("workspace") ?? "";
  const view = p.get("view") ?? "search";
  const filter = p.get("filter") ?? "all";
  const query = (p.get("q") ?? "").trim().toLocaleLowerCase();
  const owner = p.get("owner") ?? "";
  const recordId = p.get("record");
  const rawPosition = p.get("position");
  const position = rawPosition === null ? null : Number(rawPosition);
  const cursor = p.get("cursor");
  if ((workspace !== "rybex" && workspace !== "rotork") || !["search", "portfolio", "actions", "decisions"].includes(view)
    || query.length > 120 || owner.length > 120 || (recordId?.length ?? 0) > 120 || (cursor?.length ?? 0) > 200
    || (position !== null && (!Number.isInteger(position) || position < 0 || position > 30))) return reply({ error: "invalid_search" }, 400);
  try {
    const ctx = await hostedPrototypeContext(workspace);
    const [work, catalog] = await Promise.all([ctx.read("work"), ctx.read("catalog")]);
    const catalogRecords = Array.isArray(catalog.state?.records) ? catalog.state.records : initialHostedCatalog(workspace as WorkspaceKey).records;
    const workRecords = Array.isArray(work.state?.records) ? work.state.records : [];
    const index = new Map<string, Work>();
    for (const item of [...catalogRecords, ...workRecords]) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const value = project(item as Record<string, unknown>);
      if (value) index.set(value.id, value);
    }
    if (recordId) return index.has(recordId) ? reply({ record: index.get(recordId) }) : reply({ error: "record_unavailable" }, 404);
    let ownedIds: Set<string> | null = null;
    let actorRole = ctx.actor.role;
    let roleActions: unknown[] = [];
    let serviceActions: unknown[] = [];
    let deliveryActions: unknown[] = [];
    let supportActions: unknown[] = [];
    if (authoritativeD5OCommandsReady()) {
      const client = await createRybexSupabaseServerClient();
      const call = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
      const { data, error } = await call("d5o_hosted_work_queue_identity_v1", { p_workspace_key: workspace });
      if (error || !data) return reply({ error: "queue_identity_unavailable" }, 503);
      const identity = data as { role: string; ownedIds: string[] };
      actorRole = identity.role;
      ownedIds = new Set(identity.ownedIds);
      if (view === "actions") {
        // The prototype snapshot is not the source for connected Design and Deploy
        // decisions. Scope this server-only projection after membership resolution.
        const admin = createRybexSupabaseAdminClient();
        const adminCall = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
        const connected = await adminCall("d5o_hosted_server_connected_read_v1", {
          p_workspace_key: workspace, p_state_key: "work"
        });
        const connectedRead = connected.data as { state?: { records?: WorkRecord[] } } | null;
        if (connected.error || !Array.isArray(connectedRead?.state?.records))
          return reply({ error: "delivery_queue_unavailable" }, 503);
        deliveryActions = deliveryRoleActions(connectedRead.state.records.filter((item) => item.workspace === workspace), ctx.actor.id, actorRole);
        supportActions = supportRoleActions(connectedRead.state.records.filter((item) => item.workspace === workspace), ctx.actor.id, actorRole);
        const queued = await call("d5o_hosted_role_actions_v1", { p_workspace_key: workspace });
        if (queued.error || !Array.isArray(queued.data)) return reply({ error: "role_queue_unavailable" }, 503);
        roleActions = (queued.data as Array<{ kind?: string }>).filter((item) => item.kind !== "Field report review");
        const serviceQueued = await call("d5o_hosted_service_actions_v1", { p_workspace_key: workspace });
        if (serviceQueued.error || !Array.isArray(serviceQueued.data)) return reply({ error: "service_queue_unavailable" }, 503);
        const costQueued = await call("d5o_hosted_service_cost_actions_v1", { p_workspace_key: workspace });
        if (costQueued.error || !Array.isArray(costQueued.data)) return reply({ error: "service_cost_queue_unavailable" }, 503);
        serviceActions = [...serviceQueued.data, ...costQueued.data];
        const contextByWork = new Map(connectedRead.state.records.map((item) => [item.id, item]));
        const withWorkContext = (items: unknown[]) => items.map((value) => {
          if (!value || typeof value !== "object") return value;
          const item = value as Record<string, unknown>;
          const source = contextByWork.get(String(item.workId ?? ""));
          return source ? { ...item, workTitle: source.title, customer: item.customer || source.customer, site: source.site, impact: item.requestId ? source.operate?.requests?.find((request) => request.id === item.requestId)?.impact : undefined, packageName: item.packageId ? source.packages?.find((pkg) => pkg.id === item.packageId)?.name ?? item.packageName : undefined } : item;
        });
        roleActions = await Promise.all(withWorkContext(roleActions).map(async (value) => {
          if (!value || typeof value !== "object") return value;
          const item = value as Record<string, unknown>;
          if (item.kind === "Billing review") {
            const exactId = /^Review billing record ([0-9a-f-]{36})$/i.exec(String(item.title ?? ""))?.[1];
            if (!exactId) return { ...item, decisionId: null, position: "waiting", blocker: "The exact billing record cannot be identified for review." };
            const ledger = await call("d5o_hosted_job_finance_read_v1", {
              p_workspace_key: workspace, p_presentation_id: String(item.workId ?? "")
            });
            const bills = (ledger.data as { bills?: Array<{ id?: string; basis?: unknown }> } | null)?.bills;
            const bill = Array.isArray(bills) ? bills.find((entry) => entry.id === exactId) : null;
            if (ledger.error || !bill?.basis) return { ...item, decisionId: exactId, position: "waiting",
              ownership: "Project manager to correct or replace the historical bill",
              blocker: ledger.error ? "The current billing basis could not be checked." : "This bill has no retained current-scope basis; Finance review is held until it is corrected or replaced." };
            return { ...item, decisionId: exactId };
          }
          if (item.kind === "Design review") {
            const source = contextByWork.get(String(item.workId ?? ""));
            const discipline = String(item.title ?? "").replace(/ package review$/, "");
            const matches = source?.design?.reviews?.filter((review) =>
              review.packageId === item.packageId && review.revision === item.revision &&
              review.discipline === discipline && review.status === "Requested") ?? [];
            // Ambiguous old projections fail closed; never substitute another review.
            return { ...item, decisionId: matches.length === 1 ? matches[0].id : null };
          }
          return item;
        }));
        serviceActions = withWorkContext(serviceActions);
        deliveryActions = withWorkContext(deliveryActions);
        supportActions = withWorkContext(supportActions);
      }
    }
    const isMine = (r: Work) => ownedIds ? ownedIds.has(r.id) : r.owner === owner;
    const canReviewDefinition = (r: Work) => {
      const d = r.definition as { reviews?: { commercial?: string; delivery?: string }; submittedByActorId?: string } | undefined;
      return definition(r) && d?.submittedByActorId !== ctx.actor.id &&
        (d?.reviews?.commercial === "Pending" && ["admin", "billing_commercial_lead"].includes(actorRole)
          || d?.reviews?.delivery === "Pending" && ["admin", "operations_leader", "project_manager"].includes(actorRole));
    };
    const canReviewPricing = (r: Work) => pricing(r) &&
      (r.discovery as { estimate?: { review?: { authorityRole?: string; submittedByActorId?: string } } } | undefined)?.estimate?.review?.authorityRole === actorRole &&
      (r.discovery as { estimate?: { review?: { submittedByActorId?: string } } } | undefined)?.estimate?.review?.submittedByActorId !== ctx.actor.id;
    const canReviewProposal = (r: Work) => proposal(r) &&
      (r.discovery as { proposal?: { review?: { authorityRole?: string; submittedByActorId?: string } } } | undefined)?.proposal?.review?.authorityRole === actorRole &&
      (r.discovery as { proposal?: { review?: { submittedByActorId?: string } } } | undefined)?.proposal?.review?.submittedByActorId !== ctx.actor.id;
    const all = [...index.values()].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    const lifecycle = lifecycleProfiles[workspace as WorkspaceKey].states;
    const pos = (r: Work) => connectedLifecyclePosition(r as unknown as WorkRecord) ?? lifecycle.indexOf(stateFor(workspace as WorkspaceKey, r.stage, r.progress));
    const matched = all.filter((r) => (!query || [r.id, r.title, r.customer, r.site, r.type, r.stage, r.owner]
      .some((v) => v.toLocaleLowerCase().includes(query))) && (view === "portfolio"
        ? (position === null || pos(r) === position) && (filter === "all" || filter === "blocked" && r.blockers.length > 0 || filter === r.status)
        : view === "actions" ? filter === "all" || filter === "mine" && isMine(r) || filter === "waiting" && r.status === "attention"
          || filter === "pricing" && (ownedIds ? canReviewPricing(r) : pricing(r)) || filter === "proposal" && (ownedIds ? canReviewProposal(r) : proposal(r)) || filter === "definition" && canReviewDefinition(r)
        : view === "decisions" ? filter === "all" || filter === "blocked" && r.blockers.length > 0 || filter === "actionable" && r.blockers.length === 0 && r.status !== "complete" || filter === "completed" && r.status === "complete"
        : filter === "all" || filter === "mine" && isMine(r) || filter === "attention" && r.status === "attention"));
    const revision = `${work.revision}:${catalog.revision}`;
    let offset = 0;
    if (cursor) {
      let decoded: { revision?: string; offset?: number };
      try { decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); } catch { return reply({ error: "invalid_cursor" }, 400); }
      if (decoded.revision !== revision) return reply({ error: "search_changed" }, 409);
      if (!Number.isSafeInteger(decoded.offset) || Number(decoded.offset) < 0 || Number(decoded.offset) > matched.length) return reply({ error: "invalid_cursor" }, 400);
      offset = Number(decoded.offset);
    }
    const records = matched.slice(offset, offset + 25);
    const nextCursor = offset + 25 < matched.length ? Buffer.from(JSON.stringify({ revision, offset: offset + 25 })).toString("base64url") : null;
    if (view === "portfolio") return reply({ records, total: matched.length, nextCursor,
      overview: { total: all.length, attention: all.filter((r) => r.status === "attention").length,
        stages: Object.fromEntries(lifecycle.map((_, i) => [i, all.filter((r) => pos(r) === i).length])) } });
    if (view === "actions") {
      const configurationInventory = await hostedConfigurationInventory(workspace as WorkspaceKey);
      const scheduleRead = await ctx.read("schedule");
      const packageDemands = Array.isArray(scheduleRead.state?.packageDemands)
        ? scheduleRead.state.packageDemands as PackageCrewDemand[] : [];
      const phaseReviews = all.flatMap((record) => {
        const actions: Record<string, unknown>[] = [];
        if (!record.canonicalWorkId) return actions;
        const mine = actorRole === "project_manager" && ownedIds?.has(record.id);
        const pursuit = (record.discovery as WorkRecord["discovery"] | undefined)?.pursuitControl;
        const handoff = pursuit?.handoff;
        const define = record.definition as WorkRecord["definition"] | undefined;
        const solution = record.develop as WorkRecord["develop"] | undefined;
        const estimate = (record.discovery as { estimate?: { revision?: number } } | undefined)?.estimate;
        const offer = (record.discovery as { proposal?: { package?: { revision?: number } } } | undefined)?.proposal?.package;
        const baseline = record.definition as { revision?: number; reviews?: { commercial?: string; delivery?: string } } | undefined;
        const common = { workId: record.id, workTitle: record.title, customer: record.customer, site: record.site,
          dueDate: null, ownership: "Available to your role" };
        const prep = (kind: string, phase: string, focus: string, revision: number, blocker?: string) =>
          actions.push({ ...common, kind, phase, focus, revision, status: "Preparation", position: "preparation",
            ownership: "Created by you · project manager", blocker: blocker ?? null });
        if (mine && pursuit && ["draft", "returned", "held"].includes(pursuit.status))
          prep("Prepare Discover intake", "Discover", "pursuit-prep", pursuit.revision);
        if (pursuit?.status === "submitted" && pursuit.submission?.revision === pursuit.revision &&
          ["admin", "billing_commercial_lead", "business_development_lead"].includes(actorRole) &&
          pursuit.submission.actorId !== ctx.actor.id)
          actions.push({ ...common, kind: "Review Discover intake", phase: "Discover", focus: "pursuit-review",
            revision: pursuit.revision, status: "Submitted", ownership: "Eligible independent pursuit reviewer" });
        if (mine && pursuit?.status === "qualified" && handoff?.status !== "submitted" && handoff?.status !== "accepted")
          prep("Prepare Define handoff", "Discover", "define-handoff-prep", pursuit.revision);
        if (pursuit?.status === "qualified" && handoff?.status === "submitted" &&
          ["admin", "operations_leader", "project_manager"].includes(actorRole) &&
          handoff.receiverActorId === ctx.actor.id && handoff.actorId !== ctx.actor.id)
          actions.push({ ...common, kind: "Receive Define handoff", phase: "Discover", focus: "define-handoff-receive",
            revision: pursuit.revision, status: "Submitted", ownership: "Named receiving account" });
        if (mine && handoff?.status === "accepted" && (!define || ["Draft", "Changes requested"].includes(define.status)))
          prep("Prepare definition", "Define", "define-prep", define?.revision ?? 1);
        if (mine && define?.status === "Approved" && define.developHandoff?.status !== "submitted" && define.developHandoff?.status !== "accepted")
          prep("Submit approved Define basis to Develop", "Define", "develop-handoff-prep", define.revision);
        if (define?.status === "Approved" && define.developHandoff?.status === "submitted" &&
          ["admin", "operations_leader", "project_manager"].includes(actorRole) &&
          define.developHandoff.submittedByActorId !== ctx.actor.id)
          actions.push({ ...common, kind: "Receive approved Define basis", phase: "Define", focus: "develop-handoff-receive",
            revision: define.revision, status: "Submitted", ownership: "Eligible independent Develop receiver" });
        const received = define?.status === "Approved" && define.developHandoff?.status === "accepted" && define.developHandoff.revision === define.revision;
        if (mine && received && (!solution?.review || solution.review.status === "Returned" || solution.review.revision !== solution.revision))
          prep("Prepare solution", "Develop", "solution-prep", solution?.revision ?? 0);
        if (solution?.review?.status === "Submitted" && solution.review.revision === solution.revision &&
          solution.review.approverRole === actorRole && solution.review.submittedByActorId !== ctx.actor.id)
          actions.push({ ...common, kind: "Solution review", phase: "Develop", focus: "solution-review",
            revision: solution.revision, status: "Submitted", dueDate: solution.review.dueDate,
            ownership: "Eligible independent solution reviewer" });
        if (mine && received && solution?.review?.status === "Approved" && solution.review.revision === solution.revision &&
          !["Pricing review", "Approved"].includes((record.discovery as WorkRecord["discovery"])?.estimate.status ?? ""))
          prep("Prepare detailed estimate", "Develop", "pricing-prep", estimate?.revision ?? 0);
        if (mine && (record.discovery as WorkRecord["discovery"])?.estimate.status === "Approved" &&
          !["Internal review", "Approved", "Submitted"].includes((record.discovery as WorkRecord["discovery"])?.proposal.status ?? ""))
          prep("Prepare customer proposal", "Develop", "proposal-prep", offer?.revision ?? 0);
        if (canReviewPricing(record) && estimate?.revision) actions.push({ ...common, kind: "Pricing review", phase: "Develop", focus: "pricing", revision: estimate.revision, status: "Submitted", title: record.title });
        if (canReviewProposal(record) && offer?.revision) actions.push({ ...common, kind: "Proposal approval", phase: "Develop", focus: "proposal", revision: offer.revision, status: "Submitted", title: record.title });
        const commercial = record.discovery as WorkRecord["discovery"] | undefined;
        if (mine && commercial?.proposal.status === "Approved" && offer?.revision &&
          commercial.proposal.review?.revision === offer.revision)
          prep("Record customer submission", "Develop", "customer-submission-prep", offer.revision);
        if (mine && commercial?.outcome === "Won" && commercial.designHandoff?.status === "returned")
          prep("Correct Design handoff", "Develop", "design-handoff-correction", commercial.designHandoff.revision,
            commercial.designHandoff.decisionNote || "Respond to the receiving decision before resubmission.");
        if (commercial?.designHandoff?.status === "submitted" &&
          actorRole === "operations_leader" && commercial.designHandoff.submittedByActorId !== ctx.actor.id)
          actions.push({ ...common, kind: "Receive Design handoff", phase: "Develop", focus: "design-handoff-receive",
            revision: commercial.designHandoff.revision, status: "Submitted", dueDate: commercial.designHandoff.responseDueDate,
            ownership: "Eligible independent Design receiver" });
        const acceptedDesignSource = commercial?.outcome === "Won" && commercial.designHandoff?.status === "accepted" &&
          commercial.designHandoff.brief.definitionRevision === define?.revision &&
          commercial.designHandoff.brief.configurationVersionId === record.phaseConfigurationVersionId;
        const currentPackages = (record as WorkRecord).packages ?? [];
        const designPosition = designState(record as WorkRecord);
        const designPolicy = resolvePublishedPhaseConfiguration(configurationInventory, workspace as WorkspaceKey,
          record.type, record as WorkRecord)?.designControls;
        const acceptedServiceSource = !!record.serviceSource && (record as WorkRecord).serviceExecutionBasis?.status === "accepted" &&
          !serviceExecutionBasisIssue(record as WorkRecord, all as WorkRecord[]);
        const acceptedPackageSource = acceptedDesignSource || acceptedServiceSource;
        if (acceptedPackageSource && actorRole === "operations_leader" &&
          (record as WorkRecord).deploy?.workAcceptance?.receipt !== "Accepted") for (const item of currentPackages) {
          const detail = designPosition.packages.find((candidate) => candidate.packageId === item.id);
          if (!detail || detail.status !== "In review" || designPosition.releases.some((release) =>
            release.packageId === item.id && release.packageRevision === detail.revision &&
            ["Awaiting receipt", "Accepted"].includes(release.status))) continue;
          const required = designPolicy?.requiredReviews ?? [];
          if (!required.length || !required.every((discipline) => designPosition.reviews.some((review) =>
            review.packageId === item.id && review.revision === detail.revision &&
            review.discipline === discipline && review.status === "Approved"))) continue;
          const engineeringReview = designPosition.reviews.find((review) => review.packageId === item.id &&
            review.revision === detail.revision && review.discipline === "Engineering" && review.status === "Approved");
          if (!engineeringReview || engineeringReview.decidedByActorId === ctx.actor.id) continue;
          const readiness = assessDesignPackage(record as WorkRecord, item.id, undefined,
            packageDemands.find((demand) => demand.workId === record.id && demand.packageId === item.id) ?? null,
            designPolicy);
          if (readiness.recommendation !== "Ready for release") continue;
          actions.push({ ...common, kind: "Authorize package release", phase: "Design", focus: "package-release-decision",
            packageId: item.id, packageName: item.name, revision: detail.revision, status: "Reviewed",
            ownership: "Eligible independent Delivery Leader", blocker: "Confirm current readiness and exact issued scope before release." });
        }
        const designDocuments = designPosition.documents;
        if (actorRole === "operations_leader") for (const release of designPosition.releases) {
          const packageItem = currentPackages.find((item) => item.id === release.packageId);
          if (release.status !== "Awaiting receipt" || !packageItem ||
            designPosition.packages.find((item) => item.packageId === release.packageId)?.revision !== release.packageRevision ||
            release.issuedByActorId === ctx.actor.id) continue;
          actions.push({ ...common, kind: "Receive Design release", phase: "Deploy", focus: "design-release-receipt",
            decisionId: release.id, packageId: release.packageId, packageName: packageItem.name,
            revision: release.packageRevision, sourceRevision: designPosition.authorityRevision,
            status: "Awaiting receipt", dueDate: release.responseDueDate,
            ownership: "Eligible independent Deploy receiver" });
        }
        for (const document of designDocuments) {
          if (designDocuments.some((item) => item.id === document.id && item.revision > document.revision)) continue;
          const packageId = document.packageIds.find((id) => currentPackages.some((item) => item.id === id));
          const packageName = currentPackages.find((item) => item.id === packageId)?.name;
          if (mine && actorRole === "project_manager" && document.status === "Returned")
            actions.push({ ...common, kind: `Correct document · ${document.title}`, phase: "Design", focus: "document-correction",
              decisionId: document.id, packageId, packageName, revision: document.revision, status: "Returned",
              ownership: "Created by you · project manager", position: "preparation",
              blocker: document.returnNote || "The independent reviewer returned this revision." });
          if (mine && actorRole === "project_manager" && document.status === "Draft")
            actions.push({ ...common, kind: `Submit document · ${document.title}`, phase: "Design", focus: "document-preparation",
              decisionId: document.id, packageId, packageName, revision: document.revision, status: "Draft",
              ownership: "Created by you · project manager", position: "preparation",
              blocker: "Retain an inspectable private PDF for this exact revision before submission." });
          if (document.status === "In review" && actorRole === "operations_leader" && document.submittedByActorId !== ctx.actor.id)
            actions.push({ ...common, kind: `Review document · ${document.title}`, phase: "Design", focus: "document-review",
              decisionId: document.id, packageId, packageName, revision: document.revision, status: "Submitted",
              dueDate: document.dueDate || null, ownership: "Eligible independent engineering reviewer" });
          if (mine && document.status === "Approved" && document.approvedByActorId !== ctx.actor.id)
            actions.push({ ...common, kind: `Issue document · ${document.title}`, phase: "Design", focus: "document-issue",
              decisionId: document.id, packageId, packageName, revision: document.revision, status: "Approved",
              ownership: "Created by you · project manager", position: "preparation" });
        }
        if (mine && acceptedPackageSource &&
          (record as WorkRecord).deploy?.workAcceptance?.receipt !== "Accepted") {
          if (!currentPackages.length)
            prep("Prepare Work Package", "Design", "package-prep", record.serviceSource
              ? (record as WorkRecord).serviceExecutionBasis!.revision : commercial!.designHandoff!.revision);
          const design = designState(record as WorkRecord);
          for (const item of currentPackages) {
            const detail = design.packages.find((candidate) => candidate.packageId === item.id);
            const rawDetail = (record as WorkRecord).design?.packages?.find((candidate) => candidate.packageId === item.id);
            const malformed = !!rawDetail && (![rawDetail.requirementIds, rawDetail.predecessorIds, rawDetail.documentRefs].every(Array.isArray)
              || !rawDetail.materialStatus || !rawDetail.commercialDisposition);
            if (!detail || malformed)
              actions.push({ ...common, kind: malformed ? "Correct package draft" : "Engineer Work Package", phase: "Design", focus: "package-engineering",
                packageId: item.id, packageName: item.name, revision: detail?.revision ?? 0, status: "Preparation", position: "preparation",
                ownership: "Created by you · project manager", blocker: malformed ? "Retained draft has missing source references; save a corrected revision before review." : null });
            else if (detail.status === "Returned") {
              const returned = [...design.reviews].reverse().find((review) => review.packageId === item.id &&
                review.revision === detail.revision && review.status === "Returned");
              actions.push({ ...common, kind: "Correct returned package", phase: "Design", focus: "package-correction",
                packageId: item.id, packageName: item.name, revision: detail.revision, status: detail.status,
                position: "preparation", ownership: "Created by you · project manager",
                blocker: returned?.note || "Review returned this exact revision; inspect the decision before resubmission." });
            } else if (detail.status === "Draft" && !detail.documentRefs.some((ref) =>
              design.documents.some((document) => `${document.id}@${document.revision}` === ref &&
                document.status === "Issued for use" && document.packageIds.includes(item.id))))
              actions.push({ ...common, kind: "Link issued document to package", phase: "Design", focus: "package-release-prep",
                packageId: item.id, packageName: item.name, revision: detail.revision, status: detail.status,
                position: "preparation", ownership: "Created by you · project manager",
                blocker: "The current package revision needs an exact issued governing document before review." });
            else if (detail.status === "Draft")
              actions.push({ ...common, kind: "Request package review", phase: "Design", focus: "package-review-request",
                packageId: item.id, packageName: item.name, revision: detail.revision, status: detail.status,
                position: "preparation", ownership: "Created by you · project manager" });
            else if (detail.status === "In review" && !design.releases.some((release) =>
              release.packageId === item.id && release.packageRevision === detail.revision &&
              ["Awaiting receipt", "Accepted"].includes(release.status)) &&
              (!designPolicy || assessDesignPackage(record as WorkRecord, item.id, undefined,
                packageDemands.find((demand) => demand.workId === record.id && demand.packageId === item.id) ?? null,
                designPolicy).recommendation !== "Ready for release"))
              actions.push({ ...common, kind: "Complete package release preparation", phase: "Design", focus: "package-release-prep",
                packageId: item.id, packageName: item.name, revision: detail.revision, status: detail.status,
                position: "preparation", ownership: "Created by you · project manager",
                blocker: "Resolve the current package readiness findings before Delivery can authorize release." });
          }
        }
        if (canReviewDefinition(record) && baseline?.revision) {
          for (const role of ["commercial", "delivery"] as const) if (baseline.reviews?.[role] === "Pending" &&
            (role === "commercial" ? ["admin", "billing_commercial_lead"].includes(actorRole) : ["admin", "operations_leader", "project_manager"].includes(actorRole)))
            actions.push({ ...common, kind: `Define ${role} review`, phase: "Define", focus: role, revision: baseline.revision, status: "Submitted", title: record.title });
        }
        return actions;
      });
      roleActions = [...phaseReviews, ...roleActions];
      return reply({ records, total: matched.length, nextCursor, ownedIds: [...(ownedIds ?? [])], actorRole, roleActions, serviceActions, deliveryActions, supportActions,
      roles: [...new Set(all.filter((r) => ownedIds ? canReviewProposal(r) : proposal(r)).map((r) => (r.discovery as { proposal?: { review?: { authorityRole?: string } } } | undefined)?.proposal?.review?.authorityRole).filter(Boolean))],
      overview: { total: all.length, mine: all.filter(isMine).length, waiting: all.filter((r) => r.status === "attention").length,
        pricing: all.filter((r) => ownedIds ? canReviewPricing(r) : pricing(r)).length, proposal: all.filter((r) => ownedIds ? canReviewProposal(r) : proposal(r)).length, definition: all.filter(canReviewDefinition).length } });
    }
    if (view === "decisions") return reply({ records, total: matched.length, nextCursor,
      overview: { total: all.length, blocked: all.filter((r) => r.blockers.length > 0).length,
        actionable: all.filter((r) => r.blockers.length === 0 && r.status !== "complete").length, completed: all.filter((r) => r.status === "complete").length } });
    return reply({ records, total: matched.length, nextCursor });
  } catch (error) {
    if (error instanceof HostedStateError) return reply({ error: error.code }, error.status);
    return reply({ error: "search_unavailable" }, 503);
  }
}
