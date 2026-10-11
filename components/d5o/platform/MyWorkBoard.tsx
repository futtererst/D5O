"use client";

import { useEffect, useState } from "react";
import { actionDueLabel, actionImpactLabel, type ActionPriority } from "./action-priority";
import type { DecisionQueueContext } from "./decision-queue-context";
import type { DefinitionRecord } from "./work-types";
import type { ServiceAction } from "./service-actions";
import { ServiceActionQueue } from "./ServiceActionQueue";
import { DeliveryActionQueue } from "./DeliveryActionQueue";
import { SupportActionQueue } from "./SupportActionQueue";
import { FocusedMyWorkBoard } from "./FocusedMyWorkBoard";
import type { DeliveryAction } from "@/lib/d5o/hosted/delivery-role-actions";
import type { SupportAction } from "@/lib/d5o/hosted/support-role-actions";

type WorkLike = ActionPriority & {
  source?: WorkLike;
  id: string;
  workspace: "rybex" | "rotork";
  title: string;
  type: string;
  customer: string;
  site: string;
  stage: string;
  owner: string;
  nextAction: string;
  value: string;
  status: "attention" | "moving" | "complete";
  proof: string[];
  discovery?: { estimate: { status: string; revision: number; labor: number; materials: number; subcontract: number; travel: number; contingency: number; sellPrice: number; targetMargin: number; assumption: string; definitionSource?: { revision: number; configurationVersionId: string }; review?: { revision: number; dueDate?: string; submittedBy: string } }; proposal?: { status: string; dueDate: string; recipient: string; method: string; package?: { revision: number; estimateRevision: number; scope: string; assumptions: string; exclusions: string; commercialTerms: string; sellPrice: number; definitionSource?: { revision: number; configurationVersionId: string } }; review?: { revision: number; submittedAt: string; submittedBy: string; dueDate: string; authorityRole?: string; grossMarginPercent?: number; priceChangePercent?: number; scopeChanged?: boolean; termsChanged?: boolean } } };
  definition?: DefinitionRecord;
};
type Filter = "all" | "mine" | "waiting" | "pricing" | "proposal" | "definition";
type RoleAction = { kind: string; workId: string; packageId?: string | null; revision: number; status: string; title: string; dueDate?: string | null; phase: string; ownership: string };
type QueuePage<T> = { ownedIds?: string[]; actorRole?: string; roleActions?: RoleAction[]; serviceActions?: ServiceAction[]; deliveryActions?: DeliveryAction[]; supportActions?: SupportAction[]; records: T[]; total: number; nextCursor: string | null; roles: string[];
  overview: { total: number; mine: number; waiting: number; pricing: number; proposal: number; definition: number } };
const isPricingReview = (item: WorkLike) => item.discovery?.estimate.status === "Pricing review" && Number.isInteger(item.discovery.estimate.revision) && item.discovery.estimate.review?.revision === item.discovery.estimate.revision;
const isProposalReview = (item: WorkLike) => item.discovery?.proposal?.status === "Internal review" && Number.isInteger(item.discovery.proposal.package?.revision) && item.discovery.proposal.review?.revision === item.discovery.proposal.package?.revision;
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

