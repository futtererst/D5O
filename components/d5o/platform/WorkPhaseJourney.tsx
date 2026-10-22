"use client";

import type { WorkRecord } from "./work-types";

export type WorkPhase = "Discover" | "Define" | "Develop" | "Design" | "Deploy" | "Operate";
export type WorkControl = "Overview" | "Lifecycle" | "Readiness" | "Issues & changes" | "Evidence" | "Commercial" | "Lifecycle Value" | "History";

export const workPhases: WorkPhase[] = ["Discover", "Define", "Develop", "Design", "Deploy", "Operate"];
export const workControls: WorkControl[] = ["Overview", "Lifecycle", "Readiness", "Issues & changes", "Evidence", "Commercial", "Lifecycle Value", "History"];

export function WorkPhaseJourney({ active, record, onChoose, onControl, activeControl, visiblePhases = workPhases }: {
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
    <div className="d5o-journey-selectors">
      <label>Viewing phase
        <select aria-label="Viewing phase" value={active ?? ""} onChange={(event) => onChoose(event.target.value as WorkPhase)} disabled={!record}>
          <option value="" disabled>Select a phase</option>
          {workPhases.map((phase) => <option key={phase} value={phase} disabled={!visiblePhases.includes(phase)}>{phase}</option>)}
        </select>
      </label>
      <label>Record view
        <select aria-label="Record view" value={activeControl ?? ""} onChange={(event) => onControl(event.target.value as WorkControl)} disabled={!record}>
          <option value="" disabled>Select a record view</option>
          {workControls.map((control) => <option key={control} value={control}>{control}</option>)}
        </select>
      </label>
    </div>
    <nav className="d5o-work-phase-nav" aria-label="Work phases">{workPhases.map((phase) => <button key={phase} type="button" className={active === phase ? "is-active" : ""} aria-current={active === phase ? "page" : undefined} onClick={() => onChoose(phase)} disabled={!record || !visiblePhases.includes(phase)} title={!visiblePhases.includes(phase) ? "This phase is outside your role workspace" : undefined}>{phase}</button>)}</nav>
    <nav className="d5o-record-surface-nav" aria-label="Work Record views">{workControls.map((control) => <button key={control} type="button" className={activeControl === control ? "is-active" : ""} aria-current={activeControl === control ? "page" : undefined} onClick={() => onControl(control)} disabled={!record}>{control}</button>)}</nav>
  </>;
}
