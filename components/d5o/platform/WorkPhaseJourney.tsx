"use client";

import type { WorkRecord } from "./work-types";

export type WorkPhase = "Discover" | "Define" | "Develop" | "Design" | "Deploy" | "Operate";
export type WorkControl = "Overview" | "Lifecycle" | "Readiness" | "Issues & changes" | "Evidence" | "Commercial" | "Lifecycle Value" | "History";

const phases: WorkPhase[] = ["Discover", "Define", "Develop", "Design", "Deploy", "Operate"];
export const workControls: WorkControl[] = ["Overview", "Lifecycle", "Readiness", "Issues & changes", "Evidence", "Commercial", "Lifecycle Value", "History"];

export function WorkPhaseJourney({ active, record, backLabel, onBack, onChoose, onControl, activeControl, visiblePhases = phases }: {
  active?: WorkPhase;
  record?: WorkRecord;
  backLabel: string;
  onBack: () => void;
  onChoose: (phase: WorkPhase) => void;
  onControl: (control: WorkControl) => void;
  activeControl?: WorkControl;
  visiblePhases?: readonly WorkPhase[];
}) {
  return <>
    <button className="d5o-back" type="button" onClick={onBack}>← {backLabel}</button>
    <header className="d5o-phase-record-header"><div><p>WORK RECORD · VIEWING {(active ?? activeControl ?? "Phase").toUpperCase()}</p><h1>{record?.title ?? "Select a Work Record"}</h1><span>{record ? `${record.type} · ${record.customer} · ${record.site}` : "Choose work in this workspace to continue."}</span></div><div className="d5o-phase-header-actions"><div className={`d5o-stage-badge ${record?.status ?? ""}`}><small>CURRENT GOVERNED POSITION</small><strong>{record?.stage ?? "No work selected"}</strong></div><details className="d5o-record-menu"><summary>Record views</summary><nav aria-label="Work Record views">{workControls.map((control) => <button key={control} type="button" className={activeControl === control ? "is-active" : ""} aria-current={activeControl === control ? "page" : undefined} onClick={(event) => { onControl(control); event.currentTarget.closest("details")?.removeAttribute("open"); }} disabled={!record}>{control}</button>)}</nav></details></div></header>
    {visiblePhases.length ? <nav className="d5o-work-phase-nav" aria-label="Relevant work phases">{visiblePhases.map((phase) => <button key={phase} type="button" className={active === phase ? "is-active" : ""} aria-current={active === phase ? "page" : undefined} onClick={() => onChoose(phase)} disabled={!record}>{phase}</button>)}</nav> : null}
  </>;
}
