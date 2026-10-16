"use client";

import type { ReactNode } from "react";

type Props = {
  title: string; work: string; customer: string; site?: string;
  scope: string; revision: string | number; outcome: string;
  blocker?: string | null; nextOwner?: string | null;
  workspace: string; onFullRecord?: () => void;
  children: ReactNode; context?: ReactNode;
};

/** Presentation only: command routes remain the sole authority for decisions. */
export function FocusedTaskFrame({ title, work, customer, site, scope, revision, outcome, blocker, nextOwner, workspace, onFullRecord, children, context }: Props) {
  return <section className="d5o-task-frame" aria-label={title}>
    <header className="d5o-task-frame-header"><div className="d5o-task-heading"><small>YOUR TASK <span aria-hidden="true">/</span> REVISION {revision}</small><h1>{title}</h1>
      <p><strong>{work}</strong><span>{customer}{site ? ` · ${site}` : ""}</span></p></div>
      <a href={`/work?workspace=${encodeURIComponent(workspace)}&view=my-work`}>← Back to My work</a></header>
    <div className="d5o-task-intent"><div><span>WHAT YOU NEED TO DO</span><p>{outcome}</p></div><div><span>THIS TASK COVERS</span><p>{scope}</p></div></div>
    {blocker ? <p className="d5o-task-blocker" role="status"><strong>Before you can decide</strong>{blocker}</p> : null}
    <div className="d5o-task-controls">{children}</div>
    {nextOwner ? <p className="d5o-task-next"><strong>After this:</strong> {nextOwner}</p> : null}
    <details className="d5o-task-supporting"><summary>Supporting context and full record</summary>{context}
      {onFullRecord ? <button type="button" onClick={onFullRecord}>Open authorized full Work Record</button> : null}
    </details>
  </section>;
}
