"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const phases = ["Discover", "Define", "Design", "Develop", "Deploy", "Operate"] as const;
type Phase = typeof phases[number];
type PhaseDetail = { status: string; entryEvidence?: string | null;
  completionEvidence?: string | null; preparationEvidence?: string | null;
  supportStatus?: string; financialCloseout?: string };
type Projection = { currentPhase: Phase; configurationVersionId: string;
  phases: Record<Phase, PhaseDetail>; supportActive: boolean; financialCloseout: string };
type PhaseStatus = { status: string; projection?: Projection; projectionRevision?: number;
  replayMatches?: boolean; sourceEvent?: string; updatedAt?: string; reason?: string };
type WorkSummary = { id: string; title: string; customer?: string; site?: string;
  owner?: string; type?: string; phaseConfigurationVersionId?: string };
type WorkDetail = WorkSummary & { canonicalWorkId: string; workspace: string;
  definition?: { status?: string }; develop?: { review?: { status?: string } };
  design?: { authorityRevision?: number; packages?: Array<{ packageId: string; name?: string }>;
    releases?: Array<{ packageId: string; status: string }> };
  deploy?: { authorityRevision?: number; workAcceptance?: { receipt?: string; id?: string;
    revision?: number } }; operate?: { authorityRevision?: number;
    source?: { workAcceptanceId?: string }; support?: { status?: string };
    activation?: { status?: string }; finance?: { status?: string } } };
type ListResponse = { workspaceName: string; role: string; records: WorkSummary[]; error?: string };
type DetailResponse = { workspaceName: string; role: string; canEdit: boolean;
  revision: number; record: WorkDetail; phaseStatus: PhaseStatus; error?: string };

const statusLabel: Record<string, string> = {
  not_started: "Not started", preparation_in_progress: "Preparation in progress",
  ready_to_enter: "Ready to enter", active: "Active", blocked: "Blocked",
  completed: "Completed"
};
function titleFor(phase: Phase) {
  return ({ Discover: "Customer need and qualification", Define: "Scope and risk",
    Design: "Package and acceptance", Develop: "Solution and resource readiness",
    Deploy: "Field execution and customer acceptance", Operate: "Support and closeout" })[phase];
}
function readableError(value: string) { return value.replaceAll("_", " "); }
function evidenceLabel(value?: string | null) {
  if (!value) return "Awaiting prerequisite";
  const [kind, reference] = value.split(":", 2);
  const names: Record<string, string> = {
    work_created: "Work created", pursuit_handoff: "Intake handoff",
    define_handoff: "Scope approved and handed off",
    design_handoff: "Design handoff accepted",
    accepted_releases: "Package release accepted",
    selected_solution: "Solution selected", field_start: "Field start authorized",
    work_acceptance: "Customer Work acceptance"
  };
  return `${names[kind] ?? readableError(kind)}${reference && kind !== "work_created" ? ` · decision ${reference}` : ""}`;
}

