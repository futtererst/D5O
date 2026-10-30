"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CustomerDefineDraftForm } from "./CustomerDefineDraftForm";
import { CustomerDesignActions } from "./CustomerDesignActions";
import { FieldChangeControl } from "@/components/d5o/platform/FieldChangeControl";
import { CustomerDevelopActions } from "./CustomerDevelopActions";
import { CustomerDevelopAuthority } from "./CustomerDevelopAuthority";
import { CustomerServiceActions } from "./CustomerServiceActions";
import { CustomerOperateActions } from "./CustomerOperateActions";
import { PursuitControl } from "@/components/d5o/platform/PursuitControl";
import { DevelopPlanning } from "@/components/d5o/platform/DevelopPlanning";
import { CustomerCommercialActions } from "./CustomerCommercialActions";
import type { PursuitCommand } from "@/components/d5o/platform/pursuit-control";
import type { CommercialCommand } from "@/lib/d5o/prototype-work/commercial-command";
import type { WorkspaceKey } from "@/components/d5o/platform/work-types";
import type { OperateCommand } from "@/lib/d5o/prototype-work/operate-command";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import type { CustomerDesignAction } from "@/lib/d5o/hosted/customer-design-contract";
import type { DefineDraftInput } from "@/lib/d5o/hosted/customer-define-draft";

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
type CustomerTask = { id: string; workId: string; title: string; phase: string;
  status: "available" | "view_only"; revision: number; packageId?: string;
  releaseId?: string; dueDate?: string; action?: string; reviewRole?: string;
  decisionId?: string; sourceRevision?: number };
type WorkDetail = WorkSummary & { canonicalWorkId: string; workspace: string;
  discovery?: { outcome?: string; pursuitControl?: {revision?:number};
    proposal?: { package?: { revision?: number } };
    designHandoff?: { status?: string; revision?: number; authorityRevision?: number;
      submittedByActorId?: string } };
  definition?: { status?: string; authorityRevision?: number;
    scopeControl?: { requirements?: Array<{ id: string; state?: string; description?: string }> };
    reviews?: { commercial?: string; delivery?: string };
    developHandoff?: { status?: string } }; develop?: { review?: { status?: string } };
  design?: { authorityRevision?: number; packages?: Array<{ packageId: string; name?: string; method?: string; revision?: number }>;
    documents?: Array<{ id: string; revision: number; title: string; status: string; evidenceId?: string; packageIds?: string[] }>;
    reviews?: Array<{ id: string; packageId: string; discipline: string; status: string }>;
    releases?: Array<{ id: string; packageId: string; status: string }>;
    changes?: Array<{ id: string; packageId: string; source: string; openedRevision: number; status: string }> };
  deploy?: { authorityRevision?: number; workAcceptance?: { receipt?: string; id?: string;
    revision?: number } }; operate?: { authorityRevision?: number;
    source?: { workAcceptanceId?: string }; support?: { status?: string };
    activation?: { status?: string }; finance?: { status?: string } } };
type ListResponse = { workspaceName: string; role: string; records: WorkSummary[];
  tasks: CustomerTask[]; error?: string };
type DetailResponse = { workspaceName: string; role: string; actorId: string; actorName: string;
  canEdit: boolean;
  revision: number; catalogRevision: number; record: WorkDetail; phaseStatus: PhaseStatus;
  operatePolicy: { requireDocumentationReview: boolean } | null;
  connectedPackages: Array<{ packageId: string; name?: string }>;
  defineActions: CustomerTask[]; designActions: CustomerTask[]; error?: string };

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

