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
    <header className="d5o-task-frame-header"><div><small>CURRENT TASK · SOURCE REVISION {revision}</small><h1>{title}</h1>
      <p><strong>{work}</strong> · {customer}{site ? ` · ${site}` : ""}</p><p>{scope}</p></div>
      <a href={`/work?workspace=${encodeURIComponent(workspace)}&view=my-work`}>Back to tasks</a></header>
    <p><strong>Outcome:</strong> {outcome}</p>
    {blocker ? <p role="status"><strong>Before deciding:</strong> {blocker}</p> : null}
    {children}
    {nextOwner ? <p><strong>Next responsible party:</strong> {nextOwner}</p> : null}
    <details><summary>Supporting context and full record</summary>{context}
      {onFullRecord ? <button type="button" onClick={onFullRecord}>Open authorized full Work Record</button> : null}
    </details>
  </section>;
}