export function CustomerWorkExperience({ workspace, initialWorkId }: {
  workspace: string; initialWorkId: string;
}) {
  const [list, setList] = useState<ListResponse | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const selected = initialWorkId;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const base = `/api/d5o-hosted/customer-work?workspace=${encodeURIComponent(workspace)}`;
      const [listResponse, detailResponse] = await Promise.all([
        fetch(base, { cache: "no-store", signal }),
        selected ? fetch(`${base}&workId=${encodeURIComponent(selected)}`, { cache: "no-store", signal })
          : Promise.resolve(null)
      ]);
      const nextList = await listResponse.json() as ListResponse;
      if (!listResponse.ok) throw Error(nextList.error ?? "Work directory unavailable");
      setList(nextList);
      if (detailResponse) {
        const nextDetail = await detailResponse.json() as DetailResponse;
        if (!detailResponse.ok) throw Error(nextDetail.error ?? "Work unavailable");
        setDetail(nextDetail);
      } else setDetail(null);
    } catch (cause) {
      if (!signal?.aborted) setError(readableError(cause instanceof Error ? cause.message : "Work unavailable"));
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [workspace, selected]);
  useEffect(() => { const controller = new AbortController();
    const timer = setTimeout(() => { void load(controller.signal); }, 0);
    return () => { clearTimeout(timer); controller.abort(); }; }, [load]);
  const projection = detail?.phaseStatus?.projection;
  const role = detail?.role ?? list?.role ?? "";
  const canOperate = role === "operations_leader" && detail?.canEdit;
  async function command(action: string, input: Record<string, unknown>) {
    if (!detail || busy) return;
    setBusy(true); setError("");
    try {
      const source = detail.revision;
      const args: Record<string, unknown> = { p_action: action, p_input: input,
        p_expected_source_revision: source,
        p_expected_deploy_revision: detail.record.deploy?.authorityRevision ?? 0,
        p_expected_operate_revision: detail.record.operate?.authorityRevision ?? 0 };
      const response = await fetch(`/api/d5o-hosted/customer-work?workspace=${encodeURIComponent(workspace)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workId: detail.record.id, command: "operate",
          commandId: crypto.randomUUID(), arguments: args }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw Error(result.error ?? "Decision was not recorded");
      await load();
    } catch (cause) { setError(readableError(cause instanceof Error ? cause.message : "Decision failed")); }
    finally { setBusy(false); }
  }
  return <section className="d5o-customer-work-content">
    <aside className="d5o-customer-work-list"><div><strong>{list?.workspaceName ?? workspace}</strong>
      <small>{role.replaceAll("_", " ") || "Loading access"}</small></div>
      <h2>Work records</h2>{list?.records.length ? <ul>{list.records.map((work) =>
        <li key={work.id}><Link aria-current={selected === work.id ? "page" : undefined}
          href={`/work/customer/${encodeURIComponent(workspace)}?work=${encodeURIComponent(work.id)}`}>{work.title}
          <small>{work.type ?? "Work"} · {work.customer ?? "Customer pending"}</small></Link></li>)}</ul>
      : !loading && !error ? <p>No connected Work yet. Create the first Work record to begin.</p> : null}</aside>
    <div className="d5o-customer-work-main">
      {loading && <p role="status">Loading current Work and phase decisions…</p>}
      {error && <p className="d5o-customer-work-error" role="alert">{error}</p>}
      {!loading && !detail && <section className="d5o-customer-work-empty"><h2>Select Work</h2>
        <p>Open a Work record to review its six-phase progress and authoritative decisions.</p>
        {["admin", "project_manager"].includes(role) &&
          <Link href={`/work/connected-work?workspace=${encodeURIComponent(workspace)}`}>Create connected Work</Link>}</section>}
      {detail && <><header className="d5o-customer-work-title"><p>{detail.workspaceName} / {detail.record.type}</p>
        <h2>{detail.record.title}</h2><span>{detail.record.customer} · {detail.record.site}</span>
        <dl><div><dt>Owner</dt><dd>{detail.record.owner}</dd></div>
          <div><dt>Current phase</dt><dd>{projection?.currentPhase ?? "Unresolved"}</dd></div>
          <div><dt>Configuration version</dt><dd>{detail.record.phaseConfigurationVersionId?.slice(0, 8) ?? "Unavailable"}</dd></div>
          <div><dt>Support</dt><dd>{projection?.supportActive ? "Active" : "Pending"}</dd></div>
          <div><dt>Financial closeout</dt><dd>{projection?.financialCloseout ?? "Pending"}</dd></div></dl>
      </header>
      {detail.phaseStatus.status === "unresolved" && <p role="status">Historical phase position needs reconciliation. No completion has been inferred.</p>}
      {projection && <><nav className="d5o-customer-phase-nav" aria-label="Work phases">{phases.map((phase) =>
        <a key={phase} href={`#phase-${phase.toLowerCase()}`} aria-current={projection.currentPhase === phase ? "step" : undefined}>
          <strong>{phase}</strong><small>{statusLabel[projection.phases[phase].status] ?? "Unresolved"}</small></a>)}</nav>
        {!detail.phaseStatus.replayMatches && <p className="d5o-customer-work-error" role="alert">Phase status differs from its authoritative replay. Decisions are unavailable until reconciled.</p>}
        {phases.map((phase) => { const status = projection.phases[phase]; return <section className="d5o-customer-phase" key={phase} id={`phase-${phase.toLowerCase()}`}>
          <header><div><p>{phase.toUpperCase()}</p><h3>{titleFor(phase)}</h3></div><span>{statusLabel[status.status] ?? status.status}</span></header>
          <dl><div><dt>Entry basis</dt><dd title={status.entryEvidence ?? undefined}>{evidenceLabel(status.entryEvidence)}</dd></div>
            <div><dt>Completion basis</dt><dd title={status.completionEvidence ?? undefined}>{status.completionEvidence ? evidenceLabel(status.completionEvidence) : "Pending"}</dd></div>
            {status.preparationEvidence && <div><dt>Preparation</dt><dd title={status.preparationEvidence}>{evidenceLabel(status.preparationEvidence)}; this does not complete Develop.</dd></div>}</dl>
          {phase === "Define" && <p>Scope status: {detail.record.definition?.status ?? "Not submitted"}.</p>}
          {phase === "Design" && <p>{detail.record.design?.packages?.length ?? 0} package(s); {detail.record.design?.releases?.filter((item) => item.status === "Accepted").length ?? 0} accepted release(s).</p>}
          {phase === "Deploy" && <p>Whole-Work customer acceptance: {detail.record.deploy?.workAcceptance?.receipt ?? "Pending"}.</p>}
          {phase === "Operate" && <p>Support {status.supportStatus ?? "Pending"}; financial closeout {status.financialCloseout ?? "Pending"}.</p>}
          {canOperate && detail.phaseStatus.replayMatches && phase === "Operate" && status.status === "active" &&
            detail.record.deploy?.workAcceptance?.receipt === "Accepted" &&
            <div className="d5o-customer-actions">
              {!detail.record.operate?.source?.workAcceptanceId &&
                <button disabled={busy} onClick={() => void command("receive-handoff", {
                  workAcceptanceId: detail.record.deploy?.workAcceptance?.id,
                  workAcceptanceRevision: detail.record.deploy?.workAcceptance?.revision,
                  note: "Operations receives accepted Work" })}>Receive accepted handoff</button>}
              {detail.record.operate?.support?.status === "Accepted" &&
                detail.record.operate?.activation?.status !== "Active" &&
                <button disabled={busy} onClick={() => void command("activate", {
                  note: "Support ownership and documentation reviewed" })}>Activate accepted support</button>}
            </div>}
        </section>; })}
        <footer className="d5o-customer-work-audit">Status revision {detail.phaseStatus.projectionRevision ?? "unresolved"} · Last authoritative event {detail.phaseStatus.sourceEvent ?? "historical reconciliation"} · Replay {detail.phaseStatus.replayMatches ? "matched" : "unavailable"}</footer>
      </>}</>}
    </div>
  </section>;
}