export function MyWorkBoard<T extends WorkLike>({ actions: localActions, currentOwner, initialFilter = "all", onOpen, onReviewPricing, onReviewProposal, onReviewDefinition, getDecisionContext, hostedWorkspace }: {
  actions: T[];
  currentOwner: string;
  initialFilter?: Filter;
  onOpen: (item: T) => void;
  onReviewPricing: (item: T) => void;
  onReviewProposal: (item: T) => void;
  onReviewDefinition: (item: T, role: "commercial" | "delivery") => void;
  getDecisionContext: (item: T) => DecisionQueueContext;
  hostedWorkspace?: string;
}) {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [proposalRoleFilter, setProposalRoleFilter] = useState("all");
  const [focusedId, setFocusedId] = useState("");
  const [focusedDefinitionId, setFocusedDefinitionId] = useState("");
  const [result, setResult] = useState<{ key: string; page: QueuePage<T> } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const localSignature = localActions.map((item) => `${item.id}:${item.stage}:${item.status}:${item.discovery?.estimate.revision ?? ""}:${item.discovery?.proposal?.package?.revision ?? ""}:${item.definition?.revision ?? ""}`).join("|");
  const requestKey = `${filter}:${currentOwner}:${proposalRoleFilter}:${localSignature}`;
  const page = result?.key === requestKey ? result.page : null;
  const error = failure?.key === requestKey ? failure.message : "";
  const loading = (!page && !error) || loadingMore;
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ view: "actions", filter, owner: currentOwner, role: proposalRoleFilter });
    if (hostedWorkspace) params.set("workspace", hostedWorkspace);
    void fetch(`${hostedWorkspace ? "/api/d5o-hosted/prototype-search" : "/api/work/search"}?${params}`, { cache: "no-store", signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("Action queue unavailable"); return response.json() as Promise<QueuePage<T>>; })
      .then((next) => { if (!controller.signal.aborted) { setResult({ key: requestKey, page: next }); setFailure(null); } })
      .catch(() => { if (!controller.signal.aborted) setFailure({ key: requestKey, message: "Action queue unavailable. Try again." }); });
    return () => controller.abort();
  }, [filter, currentOwner, proposalRoleFilter, requestKey, hostedWorkspace]);
  async function loadMore() {
    if (!page?.nextCursor || loading) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ view: "actions", filter, owner: currentOwner, role: proposalRoleFilter, cursor: page.nextCursor });
      if (hostedWorkspace) params.set("workspace", hostedWorkspace);
      const response = await fetch(`${hostedWorkspace ? "/api/d5o-hosted/prototype-search" : "/api/work/search"}?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("The action queue changed.");
      const next = await response.json() as QueuePage<T>;
      setResult({ key: requestKey, page: { ...next, records: [...page.records, ...next.records] } });
      setFailure(null);
    } catch { setFailure({ key: requestKey, message: "The action queue changed. Reopen this view to refresh." }); }
    finally { setLoadingMore(false); }
  }
  const actions = (page?.records ?? []).map((item) => localActions.find((local) => local.id === item.id) ?? item);
  const counts = page?.overview;
  const loadMoreControl = <div className="d5o-queue-pagination" role="status">
    {loading ? "Loading actions…" : error || (page ? `${actions.length} of ${page.total} Work Records loaded` : "")}
    {page?.nextCursor ? <button disabled={loading} onClick={() => { void loadMore(); }}>Load more actions</button> : null}
  </div>;
  const ownedIds = new Set(page?.ownedIds ?? []);
  const mine = actions.filter((item) => hostedWorkspace ? ownedIds.has(item.id) : item.owner === currentOwner);
  const waiting = actions.filter((item) => hostedWorkspace ? !ownedIds.has(item.id) : item.owner !== currentOwner);
  const pricing = actions.filter(isPricingReview);
  const proposals = actions.filter(isProposalReview);
  const definitionReviews = actions.flatMap((item) => item.definition?.status === "In review" && Number.isInteger(item.definition.revision) && item.definition.reviews?.revision === item.definition.revision ? (["commercial", "delivery"] as const).filter((role) => item.definition?.reviews?.[role] === "Pending" && (!hostedWorkspace || role === "commercial" && ["admin", "billing_commercial_lead"].includes(page?.actorRole ?? "") || role === "delivery" && ["admin", "operations_leader", "project_manager"].includes(page?.actorRole ?? ""))).map((role) => ({ item, role, key: `${item.id}:${role}` })) : []);
  const proposalRoles = page?.roles ?? [];
  const roleQueueProposals = proposalRoleFilter === "all" ? proposals : proposals.filter((item) => item.discovery?.proposal?.review?.authorityRole === proposalRoleFilter);
  const shown = filter === "mine" ? mine : filter === "waiting" ? waiting : filter === "pricing" ? pricing : filter === "proposal" ? roleQueueProposals : actions;
  const focused = shown.find((item) => item.id === focusedId) ?? shown[0];
  const focusedDefinition = definitionReviews.find((entry) => entry.key === focusedDefinitionId) ?? definitionReviews[0];
  const focusContext = focused ? getDecisionContext(focused) : null;

  if (!page) return <section className="d5o-ops-mywork"><header className="d5o-ops-heading"><div><p>MY WORK</p><h1>Actions requiring attention</h1></div></header><div className="d5o-ops-panel d5o-queue-loading" role={error ? "alert" : "status"}>{error || "Loading workspace actions…"}{error ? <button onClick={() => window.location.reload()}>Retry</button> : null}</div></section>;

  if (hostedWorkspace) return <FocusedMyWorkBoard workspace={hostedWorkspace} page={page} onOpen={onOpen} onLoadMore={() => { void loadMore(); }} loading={loading} />;

  if (filter === "pricing") return <section className="d5o-ops-mywork">
    <header className="d5o-ops-heading"><div><p>MY WORK · ROLE-BASED QUEUE</p><h1>Pricing authority reviews</h1><span>Review the submitted revision, assumptions, margin, and decision deadline.</span></div><div className="d5o-ops-count"><strong>{counts?.pricing ?? pricing.length}</strong><span>Awaiting decision</span></div></header>
    <nav className="d5o-ops-tabs" aria-label="Action filters"><button onClick={() => setFilter("all")}>All actions <b>{counts?.total ?? actions.length}</b></button><button onClick={() => setFilter("mine")}>Work I own <b>{counts?.mine ?? mine.length}</b></button><button onClick={() => setFilter("waiting")}>Other owners <b>{counts?.waiting ?? waiting.length}</b></button><button className="is-active" onClick={() => setFilter("pricing")}>Pricing reviews <b>{counts?.pricing ?? pricing.length}</b></button><button onClick={() => setFilter("proposal")}>Proposal approvals <b>{counts?.proposal ?? proposals.length}</b></button><button onClick={() => setFilter("definition")}>Definition reviews <b>{counts?.definition ?? definitionReviews.length}</b></button></nav>
    <div className="d5o-ops-mywork-layout"><section className="d5o-ops-panel d5o-ops-action-list"><header><div><p>SUBMITTED COMMERCIAL DECISIONS</p><h2>Pricing review queue</h2></div><span>{counts?.pricing ?? pricing.length} pending</span></header><p className="d5o-ops-queue-note">These items are routed to the configured pricing-authority role. Current membership and independent-review rules are checked again when a decision is submitted.</p>{pricing.length ? pricing.map((item) => { const review = item.discovery!.estimate.review!; const selected = focused?.id === item.id; return <button key={item.id} className={selected ? "is-selected" : ""} onClick={() => setFocusedId(item.id)}><span className={`d5o-ops-status is-${item.status}`} /><span><small>{item.customer} · Estimate revision {review.revision}</small><strong>{item.title}</strong><em>{item.discovery!.estimate.assumption || "No estimate assumptions recorded."}</em><small>{actionDueLabel(review.dueDate)} · {actionImpactLabel(item.nextActionImpact)}</small></span><span className="d5o-ops-row-action">Review →</span></button>; }) : <p className="d5o-ops-empty">No estimate revisions are waiting for pricing authority.</p>}</section>
      <aside className="d5o-ops-panel d5o-ops-action-detail">{focused && isPricingReview(focused) ? <><p>DECISION FOCUS · REVISION {focused.discovery!.estimate.review!.revision}</p><h2>{focused.title}</h2><span>{focused.customer} · {focused.site}</span><dl><div><dt>Submitted by</dt><dd>{focused.discovery!.estimate.review!.submittedBy}</dd></div><div><dt>Decision owner</dt><dd>Pricing authority · workspace role</dd></div><div><dt>Due date</dt><dd>{actionDueLabel(focused.discovery!.estimate.review!.dueDate)}</dd></div><div><dt>Estimated cost</dt><dd>{money(focused.discovery!.estimate.labor + focused.discovery!.estimate.materials + focused.discovery!.estimate.subcontract + focused.discovery!.estimate.travel + focused.discovery!.estimate.contingency)}</dd></div><div><dt>Sell price</dt><dd>{money(focused.discovery!.estimate.sellPrice)}</dd></div><div><dt>Target margin</dt><dd>{focused.discovery!.estimate.targetMargin}%</dd></div><div><dt>Assumptions / exclusions</dt><dd>{focused.discovery!.estimate.assumption || "None recorded"}</dd></div>{focused.discovery!.estimate.definitionSource ? <div><dt>Approved Define basis</dt><dd>Revision {focused.discovery!.estimate.definitionSource.revision} · configuration {focused.discovery!.estimate.definitionSource.configurationVersionId}</dd></div> : null}<div><dt>Value at stake</dt><dd>{focused.value}</dd></div></dl><button className="d5o-primary" onClick={() => onReviewPricing(focused)}>Open pricing review →</button><small className="d5o-prototype-authority-note">Opening the review takes you to Develop. The command verifies your current authority and the exact revision.</small></> : <p>Select a submitted estimate to review its context.</p>}</aside></div>{loadMoreControl}
  </section>;

  if (filter === "proposal") return <section className="d5o-ops-mywork">
    <header className="d5o-ops-heading"><div><p>MY WORK · ROLE-BASED QUEUE</p><h1>Proposal approval reviews</h1><span>Confirm the offer package is accurate and authorized before customer submission.</span></div><div className="d5o-ops-count"><strong>{counts?.proposal ?? proposals.length}</strong><span>Awaiting decision</span></div></header>
    <nav className="d5o-ops-tabs" aria-label="Action filters"><button onClick={() => setFilter("all")}>All actions <b>{counts?.total ?? actions.length}</b></button><button onClick={() => setFilter("mine")}>Work I own <b>{counts?.mine ?? mine.length}</b></button><button onClick={() => setFilter("waiting")}>Other owners <b>{counts?.waiting ?? waiting.length}</b></button><button onClick={() => setFilter("pricing")}>Pricing reviews <b>{counts?.pricing ?? pricing.length}</b></button><button className="is-active" onClick={() => setFilter("proposal")}>Proposal approvals <b>{counts?.proposal ?? proposals.length}</b></button><button onClick={() => setFilter("definition")}>Definition reviews <b>{counts?.definition ?? definitionReviews.length}</b></button></nav>
    <div className="d5o-ops-mywork-layout"><section className="d5o-ops-panel d5o-ops-action-list"><header><div><p>COMMERCIAL AUTHORIZATION</p><h2>Proposal approval queue</h2></div><span>{page.total} pending</span></header><p className="d5o-ops-queue-note">Choose a configured authority role to see the offers routed to that role. These are synthetic queues; they do not establish a real person’s approval right.</p><div className="d5o-proposal-queue-filter"><label>Authority role<select value={proposalRoleFilter} onChange={(event) => { setProposalRoleFilter(event.target.value); setFocusedId(""); }}><option value="all">All authority roles</option>{proposalRoles.map((role) => <option key={role}>{role}</option>)}</select></label><span>{page.total} awaiting decision</span></div>{roleQueueProposals.length ? roleQueueProposals.map((item) => { const packageRevision = item.discovery!.proposal!.package!; const review = item.discovery!.proposal!.review!; return <button key={item.id} className={focused?.id === item.id ? "is-selected" : ""} onClick={() => setFocusedId(item.id)}><span className={`d5o-ops-status is-${item.status}`} /><span><small>{item.customer} · Proposal rev {packageRevision.revision} · Estimate rev {packageRevision.estimateRevision}</small><strong>{item.title}</strong><em>{packageRevision.scope}</em><small>Role queue · {review.authorityRole ?? "Legacy role not recorded"} · {actionDueLabel(review.dueDate)} · {money(packageRevision.sellPrice)}</small></span><span className="d5o-ops-row-action">Review →</span></button>; }) : <p className="d5o-ops-empty">No proposal revisions are awaiting approval in this role queue.</p>}</section>
      <aside className="d5o-ops-panel d5o-ops-action-detail">{focused && isProposalReview(focused) ? <><p>DECISION FOCUS · PROPOSAL REV {focused.discovery!.proposal!.package!.revision}</p><h2>{focused.title}</h2><span>{focused.customer} · {focused.site}</span><dl><div><dt>Submitted by</dt><dd>{focused.discovery!.proposal!.review!.submittedBy}</dd></div><div><dt>Decision owner</dt><dd>{focused.discovery!.proposal!.review!.authorityRole ?? "Legacy proposal authority · profile not recorded"}</dd></div><div><dt>Decision due</dt><dd>{actionDueLabel(focused.discovery!.proposal!.review!.dueDate)}</dd></div><div><dt>Approved estimate</dt><dd>Revision {focused.discovery!.proposal!.package!.estimateRevision}</dd></div>{focused.discovery!.proposal!.package!.definitionSource ? <div><dt>Approved Define basis</dt><dd>Revision {focused.discovery!.proposal!.package!.definitionSource.revision} · configuration {focused.discovery!.proposal!.package!.definitionSource.configurationVersionId}</dd></div> : null}<div><dt>Offer price</dt><dd>{money(focused.discovery!.proposal!.package!.sellPrice)}</dd></div><div><dt>Margin at routing</dt><dd>{focused.discovery!.proposal!.review!.grossMarginPercent === undefined ? "Not recorded" : `${focused.discovery!.proposal!.review!.grossMarginPercent.toFixed(1)}%`}</dd></div><div><dt>Customer</dt><dd>{focused.discovery!.proposal!.recipient || "Not yet assigned"}</dd></div><div><dt>Submission route</dt><dd>{focused.discovery!.proposal!.method}</dd></div><div><dt>Scope</dt><dd>{focused.discovery!.proposal!.package!.scope}</dd></div><div><dt>Terms</dt><dd>{focused.discovery!.proposal!.package!.commercialTerms}</dd></div></dl><button className="d5o-primary" onClick={() => onReviewProposal(focused)}>Open proposal approval →</button><small className="d5o-prototype-authority-note">The decision is recorded in Develop against this proposal revision. Live identity, assignment, and approval-right enforcement are not connected.</small></> : <p>Select a submitted proposal revision to review its terms.</p>}</aside></div>{loadMoreControl}
  </section>;

  if (filter === "definition") return <section className="d5o-ops-mywork">
    <header className="d5o-ops-heading"><div><p>MY WORK · ROLE-BASED QUEUE</p><h1>Definition reviews</h1><span>Commercial and Delivery each review the same submitted definition revision before authorization is considered.</span></div><div className="d5o-ops-count"><strong>{counts?.definition ?? definitionReviews.length}</strong><span>Role decisions pending</span></div></header>
    <nav className="d5o-ops-tabs" aria-label="Action filters"><button onClick={() => setFilter("all")}>All actions <b>{counts?.total ?? actions.length}</b></button><button onClick={() => setFilter("mine")}>Work I own <b>{counts?.mine ?? mine.length}</b></button><button onClick={() => setFilter("waiting")}>Other owners <b>{counts?.waiting ?? waiting.length}</b></button><button onClick={() => setFilter("pricing")}>Pricing reviews <b>{counts?.pricing ?? pricing.length}</b></button><button onClick={() => setFilter("proposal")}>Proposal approvals <b>{counts?.proposal ?? proposals.length}</b></button><button className="is-active" onClick={() => setFilter("definition")}>Definition reviews <b>{counts?.definition ?? definitionReviews.length}</b></button></nav>
    <div className="d5o-ops-mywork-layout"><section className="d5o-ops-panel d5o-ops-action-list"><header><div><p>SUBMITTED DEFINITION BASELINES</p><h2>Decisions by role</h2></div><span>{counts?.definition ?? definitionReviews.length} pending</span></header><p className="d5o-ops-queue-note">Each row names the synthetic role and exact revision. This prototype does not grant the signed-in user that role or enforce live approval rights.</p>{definitionReviews.length ? definitionReviews.map(({ item, role, key }) => <button key={key} className={focusedDefinition?.key === key ? "is-selected" : ""} onClick={() => setFocusedDefinitionId(key)}><span className={`d5o-ops-status is-${item.status}`} /><span><small>{item.customer} · Definition revision {item.definition!.revision}</small><strong>{item.title}</strong><em>{role === "commercial" ? "Commercial basis review" : "Delivery basis review"}</em><small>Role queue · {role === "commercial" ? "Commercial" : "Delivery"}</small></span><span className="d5o-ops-row-action">Review →</span></button>) : <p className="d5o-ops-empty">No definition role decisions are pending.</p>}</section>
      <aside className="d5o-ops-panel d5o-ops-action-detail">{focusedDefinition ? <><p>DECISION FOCUS · DEFINITION REV {focusedDefinition.item.definition!.revision}</p><h2>{focusedDefinition.item.title}</h2><span>{focusedDefinition.item.customer} · {focusedDefinition.item.site}</span><dl><div><dt>Review role</dt><dd>{focusedDefinition.role === "commercial" ? "Commercial" : "Delivery"}</dd></div><div><dt>Submitted revision</dt><dd>{focusedDefinition.item.definition!.revision}</dd></div><div><dt>Discover price source</dt><dd>{focusedDefinition.item.definition!.sourceEstimateRevision ? `Estimate revision ${focusedDefinition.item.definition!.sourceEstimateRevision}` : "Not required by this pinned Define contract"}</dd></div><div><dt>Discover offer source</dt><dd>{focusedDefinition.item.definition!.sourceProposalRevision ? `Proposal revision ${focusedDefinition.item.definition!.sourceProposalRevision}` : "Not required by this pinned Define contract"}</dd></div><div><dt>Configuration</dt><dd>{focusedDefinition.item.definition!.configurationWorkTypeKey ?? "unavailable"}@{focusedDefinition.item.definition!.configurationVersion ?? "unavailable"}</dd></div><div><dt>Other review</dt><dd>{focusedDefinition.item.definition!.reviews?.[focusedDefinition.role === "commercial" ? "delivery" : "commercial"] ?? "Unavailable"}</dd></div></dl><button className="d5o-primary" onClick={() => onReviewDefinition(focusedDefinition.item, focusedDefinition.role)}>Open {focusedDefinition.role} review in Define →</button><small className="d5o-prototype-authority-note">The review opens the exact Work Record and revision. Live identity, assignment, and approval-right enforcement are not connected.</small></> : <p>Select a submitted definition review.</p>}</aside></div>{loadMoreControl}
  </section>;

  return <section className="d5o-ops-mywork">
    <header className="d5o-ops-heading"><div><p>MY WORK · {currentOwner.toUpperCase()}</p><h1>Actions requiring attention</h1><span>Work you own and conditions waiting on configured decision profiles.</span></div><div className="d5o-ops-count"><strong>{counts?.mine ?? mine.length}</strong><span>Work Records you own</span></div></header>
    <nav className="d5o-ops-tabs" aria-label="Action filters"><button className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All actions <b>{counts?.total ?? actions.length}</b></button><button className={filter === "mine" ? "is-active" : ""} onClick={() => setFilter("mine")}>Work I own <b>{counts?.mine ?? mine.length}</b></button><button className={filter === "waiting" ? "is-active" : ""} onClick={() => setFilter("waiting")}>Other owners <b>{counts?.waiting ?? waiting.length}</b></button><button onClick={() => setFilter("pricing")}>Pricing reviews <b>{counts?.pricing ?? pricing.length}</b></button><button onClick={() => setFilter("proposal")}>Proposal approvals <b>{counts?.proposal ?? proposals.length}</b></button><button onClick={() => setFilter("definition")}>Definition reviews <b>{counts?.definition ?? definitionReviews.length}</b></button></nav>
    {hostedWorkspace ? <ServiceActionQueue workspace={hostedWorkspace} actions={page.serviceActions ?? []} /> : null}
    {hostedWorkspace ? <DeliveryActionQueue workspace={hostedWorkspace} actions={page.deliveryActions ?? []} /> : null}
    {hostedWorkspace ? <SupportActionQueue workspace={hostedWorkspace} actions={page.supportActions ?? []} /> : null}
    {hostedWorkspace && page.roleActions?.length ? <section className="d5o-ops-panel d5o-ops-action-list" aria-label="Available role decisions"><header><div><p>AVAILABLE TO YOUR ROLE</p><h2>Independent decisions</h2></div><span>{page.roleActions.length} pending</span></header>{page.roleActions.map((action,index) => <a key={`${action.kind}:${action.workId}:${action.packageId ?? ""}:${action.revision}:${index}`} href={`/work?workspace=${encodeURIComponent(hostedWorkspace)}&view=record&record=${encodeURIComponent(action.workId)}&section=${encodeURIComponent(action.phase)}${action.packageId ? `&package=${encodeURIComponent(action.packageId)}` : ""}${action.kind === "Billing review" ? "&focus=finance" : action.kind === "Design review" ? "&focus=reviews" : action.kind === "Field report review" ? "&focus=reports" : ""}`}><strong>{action.title}</strong><small> {action.kind} · Work {action.workId} · {action.packageId ? `package ${action.packageId} · ` : ""}revision {action.revision} · {action.status}{action.dueDate ? ` · due ${action.dueDate}` : ""}</small><span>Open {action.phase} →</span></a>)}</section> : null}
    <div className="d5o-ops-mywork-layout"><section className="d5o-ops-panel d5o-ops-action-list"><header><div><p>ACTION QUEUE</p><h2>{filter === "mine" ? "Work you own" : filter === "waiting" ? "Other owners" : "Workspace actions"}</h2></div><span>{shown.length} of {page?.total ?? 0} in view</span></header>{shown.length ? shown.map((item) => { const context = getDecisionContext(item); return <button key={item.id} className={focused?.id === item.id ? "is-selected" : ""} onClick={() => setFocusedId(item.id)}><span className={`d5o-ops-status is-${item.status}`} /><span><small>{item.stage} · Work owner: {item.owner}</small><strong>{context.decision}</strong><em>{item.title} · {item.customer}</em>{context.pinned ? <small className="d5o-mywork-configured">Decision profile: {context.profile}</small> : null}<small>{actionDueLabel(item.nextActionDue)} · {actionImpactLabel(item.nextActionImpact)}</small>{context.blockers[0] ? <b>{context.blockers[0]} · Open {context.target}</b> : null}</span><span className="d5o-ops-row-action">Details →</span></button>; }) : <p className="d5o-ops-empty">No actions in this view.</p>}</section>
      <aside className="d5o-ops-panel d5o-ops-action-detail">{focused && focusContext ? <><p>FOCUSED ACTION</p><h2>{focusContext.decision}</h2><span>{focused.title} · {focused.site}</span><dl><div><dt>Current position</dt><dd>{focused.stage}</dd></div><div><dt>{focusContext.pinned ? "Decision profile" : "Next responsible actor"}</dt><dd>{focusContext.profile}</dd></div><div><dt>Work Record owner</dt><dd>{focused.owner}</dd></div><div><dt>Due date</dt><dd>{actionDueLabel(focused.nextActionDue)}</dd></div><div><dt>Impact</dt><dd>{actionImpactLabel(focused.nextActionImpact)}</dd></div><div><dt>Current condition</dt><dd className={focusContext.blockers.length ? "is-held" : ""}>{focusContext.blockers[0] || "Requirements ready for review"}</dd></div><div><dt>Resolve or review in</dt><dd>{focusContext.target}</dd></div><div><dt>Proof in context</dt><dd>{focused.proof.length} linked reference{focused.proof.length === 1 ? "" : "s"}</dd></div><div><dt>Value at stake</dt><dd>{focused.value}</dd></div></dl><button className="d5o-primary" onClick={() => onOpen(focused)}>Open {focusContext.target} →</button><small className="d5o-prototype-authority-note">Owning a Work Record does not grant approval authority. The decision command checks your current membership.</small></> : <p>Select an action to see its context.</p>}</aside></div>{loadMoreControl}
  </section>;
}
