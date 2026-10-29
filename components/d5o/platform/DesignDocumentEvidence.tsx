"use client";

import { useEffect, useState } from "react";

type Receipt = { evidenceId: string; checksumSha256: string; filename: string;
  sizeBytes: number; uploadedBy: string; uploadedAt: string };

export function DesignDocumentEvidence({ workspace, workId, documentId, revision,
  canUpload, onEvidence }: { workspace: string; workId: string; documentId: string;
  revision: number; canUpload: boolean; onEvidence?: (id: string, documentId: string) => void }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const endpoint = `/api/d5o-hosted/design-document-evidence?workspace=${encodeURIComponent(workspace)}` +
    `&workId=${encodeURIComponent(workId)}&documentId=${encodeURIComponent(documentId)}&revision=${revision}`;
  useEffect(() => {
    let active = true;
    fetch(endpoint, { cache: "no-store" }).then(async (response) => {
      if (!active) return;
      if (response.status === 404) { setReceipt(null); setMessage(""); return; }
      if (!response.ok) { setMessage("Document custody could not be loaded. Refresh before submitting for review."); return; }
      const found = await response.json() as Receipt;
      if (active && found.evidenceId) { setReceipt(found); onEvidence?.(found.evidenceId, documentId); }
    }).catch(() => { if (active) setMessage("Document custody could not be loaded. Refresh before submitting for review."); });
    return () => { active = false; };
  }, [endpoint, onEvidence, documentId]);
  async function upload() {
    if (!file || busy) return;
    setBusy(true); setMessage("");
    try {
      const body = new FormData(); body.set("file", file);
      const response = await fetch(endpoint, { method: "POST", body });
      const result = await response.json() as Receipt & { error?: string };
      if (!response.ok || !result.evidenceId) throw new Error(result.error ?? "Upload failed");
      setReceipt({ evidenceId: result.evidenceId,checksumSha256: result.checksumSha256,
        filename: result.filename ?? file.name,sizeBytes: file.size,
        uploadedBy: "Current signed-in user",uploadedAt: new Date().toISOString() });
      onEvidence?.(result.evidenceId, documentId); setFile(null);
      setMessage("Private PDF retained for this exact draft revision. Independent review is still required.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload failed"); }
    finally { setBusy(false); }
  }
  return <div>
    {receipt ? <p><strong>Retained PDF:</strong> <a href={`${endpoint}&download=1`} target="_blank" rel="noreferrer">{receipt.filename}</a> · SHA-256 {receipt.checksumSha256}</p>
      : <p>No inspectable private PDF is retained for this revision.</p>}
    {canUpload && !receipt ? <div><label>Exact document PDF<input type="file" accept="application/pdf,.pdf"
      onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
      <button type="button" disabled={!file || busy} onClick={() => void upload()}>{busy ? "Retaining PDF…" : "Retain private PDF"}</button></div> : null}
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
