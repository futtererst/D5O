"use client";

import type { WorkRecord } from "./work-types";

export type WorkPhase = "Discover" | "Define" | "Develop" | "Design" | "Deploy" | "Operate";
export type WorkControl = "Overview" | "Lifecycle" | "Readiness" | "Issues & changes" | "Evidence" | "Commercial" | "Lifecycle Value" | "History";

export const workPhases: WorkPhase[] = ["Discover", "Define", "Develop", "Design", "Deploy", "Operate"];

export function WorkPhaseJourney({ active, record, onChoose, visiblePhases = workPhases }: {
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
    </div>
    <nav className="d5o-work-phase-nav" aria-label="Work phases">{workPhases.map((phase) => <button key={phase} type="button" className={active === phase ? "is-active" : ""} aria-current={active === phase ? "page" : undefined} onClick={() => onChoose(phase)} disabled={!record || !visiblePhases.includes(phase)} title={!visiblePhases.includes(phase) ? "This phase is outside your role workspace" : undefined}>{phase}</button>)}</nav>
  </>;
}