export function CustomerWorkExperience({ workspace, initialWorkId, initialTaskId }: {
  workspace: string; initialWorkId: string; initialTaskId: string;
}) {
  const [list, setList] = useState<ListResponse | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const selected = initialWorkId;
  const linkedTask = initialTaskId && list?.tasks.find((task) =>
    task.id === initialTaskId && task.workId === selected);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [designNote, setDesignNote] = useState("");
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
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener("hashchange", refresh);
    return () => window.removeEventListener("hashchange", refresh);
  }, [load]);
  const projection = detail?.phaseStatus?.projection;
  const role = detail?.role ?? list?.role ?? "";
  async function postAction(endpoint: string, payload: Record<string, unknown>, fallback: string) {
    if (!detail || busy) return false;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${endpoint}?workspace=${encodeURIComponent(workspace)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workId: detail.record.id, commandId: crypto.randomUUID(), ...payload }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw Error(result.error ?? fallback);
      await load();
      return true;
    } catch (cause) {
      setError(readableError(cause instanceof Error ? cause.message : fallback));
      return false;
    } finally { setBusy(false); }
  }
  async function executePursuit(workId:string,command:PursuitCommand):Promise<boolean> {
    if(!detail || busy || detail.record.id!==workId || !detail.phaseStatus.replayMatches)return false;
    const intent=command.kind==="save"?{...command.fields,...command.workFields}
      :command.kind==="decide"||command.kind==="respond-handoff"
        ?{outcome:command.outcome,reason:command.reason}
        :command.kind==="submit-handoff"?{brief:command.brief}:{};
    if(command.kind==="request-spend"||command.kind==="decide-spend"){
      setError("Pursuit spend requires its separate authority path.");return false;
    }
    setBusy(true);setError("");
    try {
      const response=await fetch(`/api/d5o-hosted/prototype-pursuit-command?workspace=${encodeURIComponent(workspace)}`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({workId,action:command.kind==="save"?"save-intake":command.kind,
          intent,commandId:crypto.randomUUID(),expectedRevision:detail.revision,
          expectedDecisionRevision:detail.record.discovery?.pursuitControl?.revision??0})});
      const body=await response.json() as {error?:string;message?:string};
      if(!response.ok)throw Error(body.message??body.error??"Discover decision unavailable");
      await load();return true;
    }catch(cause){setError(readableError(cause instanceof Error?cause.message:"Discover decision unavailable"));
      return false;
    }finally{setBusy(false);}
  }
  async function saveCommercialDraft(workId:string,transform:(current:WorkRecord)=>WorkRecord) {
    if(!detail || busy || detail.record.id!==workId)return;
    setBusy(true);setError("");
    try {
      const endpoint=`/api/d5o-hosted/prototype-state?workspace=${encodeURIComponent(workspace)}&key=work`;
      const read=await fetch(endpoint,{cache:"no-store"});
      const loaded=await read.json() as {revision:number;state:{records:WorkRecord[]};error?:string};
      if(!read.ok || !loaded.state?.records)throw Error(loaded.error??"Work draft unavailable");
      const index=loaded.state.records.findIndex((item)=>item.id===workId);
      if(index<0)throw Error("Work unavailable");
      const records=loaded.state.records.map((item,position)=>position===index?transform(item):item);
      const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({workspace,key:"work",expectedRevision:loaded.revision,
          state:{...loaded.state,records}})});
      const body=await response.json() as {error?:string};
      if(!response.ok)throw Error(body.error??"Work draft was not saved");
      await load();
    }catch(cause){setError(readableError(cause instanceof Error?cause.message:"Work draft was not saved"));}
    finally{setBusy(false);}
  }
  async function executeCommercial(command:Omit<CommercialCommand,"expectedRevision">):Promise<boolean> {
    if(!detail || busy || detail.record.id!==command.workId)return false;
    const work=detail.record as unknown as WorkRecord;
    const decisionRevision=command.action.endsWith("solution")
      ? work.develop?.authorityRevision??0
      :["save-detailed-estimate","submit-pricing","approve-pricing","return-pricing"].includes(command.action)
        ? (work.discovery?.estimate as {authorityRevision?:number}|undefined)?.authorityRevision??0
        :["submit-design-handoff","accept-design-handoff","return-design-handoff"].includes(command.action)
          ? (work.discovery?.designHandoff as {authorityRevision?:number}|undefined)?.authorityRevision??0
          :(work.discovery?.proposal as {authorityRevision?:number}|undefined)?.authorityRevision??0;
    setBusy(true);setError("");
    try {
      const response=await fetch(`/api/d5o-hosted/prototype-commercial-command?workspace=${encodeURIComponent(workspace)}`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...command,expectedRevision:detail.revision,
          expectedDecisionRevision:decisionRevision,commandId:crypto.randomUUID()})});
      const body=await response.json() as {error?:string;message?:string};
      if(!response.ok)throw Error(body.message??body.error??"Commercial decision unavailable");
      await load();return true;
    }catch(cause){setError(readableError(cause instanceof Error?cause.message:"Commercial decision unavailable"));
      return false;
    }finally{setBusy(false);}
  }
  async function saveInitialOffer(input:NonNullable<CommercialCommand["offerInput"]>) {
    if(!detail || busy)return;
    await saveCommercialDraft(detail.record.id,(work)=>{
      const discovery=work.discovery;
      const estimate=discovery?.estimate;
      const proposal=discovery?.proposal;
      if(!discovery || !estimate?.detailed || estimate.status!=="Approved" ||
        !proposal || proposal.package || proposal.status!=="Not started")return work;
      const now=new Date().toISOString();
      const offer={revision:1,estimateRevision:estimate.revision,
        scope:input.scope,assumptions:input.assumptions,exclusions:input.exclusions,
        commercialTerms:input.commercialTerms,sellPrice:estimate.sellPrice,
        preparedAt:now,definitionSource:estimate.definitionSource,
        pricingBasis:{policyId:estimate.detailed.evaluation.policyId,
          policyVersion:estimate.detailed.evaluation.policyVersion,
          solutionRevision:estimate.detailed.input.solutionRevision,
          currency:estimate.detailed.input.currency,
          includedCostMinor:estimate.detailed.evaluation.includedCostMinor,
          priceMinor:estimate.detailed.evaluation.proposedPriceMinor}};
      return {...work,nextAction:"Complete proposal revision 1",
        discovery:{...discovery,phase:"Proposal",proposal:{...proposal,status:"Draft",package:offer,
          packageHistory:[offer],history:[...(proposal.history??[]),
            {revision:1,state:"Draft saved",at:now,
              note:`Bound to approved estimate revision ${estimate.revision}`}]}}};
    });
  }
  async function saveDefineDraft(fields: DefineDraftInput) {
    if (!detail || busy) return;
    await postAction("/api/d5o-hosted/customer-work", { command: "define-draft",
      arguments: { p_expected_source_revision: detail.revision, fields } }, "Define draft could not be saved");
  }
  async function command(action: string, input: Record<string, unknown>, domain: "define" | "operate" = "operate") {
    if (!detail || busy) return;
    const source = detail.revision;
    const args: Record<string, unknown> = domain === "define"
        ? { p_action: action, p_review_role: input.role ?? null,
          p_reason: reason.trim(), p_expected_source_revision: source,
          p_expected_decision_revision: detail.record.definition?.authorityRevision ?? 0 }
        : { p_action: action, p_input: input, p_expected_source_revision: source,
          p_expected_deploy_revision: detail.record.deploy?.authorityRevision ?? 0,
          p_expected_operate_revision: detail.record.operate?.authorityRevision ?? 0 };
    if (await postAction("/api/d5o-hosted/customer-work", { command: domain, arguments: args },
      "Decision was not recorded")) setReason("");
  }
  async function executeOperate(intent: Omit<OperateCommand, "workId" | "expectedRevision" | "commandId">) {
    if (!detail || busy || !detail.phaseStatus.replayMatches) return false;
    return postAction("/api/d5o-hosted/prototype-operate-command", {
      ...intent, expectedRevision: detail.revision,
      expectedDeployRevision: detail.record.deploy?.authorityRevision ?? 0,
      expectedDecisionRevision: detail.record.operate?.authorityRevision ?? 0
    }, "Operate decision was not recorded");
  }
  async function respondDesignReceipt(releaseId: string, responseValue: "Accepted" | "Returned") {
    if (!detail || busy || designNote.trim().length < 15) return;
    if (await postAction("/api/d5o-hosted/customer-work", { command: "design-receipt",
      arguments: {
            p_action: "respond-receipt",
            p_input: { releaseId, response: responseValue, note: designNote.trim() },
            p_expected_source_revision: detail.revision,
            p_expected_decision_revision: detail.record.design?.authorityRevision ?? 0 } },
      "Package receipt could not be recorded")) setDesignNote("");
  }
  async function executeDesign(action: CustomerDesignAction, input: Record<string, unknown>) {
    if (!detail || busy) return;
    await postAction("/api/d5o-hosted/customer-design-action", { action, input,
          sourceRevision: detail.revision,
          catalogRevision: detail.catalogRevision,
          packageCount: detail.connectedPackages?.length ?? 0,
          handoffRevision: (detail.record.discovery?.designHandoff?.revision ?? 0) +
            (action === "submit-handoff" ? 1 : 0),
          handoffDecisionRevision: detail.record.discovery?.designHandoff?.authorityRevision ?? 0,
          designRevision: detail.record.design?.authorityRevision ?? 0 },
      "Design action could not be recorded");
  }
  return <section className="d5o-customer-work-content">
    <aside className="d5o-customer-work-list"><div><strong>{list?.workspaceName ?? workspace}</strong>
      <small>{role.replaceAll("_", " ") || "Loading access"}</small></div>
      <h2>My Work</h2>{list?.tasks?.length ? <ul>{list.tasks.map((task) => {
        const work = list.records.find((item) => item.id === task.workId);
        const deployLink = task.id.startsWith("field-change:") && task.phase === "Deploy"
          ? `/work/customer/${encodeURIComponent(workspace)}/deploy?workId=${encodeURIComponent(task.workId)}&package=${encodeURIComponent(task.packageId ?? "")}`
          : task.phase === "Deploy" && task.action
          ? `/work/customer/${encodeURIComponent(workspace)}/deploy?workId=${encodeURIComponent(task.workId)}&package=${encodeURIComponent(task.packageId ?? "")}&focus=${encodeURIComponent(task.action)}&decision=${encodeURIComponent(task.decisionId ?? "")}&release=${encodeURIComponent(task.releaseId ?? "")}&sourceRevision=${task.sourceRevision ?? 0}&decisionRevision=${task.revision}`
          : null;
        const operateLink = task.phase === "Operate" && task.action
          ? `/work/customer/${encodeURIComponent(workspace)}?work=${encodeURIComponent(task.workId)}#phase-operate`
          : null;
        const label = <>{task.title}<small>{task.phase} · {work?.title ?? "Work"} · {work?.customer ?? "Customer pending"} · {task.status === "view_only" ? "View context" : "Ready for decision"}{task.dueDate ? ` · Due ${task.dueDate}` : ""}</small></>;
        return <li key={task.id}>{deployLink ? <a href={deployLink}>{label}</a>
          : operateLink ? <Link href={operateLink}>{label}</Link>
          : <Link href={`/work/customer/${encodeURIComponent(workspace)}?work=${encodeURIComponent(task.workId)}&task=${encodeURIComponent(task.id)}#phase-${task.phase.toLowerCase()}`}>{label}</Link>}</li>;
      })}</ul> : !loading && !error ? <p>No current responsibilities for your role. Refresh after a business decision.</p> : null}
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
      {initialTaskId && !loading && (linkedTask
        ? <p role="status">Assigned responsibility: {linkedTask.title} · {linkedTask.phase} · {linkedTask.status === "available" ? "Ready for decision" : "View context"}</p>
        : <p role="alert">This responsibility is no longer available. Review current My Work before deciding.</p>)}
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
          {phase === "Discover" && <PursuitControl key={`${detail.record.id}:${detail.revision}`}
            work={detail.record as unknown as WorkRecord} actor={detail.actorName}
            canEdit={detail.canEdit || ["billing_commercial_lead","business_development_lead"].includes(role)}
            connected onCommand={executePursuit} onUpdate={()=>{}} onNotice={setError}
            onDefine={()=>document.getElementById("phase-define")?.scrollIntoView()} />}
          {phase === "Define" && <><p>Scope status: {detail.record.definition?.status ?? "Not submitted"}.</p>
            {detail.phaseStatus.replayMatches && detail.defineActions.some((item) => item.action === "submit") &&
              <CustomerDefineDraftForm key={`${detail.record.id}:${detail.revision}`} busy={busy}
                draft={detail.record.definition as Record<string, unknown> | undefined}
                onSave={saveDefineDraft} />}
            {detail.phaseStatus.replayMatches && detail.defineActions.length > 0 &&
              ["admin", "project_manager", "operations_leader", "billing_commercial_lead"].includes(role) &&
              <div className="d5o-customer-actions">
                <label htmlFor="define-decision-reason">Decision reason</label>
                <input id="define-decision-reason" value={reason} onChange={(event) => setReason(event.target.value)}
                  maxLength={500} placeholder="Explain the decision" />
                {detail.record.definition?.status === "Draft" && detail.defineActions.some((item) => item.action === "submit") &&
                  <button disabled={busy || !reason.trim()} onClick={() => void command("submit", {}, "define")}>Request commercial and delivery review</button>}
                {detail.defineActions?.some((item) => item.action === "approve-review" && item.reviewRole === "commercial") &&
                  <><button disabled={busy || !reason.trim()} onClick={() => void command("approve-review", { role: "commercial" }, "define")}>Approve commercial review</button>
                  <button disabled={busy || !reason.trim()} onClick={() => void command("return-review", { role: "commercial" }, "define")}>Return commercial review</button></>}
                {detail.defineActions?.some((item) => item.action === "approve-review" && item.reviewRole === "delivery") &&
                  <><button disabled={busy || !reason.trim()} onClick={() => void command("approve-review", { role: "delivery" }, "define")}>Approve delivery review</button>
                  <button disabled={busy || !reason.trim()} onClick={() => void command("return-review", { role: "delivery" }, "define")}>Return delivery review</button></>}
                {detail.defineActions?.some((item) => item.action === "submit-handoff" || item.action === "accept-handoff") &&
                  <button disabled={busy || !reason.trim()} onClick={() => void command(
                    detail.record.definition?.developHandoff?.status === "submitted" ? "accept-handoff" : "submit-handoff", {}, "define")}>{detail.record.definition?.developHandoff?.status === "submitted" ? "Receive approved scope" : "Send approved scope"}</button>}
              </div>}</>}
          {phase === "Design" && <><p>{detail.record.design?.packages?.length ?? 0} package(s); {detail.record.design?.releases?.filter((item) => item.status === "Accepted").length ?? 0} accepted release(s).</p>
            {detail.phaseStatus.replayMatches && <CustomerDesignActions workspace={workspace}
              work={detail.record} connectedPackages={detail.connectedPackages ?? []}
              role={role} busy={busy} onAction={executeDesign} />}
            {detail.phaseStatus.replayMatches && detail.designActions?.length > 0 &&
              <div className="d5o-customer-actions"><label htmlFor="design-receipt-note">Package receipt reason</label>
                <input id="design-receipt-note" value={designNote} onChange={(event) => setDesignNote(event.target.value)}
                  minLength={15} maxLength={500} placeholder="Explain the independent receipt decision" />
                {detail.designActions.map((task) => <div className="d5o-customer-design-receipt" key={task.id}>
                  <p>Released package: {detail.record.design?.packages?.find((item) => item.packageId === task.packageId)?.name ?? "Design package"}</p>
                  <button disabled={busy || designNote.trim().length < 15} onClick={() => void respondDesignReceipt(task.releaseId ?? "", "Accepted")}>Accept released package</button>
                  <button disabled={busy || designNote.trim().length < 15} onClick={() => void respondDesignReceipt(task.releaseId ?? "", "Returned")}>Return released package</button>
                </div>)}</div>}</>}
          {phase === "Develop" && detail.phaseStatus.replayMatches &&
            <><DevelopPlanning key={`${detail.record.id}:${detail.revision}`}
              work={detail.record as unknown as WorkRecord} workspace={workspace as WorkspaceKey}
              canEdit={detail.canEdit} hosted onUpdate={(id,transform)=>{void saveCommercialDraft(id,transform);}}
              onCommercialCommand={executeCommercial} onNotice={setError}
              onDefine={()=>document.getElementById("phase-define")?.scrollIntoView()}
              onPeople={()=>document.getElementById("phase-develop")?.scrollIntoView()} />
            <CustomerDevelopAuthority workspace={workspace} workId={detail.record.id} role={role}
              onChanged={() => load()} />
            <CustomerDevelopActions workspace={workspace} workId={detail.record.id} role={role}
              onChanged={() => load()} />
            {detail.record.design?.releases?.filter((release) => release.status === "Accepted")
              .map((release) => <FieldChangeControl key={release.id} mode="commercial"
                workspace={workspace} workId={detail.record.id} packageId={release.packageId}
                releaseId={release.id} reports={[]} evidence={[]} onRecordChanged={() => void load()} />)}
            <CustomerCommercialActions work={detail.record as unknown as WorkRecord}
              role={role} busy={busy} onCommand={executeCommercial}
              onSaveInitialOffer={saveInitialOffer} /></>}
          {phase === "Deploy" && <><p>Whole-Work customer acceptance: {detail.record.deploy?.workAcceptance?.receipt ?? "Pending"}.</p>
            {detail.phaseStatus.replayMatches && ["admin", "project_manager", "field_supervisor", "operations_leader"].includes(role) &&
              <Link href={`/work/customer/${encodeURIComponent(workspace)}/deploy?workId=${encodeURIComponent(detail.record.id)}`}>Open Deploy decisions and evidence</Link>}</>}
          {phase === "Operate" && <><p>Support {status.supportStatus ?? "Pending"}; financial closeout {status.financialCloseout ?? "Pending"}.</p>
            {detail.phaseStatus.replayMatches &&
              <CustomerOperateActions work={detail.record as unknown as WorkRecord}
                role={role} actorId={detail.actorId} policy={detail.operatePolicy} busy={busy} onCommand={executeOperate} />}
            {detail.phaseStatus.replayMatches && detail.record.operate?.activation?.status === "Active" &&
              <CustomerServiceActions work={detail.record as unknown as WorkRecord}
                sourceRevision={detail.revision} role={role} onChanged={() => load()} />}</>}
        </section>; })}
        <footer className="d5o-customer-work-audit">Status revision {detail.phaseStatus.projectionRevision ?? "unresolved"} · Last authoritative event {detail.phaseStatus.sourceEvent ?? "historical reconciliation"} · Replay {detail.phaseStatus.replayMatches ? "matched" : "unavailable"}</footer>
      </>}</>}
    </div>
  </section>;
}
