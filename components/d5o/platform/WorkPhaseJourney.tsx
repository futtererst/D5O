"use client";

import type { WorkRecord } from "./work-types";

export type WorkPhase = "Discover" | "Define" | "Develop" | "Design" | "Deploy" | "Operate";
export type WorkControl = "Overview" | "Lifecycle" | "Readiness" | "Issues & changes" | "Evidence" | "Commercial" | "Lifecycle Value" | "History";

const phases: WorkPhase[] = ["Discover", "Define", "Develop", "Design", "Deploy", "Operate"];
export const workControls: WorkControl[] = ["Overview", "Lifecycle", "Readiness", "Issues & changes", "Evidence", "Commercial", "Lifecycle Value", "History"];

export function WorkPhaseJourney({ active, record, onChoose, onControl, activeControl, visiblePhases = phases }: {
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
    <nav className="d5o-work-phase-nav" aria-label="Work phases">{phases.map((phase) => <button key={phase} type="button" className={active === phase ? "is-active" : ""} aria-current={active === phase ? "page" : undefined} onClick={() => onChoose(phase)} disabled={!record || !visiblePhases.includes(phase)} title={!visiblePhases.includes(phase) ? "This phase is outside your role workspace" : undefined}>{phase}</button>)}</nav>
    <nav className="d5o-record-surface-nav" aria-label="Work Record views">{workControls.map((control) => <button key={control} type="button" className={activeControl === control ? "is-active" : ""} aria-current={activeControl === control ? "page" : undefined} onClick={() => onControl(control)} disabled={!record}>{control}</button>)}</nav>
  </>;
}
