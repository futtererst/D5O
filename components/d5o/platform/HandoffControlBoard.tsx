"use client";

import { useState } from "react";
import type { WorkRecord } from "./work-types";
import { currentAcceptedRelease, currentReviewedCompletion, currentWorkAcceptanceScope, deployState } from "./deploy-model";
import { supportDocumentationPositions } from "./support-documentation";

type Filter = "all" | "blocked" | "review" | "accepted";
function position(work: WorkRecord) {
  const packages = work.packages ?? [];
  const state = deployState(work);
  const facts = packages.map((pkg) => {
    const accepted = currentAcceptedRelease(work, pkg.id);
    const release = accepted && accepted.packageRevision === work.design?.packages.find((p) => p.packageId === pkg.id)?.revision ? accepted : null;
    const turnover = release ? state.turnovers.find((t) => t.status === "Client accepted" && t.releaseIds.includes(release.id)) : undefined;
    const retainedCompletion = turnover?.completionId && state.completions?.find((c) => c.id === turnover.completionId &&
      c.packageId === pkg.id && c.releaseId === release?.id && c.packageRevision === release.packageRevision &&
      JSON.stringify([...c.reportIds].sort()) === JSON.stringify([...turnover.reportIds].sort()) &&
      JSON.stringify([...c.inspectionIds].sort()) === JSON.stringify([...turnover.inspectionIds].sort()));
    const completion = retainedCompletion || currentReviewedCompletion(work, pkg.id);
    return { pkg, release, completion, turnover };
  });
  const exact = currentWorkAcceptanceScope(work);
  const receipt = exact && facts.every((fact) => fact.turnover?.receipt === "Accepted") &&
    state.workAcceptance?.receipt === "Accepted";
  const historical = state.workAcceptance && !exact ? state.workAcceptance : null;
  const blocker = !packages.length ? "No current packages" : facts.some((f) => !f.release) ? "Current Design release or Deploy receipt missing"
    : facts.some((f) => !f.completion) ? "Reviewed completion or verification missing"
      : facts.some((f) => !f.turnover) ? "Scoped package customer acceptance missing"
        : !exact ? "Exact whole-work customer acceptance missing"
          : facts.some((f) => f.turnover?.receipt !== "Accepted") ? "Package Operations receipt pending"
            : !receipt ? "Whole-work Operations receipt pending" : null;
  return { facts, exact, receipt, historical, blocker,
    status: receipt ? "accepted" as const : historical || facts.some((f) => !f.release) ? "blocked" as const : "review" as const };
}
function linkedAssetPosition(item: WorkRecord, records: WorkRecord[]) {
  const link = item.operate?.assetLinks?.find((entry) => entry.status === "Accepted");
  if (!link) return null;
  const owner = records.find((record) => record.workspace === item.workspace && record.id === link.ownerWorkId);
  const asset = owner?.operate?.assets.find((entry) => entry.id === link.assetId);
  return { link, owner, asset };
}
function Fact({ yes, children }: { yes: boolean; children: React.ReactNode }) {
  return <span className={`d5o-proof-state ${yes ? "is-done" : ""}`}><b>{yes ? "✓" : "·"}</b>{children}</span>;
}
export function HandoffControlBoard({ workspaceName, work, onOpen }: { workspaceName: string; work: WorkRecord[]; onOpen: (item: WorkRecord, section: "Deploy" | "Operate") => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const rows = work.filter((item) => item.canonicalWorkId && ((item.packages?.length ?? 0) > 0 || !!item.deploy?.workAcceptance)).map((item) => ({ item, facts: position(item) }));
  const shown = rows.filter(({ facts }) => filter === "all" || facts.status === filter);
  return <section className="d5o-handoff-concept">
    <header><div><p>HANDOFF & LIFECYCLE · {workspaceName.toUpperCase()}</p><h1>Current scope and receiving responsibility</h1><span>Released packages, reviewed completion, customer acceptance and Operations receipt are separate decisions.</span></div><div className="d5o-handoff-summary"><article><strong>{rows.length}</strong><span>Current package sets</span></article><article><strong>{rows.filter(({ facts }) => facts.status === "blocked").length}</strong><span>Scope or release holds</span></article><article><strong>{rows.filter(({ facts }) => facts.receipt).length}</strong><span>Operations receipts</span></article></div></header>
    <section className="d5o-handoff-matrix"><header><div><p>CURRENT AUTHORITATIVE FACTS</p><h2>Acceptance cannot be inferred from progress</h2></div><div>{(["all", "blocked", "review", "accepted"] as const).map((option) => <button key={option} className={filter === option ? "is-active" : ""} onClick={() => setFilter(option)}>{option === "all" ? "All" : option === "review" ? "In review" : option === "accepted" ? "Delivery received" : "Blocked"}</button>)}</div></header><div className="d5o-handoff-matrix-scroll"><div className="d5o-handoff-matrix-head"><span>WORK / SCOPE</span><span>RELEASE / RECEIPT</span><span>VERIFIED COMPLETION</span><span>CUSTOMER ACCEPTANCE</span><span>OPERATIONS / NEXT ACTION</span></div>
      {shown.map(({ item, facts }) => <button key={item.id} onClick={() => onOpen(item, facts.receipt ? "Operate" : "Deploy")}><div><small>{item.customer} · {item.site}</small><strong>{item.title}</strong><em>{facts.facts.length} current packages</em></div><div><Fact yes={facts.facts.length > 0 && facts.facts.every((f) => !!f.release)}>{facts.facts.filter((f) => f.release).length}/{facts.facts.length} current releases</Fact><small>Accepted Design releases and Deploy receipts</small></div><div><Fact yes={facts.facts.length > 0 && facts.facts.every((f) => !!f.completion)}>{facts.facts.filter((f) => f.completion).length}/{facts.facts.length} reviewed completions</Fact><small>Required passing verification remains in the completion basis</small></div><div><Fact yes={facts.exact}>{facts.facts.filter((f) => f.turnover).length}/{facts.facts.length} scoped acceptances</Fact><small>{facts.exact ? "Exact whole-work acceptance retained" : facts.historical ? `Historical acceptance ${facts.historical.id} covers prior scope only` : "Whole-work acceptance pending"}</small></div><div><Fact yes={!!facts.receipt}>{facts.receipt ? "Operations received exact scope" : "Operations receipt pending"}</Fact><small>{facts.blocker ?? `Delivery receipt actor ${item.deploy?.workAcceptance?.receivedByActorId ?? "not recorded"}`}</small><small>Operate source: {item.operate?.source?.workAcceptanceId === item.deploy?.workAcceptance?.id ? `linked to exact receipt ${item.operate?.source?.workAcceptanceId}` : "not linked"}</small><small>Accepted support owner: {linkedAssetPosition(item, work) ? `${linkedAssetPosition(item, work)?.owner?.operate?.support?.owner ?? "not recorded"} · existing asset ${linkedAssetPosition(item, work)?.asset?.name ?? "unavailable"} · contribution accepted by ${linkedAssetPosition(item, work)?.link.acceptedByActorId}` : item.operate?.support?.ownerActorId ? `${item.operate.support.owner} · actor ${item.operate.support.ownerActorId}` : "not recorded"}</small><small>Support activation: {linkedAssetPosition(item, work) ? `Existing asset support: ${linkedAssetPosition(item, work)?.owner?.operate?.activation?.status ?? "not activated"}` : item.operate?.activation?.status ?? "not activated"}{item.operate?.activation?.actorId ? ` · actor ${item.operate.activation.actorId}` : ""}</small><small>Residual obligations: {item.deploy?.turnovers.some((turnover) => turnover.obligations.trim()) ? item.operate?.support?.residualOwner ? `assigned to ${item.operate.support.residualOwner}` : "owner not recorded" : "none recorded"}</small><small>Reviewed support documents: {supportDocumentationPositions(item).filter((entry) => entry.status === "Reviewed").length}/{supportDocumentationPositions(item).length}; {supportDocumentationPositions(item).some((entry) => entry.status !== "Reviewed") ? "assigned documentation remains outstanding" : "all identified documentation reviewed"}</small><small>Finance closeout and receivable collection remain separate.</small></div></button>)}
      {!shown.length ? <p className="d5o-empty-state">No current governed handoff matches this view.</p> : null}</div></section>
  </section>;
}
