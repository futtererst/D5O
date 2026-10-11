import { NextRequest, NextResponse } from "next/server";
import { authoritativeD5OCommandsReady } from "@/lib/d5o/auth/hosted-target";
import { createRybexSupabaseAdminClient, createRybexSupabaseServerClient } from "@/lib/d5o/auth/supabase-server";
import { deliveryRoleActions } from "@/lib/d5o/hosted/delivery-role-actions";
import { supportRoleActions } from "@/lib/d5o/hosted/support-role-actions";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
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
          return source ? { ...item, workTitle: source.title, customer: item.customer || source.customer, site: source.site, impact: item.requestId ? source.operate?.requests?.find((request) => request.id === item.requestId)?.impact : undefined, packageName: item.packageId ? source.packages?.find((pkg) => pkg.id === item.packageId)?.name : undefined } : item;
        });
        roleActions = withWorkContext(roleActions).map((value) => {
          if (!value || typeof value !== "object") return value;
          const item = value as Record<string, unknown>;
          if (item.kind === "Billing review") {
            const exactId = /^Review billing record ([0-9a-f-]{36})$/i.exec(String(item.title ?? ""))?.[1];
            return { ...item, decisionId: exactId ?? null };
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
        });
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
    const pos = (r: Work) => lifecycle.indexOf(stateFor(workspace as WorkspaceKey, r.stage, r.progress));
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
      const phaseReviews = all.flatMap((record) => {
        const actions: Record<string, unknown>[] = [];
        const estimate = (record.discovery as { estimate?: { revision?: number } } | undefined)?.estimate;
        const offer = (record.discovery as { proposal?: { package?: { revision?: number } } } | undefined)?.proposal?.package;
        const baseline = record.definition as { revision?: number; reviews?: { commercial?: string; delivery?: string } } | undefined;
        const common = { workId: record.id, workTitle: record.title, customer: record.customer, site: record.site,
          dueDate: null, ownership: "Available to your role" };
        if (canReviewPricing(record) && estimate?.revision) actions.push({ ...common, kind: "Pricing review", phase: "Develop", focus: "pricing", revision: estimate.revision, status: "Submitted", title: record.title });
        if (canReviewProposal(record) && offer?.revision) actions.push({ ...common, kind: "Proposal approval", phase: "Develop", focus: "proposal", revision: offer.revision, status: "Submitted", title: record.title });
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
