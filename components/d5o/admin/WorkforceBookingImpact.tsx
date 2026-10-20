"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export type ProposedWorkforce = { active: boolean; qualifications: string[]; weeklyCapacityHours: number; bound: boolean };
type ImpactItem = { assignmentId: string; workId: string; workTitle: string; packageId: string; packageName: string;
  date: string; shift: string; timezone: string | null; publicationState: string; publicationId: string | null; acknowledged: boolean;
  requiredQualification: string | null; weekHours: number; currentIssues: string[]; nextAction: string };
type Impact = { personId: string; scheduleRevision: number; workforceRevision: number; asOf: string;
  person: ProposedWorkforce; items: ImpactItem[] };

export function WorkforceBookingImpact({ personId, proposed, refreshKey = 0, onBasis }: {
  personId: string; proposed?: ProposedWorkforce; refreshKey?: number;
  onBasis?: (basis: { personId: string; scheduleRevision: number; workforceRevision: number } | null) => void;
}) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setImpact(null); setError(""); onBasis?.(null);
      void fetch(`/api/d5o-hosted/workforce-impact?workspace=rybex&personId=${encodeURIComponent(personId)}`,
        { cache: "no-store", signal: controller.signal }).then(async (response) => {
          const body = await response.json() as Impact & { error?: string };
          if (!response.ok) throw new Error(body.error ?? "Booking impact unavailable");
          if (!controller.signal.aborted) { setImpact(body); onBasis?.({ personId, scheduleRevision: body.scheduleRevision, workforceRevision: body.workforceRevision }); }
        }).catch((failure) => { if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : "Booking impact unavailable"); onBasis?.(null); } });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [personId, refreshKey, reload, onBasis]);
  const projection = proposed ?? impact?.person;
  return <section aria-label="Future booking impact" style={{ width: "100%", border: "1px solid #bed0da", borderRadius: 8, padding: 14, margin: "14px 0" }}>
    <h3 style={{ margin: "0 0 6px" }}>Future crews needing attention</h3>
    <p>Current draft and retained published bookings are shown separately. A roster or access change does not alter their snapshots, acknowledgments or labor reservations.</p>
    {error ? <p role="alert">Impact unavailable: {error}. Review the current basis before a non-security change.</p> : !impact ? <p role="status">Checking current Crew and workforce revisions…</p> : <>
      <p>As of {new Date(impact.asOf).toLocaleString()} · Crew revision {impact.scheduleRevision} · workforce revision {impact.workforceRevision}.</p>
      {impact.items.length ? <div style={{ display: "grid", gap: 10 }}>{impact.items.map((item, index) => {
        const projected = projection ? [
          ...(!projection.active ? ["Person would be inactive"] : []),
          ...(!projection.bound ? ["Current worker-account access is unavailable"] : []),
          ...(item.requiredQualification && !projection.qualifications.includes(item.requiredQualification) ? [`Would lack ${item.requiredQualification}`] : []),
          ...(item.weekHours > projection.weeklyCapacityHours ? [`${item.weekHours}h booked would exceed ${projection.weeklyCapacityHours}h capacity`] : [])
        ] : [];
        return <article key={`${item.assignmentId}:${item.publicationId ?? "draft"}:${index}`} style={{ border: "1px solid #d9e2e7", borderRadius: 6, padding: 10, overflowWrap: "anywhere" }}>
          <strong>{item.workTitle} · {item.packageName}</strong>
          <p>{item.date} · {item.shift} {item.timezone ?? "time zone unverified"} · {item.publicationState}{item.acknowledged ? " · historical acknowledgment retained" : ""}</p>
          <p><b>Current:</b> {item.currentIssues.join("; ") || "No current roster issue"}. <b>With entered values:</b> {projected.join("; ") || "No roster issue projected"}.</p>
          <p><b>Next:</b> {item.nextAction}</p>
          <p><Link href={`/work?workspace=rybex&view=crew&assignment=${encodeURIComponent(item.assignmentId)}${item.publicationState.startsWith("Published snapshot") ? `&publication=${encodeURIComponent(item.publicationId ?? "")}` : ""}`}>{item.publicationState.startsWith("Published snapshot") ? "Open published Crew week" : "Open exact Crew booking"} →</Link> · <Link href={`/work/rybex/${encodeURIComponent(item.workId)}`}>Open Work →</Link></p>
        </article>;
      })}</div> : <p>No current or retained published future booking names this person.</p>}
    </>}
    <button type="button" onClick={() => setReload((value) => value + 1)}>Refresh current impact</button>
  </section>;
}
