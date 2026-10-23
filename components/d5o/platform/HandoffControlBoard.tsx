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
    <section className="d5o-handoff-matrix"><header><div><p>CURRENT AUTHORITATIVE FACTS</p><h2>Delivery and support are separate decisions</h2></div><div>{(["all", "blocked", "review", "accepted"] as const).map((option) => <button key={option} className={filter === option ? "is-active" : ""} onClick={() => setFilter(option)}>{option === "all" ? "All" : option === "review" ? "In review" : option === "accepted" ? "Delivery received" : "Blocked"}</button>)}</div></header>
      <div className="d5o-handoff-list">
        {shown.map(({ item, facts }) => {
          const linked = linkedAssetPosition(item, work);
          const support = linked?.owner?.operate ?? item.operate;
          const documents = supportDocumentationPositions(item);
          return <article className="d5o-handoff-item" key={item.id}>
            <button className="d5o-handoff-item-main" type="button" onClick={() => onOpen(item, facts.receipt ? "Operate" : "Deploy")}>
              <span className="d5o-handoff-identity"><small>{item.customer} · {item.site}</small><strong>{item.title}</strong><em>{facts.facts.length} current package{facts.facts.length === 1 ? "" : "s"}</em></span>
              <span><small>Design release</small><Fact yes={facts.facts.length > 0 && facts.facts.every((f) => !!f.release)}>{facts.facts.filter((f) => f.release).length}/{facts.facts.length} current</Fact></span>
              <span><small>Reviewed completion</small><Fact yes={facts.facts.length > 0 && facts.facts.every((f) => !!f.completion)}>{facts.facts.filter((f) => f.completion).length}/{facts.facts.length} packages</Fact></span>
              <span><small>Customer acceptance</small><Fact yes={facts.exact}>{facts.exact ? "Exact scope accepted" : facts.historical ? "Prior scope only" : "Pending"}</Fact></span>
              <span><small>Operations receipt</small><Fact yes={!!facts.receipt}>{facts.receipt ? "Received" : "Pending"}</Fact></span>
              <span className="d5o-handoff-next"><small>Next condition</small><strong>{facts.blocker ?? (support?.activation?.status === "Active" ? "Support active" : "Review support responsibility")}</strong></span>
            </button>
            <details className="d5o-handoff-item-detail"><summary>Support position and decision history</summary><div>
              <p>Scoped package acceptances: {facts.facts.filter((f) => f.turnover).length}/{facts.facts.length}. {facts.historical ? `Historical whole-work acceptance ${facts.historical.id} covers prior scope only.` : ""}</p>
              <p>Delivery receipt actor: {item.deploy?.workAcceptance?.receivedByActorId ?? "not recorded"}. Operate source: {item.operate?.source?.workAcceptanceId === item.deploy?.workAcceptance?.id ? `linked to receipt ${item.operate?.source?.workAcceptanceId}` : "not linked"}.</p>
              <p>Accepted support owner: {support?.support?.owner ?? "not recorded"}{support?.support?.ownerActorId ? ` · actor ${support.support.ownerActorId}` : ""}. Support activation: {support?.activation?.status ?? "not activated"}{support?.activation?.actorId ? ` · actor ${support.activation.actorId}` : ""}.</p>
              {linked ? <p>Existing supported asset: {linked.asset?.name ?? "unavailable"} · contribution accepted by {linked.link.acceptedByActorId} on source Work {linked.owner?.title ?? linked.link.ownerWorkId}.</p> : null}
              <p>Residual obligations: {item.deploy?.turnovers.some((turnover) => turnover.obligations.trim()) ? item.operate?.support?.residualOwner ? `assigned to ${item.operate.support.residualOwner}` : "owner not recorded" : "none recorded"}. Reviewed support documents: {documents.filter((entry) => entry.status === "Reviewed").length}/{documents.length}.</p>
              <p>Finance closeout and receivable collection remain separate.</p>
            </div></details>
          </article>;
        })}
        {!shown.length ? <p className="d5o-empty-state">No current governed handoff matches this view.</p> : null}
      </div>
    </section>
  </section>;
}
