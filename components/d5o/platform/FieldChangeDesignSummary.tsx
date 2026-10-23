"use client";

import { useEffect, useState } from "react";
import styles from "./DesignWorkspace.module.css";

type Change = { id: string; packageId: string; revision: number; kind?: string; status: string; title: string; impact: string; facts: Record<string, unknown> };

export function FieldChangeDesignSummary({ workspace, workId, packageId, onChooseSource }: {
  workspace: string; workId: string; packageId: string; onChooseSource: (source: string) => void;
}) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch(`/api/d5o-hosted/field-changes?workspace=${encodeURIComponent(workspace)}&workId=${encodeURIComponent(workId)}`, { cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Changes unavailable"); return body as { changes: Change[] }; })
      .then((body) => { if (active) { setChanges(body.changes.filter((item) => item.packageId === packageId)); setError(""); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Changes unavailable"); });
    return () => { active = false; };
  }, [workspace, workId, packageId]);
  return <section className={styles.card} aria-label="Field-origin changes">
    <h3>Field-origin conditions for this package</h3>
    <p>Use the exact field-change ID as the Design change source. Commercial review and customer authorization are separate; neither issues a revised package.</p>
    {error ? <p role="alert">{error}</p> : null}
    <div className={styles.list}>{changes.map((change) => {
      const proposal = change.facts.proposal as { scopeDifference?: string; priceAmount?: string; currency?: string; scheduleImpact?: string } | undefined;
      return <article key={change.id}><div><strong>{change.title} · {change.status}</strong><small>Change {change.id} · revision {change.revision} · {change.kind ?? "Awaiting assessment"}</small><p>{change.impact}</p>
        {proposal ? <small>Proposed scope: {proposal.scopeDifference} · {proposal.priceAmount} {proposal.currency} · {proposal.scheduleImpact}</small> : null}
        <small>{change.status === "Customer authorized" ? "Customer source retained; revise and review this package before issuing a new release." : "Additional scope remains held until the specified customer and Design decisions are recorded."}</small></div>
        <button type="button" onClick={() => onChooseSource(`field-change:${change.id}`)}>Use as Design source</button></article>;
    })}{!changes.length && !error ? <p>No field-origin condition is linked to this package.</p> : null}</div>
  </section>;
}
