"use client";

import { useEffect, useState } from "react";

export type CustomerEvidencePurpose = "package-acceptance" | "work-acceptance" | "service-authorization" | "field-change-authorization" | "service-billing-terms";

export function CustomerDecisionEvidence({ workspace, workId, purpose, scopeId, evidenceId, onEvidence, disabled = false }: {
  workspace: string; workId: string; purpose: CustomerEvidencePurpose; scopeId: string;
  evidenceId: string; onEvidence: (id: string) => void; disabled?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [available, setAvailable] = useState<Array<{ id: string; filename: string; checksumSha256: string; currentSource: boolean }>>([]);
  const endpoint = `/api/d5o-hosted/customer-decision-evidence?workspace=${encodeURIComponent(workspace)}`;
  useEffect(() => {
    if (purpose !== "service-billing-terms" || !scopeId) return;
    let live = true;
    void fetch(`${endpoint}&workId=${encodeURIComponent(workId)}&requestId=${encodeURIComponent(scopeId)}&list=service-billing-terms`,
      { cache: "no-store" }).then(async (response) => response.ok ? response.json() : [])
      .then((items: unknown) => { if (live && Array.isArray(items)) setAvailable(items); })
      .catch(() => { if (live) setAvailable([]); });
    return () => { live = false; };
  }, [endpoint, workId, purpose, scopeId]);
  async function upload() {
    if (!file || !scopeId) return;
    setBusy(true); setMessage(""); onEvidence("");
    try {
      const form = new FormData();
      form.set("file", file); form.set("workId", workId);
      form.set("purpose", purpose); form.set("scopeId", scopeId);
      const response = await fetch(endpoint, { method: "POST", body: form });
      const result = await response.json() as { evidenceId?: string; error?: string };
      if (!response.ok || !result.evidenceId) throw new Error(result.error ?? "Upload failed");
      onEvidence(result.evidenceId);
      if (purpose === "service-billing-terms")
        setAvailable((current) => [{ id: result.evidenceId!, filename: file.name,
          checksumSha256: "", currentSource: true }, ...current]);
      setMessage("Signed PDF retained for this exact decision scope. Review it before recording the decision.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload failed"); }
    finally { setBusy(false); }
  }
  return <div>
    <label>{purpose === "service-billing-terms" ? "Fictional customer billing-terms PDF" : "Externally signed acceptance PDF"}
      <input type="file" accept="application/pdf" onChange={(event) => { setFile(event.target.files?.[0] ?? null); onEvidence(""); }} disabled={disabled || busy} />
    </label>
    <button type="button" onClick={() => void upload()} disabled={disabled || busy || !file || !scopeId}>
      {busy ? "Saving PDF…" : "Retain PDF"}
    </button>
    {purpose === "service-billing-terms" ? <label>Choose retained terms document
      <select value={evidenceId} onChange={(event) => onEvidence(event.target.value)} disabled={disabled || busy}>
        <option value="">Select a current-scope document</option>
        {available.filter((item) => item.currentSource).map((item) =>
          <option key={item.id} value={item.id}>{item.filename}</option>)}
      </select></label> : null}
    {evidenceId ? <a href={`${endpoint}&workId=${encodeURIComponent(workId)}&evidenceId=${encodeURIComponent(evidenceId)}${purpose === "service-billing-terms" ? `&requestId=${encodeURIComponent(scopeId)}` : ""}`} target="_blank" rel="noreferrer">Open retained PDF for review</a> : null}
    {message ? <small role="status">{message}</small> : null}
  </div>;
}
