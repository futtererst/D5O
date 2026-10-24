"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Assignment = { id: string; workId: string; packageId: string; date: string; shift: string;
  people: string[] };
type Publication = { id: string; assignments: Assignment[] };
type Receipt = { assignmentId?: string; publicationId?: string; response?: string };
type View = { person: string; workspaceName: string; works: Array<{ id: string; title: string;
  permits: Array<{ packageId?: string; status?: string }> }>;
  schedule: { revision: number; state: { receipts?: Receipt[] } };
  publications: Publication[] };
export function CustomerDevelopAssignments({ workspace }: { workspace: string }) {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/d5o-hosted/customer-develop-action?workspace=${encodeURIComponent(workspace)}&worker=1`,
      { cache: "no-store" });
    const result = await response.json() as View & { error?: string };
    if (!response.ok) throw Error(result.error ?? "Assignments unavailable");
    setView(result);
  }, [workspace]);
  useEffect(() => { const frame = requestAnimationFrame(() => {
    void refresh().catch((cause) => setError(String(cause)));
  }); return () => cancelAnimationFrame(frame); }, [refresh]);
  async function acknowledge(publicationId: string, assignmentId: string, workId: string) {
    if (!view || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/d5o-hosted/customer-develop-action?workspace=${encodeURIComponent(workspace)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          action: "respond-booking", workId, publicationId, assignmentId,
          expectedRevision: view.schedule.revision, commandId: crypto.randomUUID() }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw Error(result.error ?? "Response unavailable");
      await refresh(); setMessage("Your acknowledgment was recorded. This does not authorize field execution.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Response unavailable"); }
    finally { setBusy(false); }
  }
  return <section className="d5o-customer-work-content d5o-customer-work-content--assignments"><div className="d5o-customer-work-main">
    <section className="d5o-customer-phase"><h2>My assigned Work</h2>
      <p>{view?.workspaceName ?? workspace} · {view?.person ?? "Loading your roster assignment…"}. Published crew work appears here after a scheduler releases it.</p>
      {error && <p role="alert" className="d5o-customer-work-error">{error}</p>}
      {message && <p role="status">{message}</p>}
      {view?.publications.flatMap((publication) => publication.assignments.map((assignment) => {
        const receipt = (view.schedule.state.receipts ?? []).find((item) =>
          item.assignmentId === assignment.id && item.publicationId === publication.id);
        const permitted = view.works.find((item) => item.id === assignment.workId)
          ?.permits.some((item) => item.packageId === assignment.packageId);
        return <article key={`${publication.id}:${assignment.id}`} className="d5o-customer-assignment">
          <h3>{view.works.find((item) => item.id === assignment.workId)?.title ?? "Assigned Work"}</h3>
          <p>{assignment.date} · {assignment.shift} · Package assignment</p>
          <p>{receipt?.response === "acknowledged" ? "Acknowledged by you" : "Your response is required"}</p>
          {!receipt && <button disabled={busy} onClick={() => void acknowledge(publication.id,
            assignment.id, assignment.workId)}>Acknowledge assignment</button>}
          {receipt?.response === "acknowledged" && <p>{permitted
            ? "Field start authorized. Your next responsibility is Deploy execution."
            : "Wait for the Operations field-start permit before execution."}
            <Link href={`/work/customer/${encodeURIComponent(workspace)}/assignments`}> Refresh assignment status</Link></p>}
        </article>;
      }))}
      {view && !view.publications.some((item) => item.assignments.length) &&
        <p role="status">No published assignment is available.</p>}
    </section>
  </div></section>;
}
