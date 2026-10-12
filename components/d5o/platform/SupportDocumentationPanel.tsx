"use client";
import { useState, type FormEvent } from "react";
import type { WorkRecord } from "./work-types";
import { operateState } from "./operate-model";
import type { OperateCommand } from "@/lib/d5o/prototype-work/operate-command";
import style from "./OperateWorkspace.module.css";

type Action = Omit<OperateCommand, "workId" | "expectedRevision" | "commandId">;
type Kind = "as-built" | "inspection";
const fileUrl = (work: WorkRecord, id: string) =>
  "/api/d5o-hosted/customer-decision-evidence?workspace=" + encodeURIComponent(work.workspace) +
  "&workId=" + encodeURIComponent(work.id) + "&evidenceId=" + encodeURIComponent(id);

export function SupportDocumentationPanel({ work, hosted, actorRole, onCommand, focus }: {
  work: WorkRecord; hosted: boolean; actorRole?: string; onCommand: (action: Action) => Promise<boolean>;
  focus?: { turnoverId: string; documentKind: string } | null;
}) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const state = operateState(work), accepted = work.deploy?.workAcceptance;
  const turnovers = work.deploy?.turnovers.filter((turnover) =>
    turnover.status === "Client accepted" && turnover.receipt === "Accepted" &&
    accepted?.turnoverIds.includes(turnover.id) && state.source?.turnoverIds.includes(turnover.id)) ?? [];
  const docs = state.documentationObligations ?? [];
  const canSupply = hosted && !!work.canonicalWorkId &&
    (actorRole === "project_manager" || actorRole === "field_supervisor");
  const canReview = hosted && !!work.canonicalWorkId && actorRole === "operations_leader";
  const upload = (turnoverId: string, kind: Kind) => async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    data.set("workId", work.id);
    data.set("purpose", kind === "as-built" ? "support-as-built" : "support-inspection");
    data.set("scopeId", turnoverId);
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/d5o-hosted/customer-decision-evidence?workspace=" +
        encodeURIComponent(work.workspace), { method: "POST", body: data });
      const result = await response.json() as { evidenceId?: string; error?: string };
      if (!response.ok || !result.evidenceId) { setMessage(result.error ?? "Upload failed."); return; }
      const done = await onCommand({ action: "submit-support-document", turnoverId,
        documentKind: kind, evidenceId: result.evidenceId,
        note: String(data.get("note") ?? "").trim() });
      setMessage(done ? "Retained document submitted for independent review." :
        "Retained bytes need a refreshed submission. Evidence ID: " + result.evidenceId);
      if (done) form.reset();
    } finally { setBusy(false); }
  };
  const review = (turnoverId: string, kind: Kind, evidenceId: string) =>
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault(); setBusy(true); setMessage("");
      const data = new FormData(event.currentTarget);
      try {
        const done = await onCommand({ action: "review-support-document", turnoverId,
          documentKind: kind, evidenceId,
          decision: String(data.get("decision")) as "Reviewed" | "Returned",
          note: String(data.get("note") ?? "").trim() });
        setMessage(done ? "Independent review retained." : "Review was not committed.");
      } finally { setBusy(false); }
    };
  if (!accepted || !state.source) return null;
  return <section className={style.card} aria-label="Accepted turnover documentation">
    <div className={style.cardHead}><h3>Assigned documentation obligations</h3>
      <p>Private PDFs retain their exact package, release and checksum. Support activation does not complete these obligations.</p></div>
    {message ? <p role="status">{message}</p> : null}
    {turnovers.filter((turnover) => !focus || turnover.id === focus.turnoverId).flatMap((turnover) => (["as-built", "inspection"] as Kind[])
      .filter((kind) => turnover.obligations.toLowerCase().includes(kind) && (!focus || focus.documentKind === kind))
      .map((kind) => {
        const release = work.design?.releases.find((item) => turnover.releaseIds.includes(item.id));
        const history = docs.filter((item) => item.turnoverId === turnover.id && item.kind === kind);
        const current = history.at(-1);
        return <article className={style.row} key={turnover.id + ":" + kind}>
          <b>{kind === "as-built" ? "As-built controls record" : "Inspection retention"} / {work.packages?.find((item) => item.id === release?.packageId)?.name ?? "Package unknown"}</b>
          <span>Turnover {turnover.id} rev {turnover.revision}; release {release?.id ?? "unavailable"}</span>
          <strong>{current?.status === "Reviewed" ? "Reviewed obligation complete" :
            current?.status === "Submitted" ? "Awaiting independent review" :
            current?.status === "Returned" ? "Returned: replacement required" : "Outstanding: document not supplied"}</strong>
          {history.map((item) => <div key={item.id}>
            <a href={fileUrl(work, item.id)} target="_blank" rel="noreferrer">Open retained {item.filename}</a>
            <small>{item.status}; SHA-256 {item.checksumSha256}; supplied by {item.uploadedByActorId} at {item.uploadedAt}
              {item.reviewedByActorId ? "; reviewed by " + item.reviewedByActorId + " at " + item.reviewedAt : ""}
              {item.supersedesId ? "; supersedes " + item.supersedesId : ""}</small>
            {item.reviewReason ? <small>Review reason: {item.reviewReason}</small> : null}
          </div>)}
          {canSupply && current?.status !== "Submitted" ? <form className={style.form} onSubmit={upload(turnover.id, kind)}>
            <label>Fictional PDF<input name="file" type="file" accept="application/pdf" required /></label>
            <label>Supply note<input name="note" minLength={10} required /></label>
            <button disabled={busy}>Retain and submit document</button>
          </form> : null}
          {canReview && current?.status === "Submitted" ? <form className={style.form}
            onSubmit={review(turnover.id, kind, current.id)}>
            <label>Decision<select name="decision"><option>Reviewed</option><option>Returned</option></select></label>
            <label>Review reason<input name="note" minLength={10} required /></label>
            <button disabled={busy}>Record independent review</button>
          </form> : null}
        </article>;
      }))}
  </section>;
}
