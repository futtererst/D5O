"use client";

import { useState } from "react";
import { DeployWorkspace } from "@/components/d5o/platform/DeployWorkspace";
import type { WorkRecord } from "@/components/d5o/platform/work-types";
import type { SharedSchedule } from "@/components/d5o/platform/schedule-model";
import type { DeployControlPolicy } from "@/components/d5o/platform/deploy-policy";
import type { DeployCommand } from "@/lib/d5o/prototype-work/deploy-command";

type Action = Omit<DeployCommand, "workId" | "expectedRevision" | "commandId">;
function readableError(value: string) {
  const messages: Record<string, string> = {
    reviewed_evidence_required: "An independently reviewed completion photo or document is required before this package can be completed.",
    open_field_change_blocks_completion: "Resolve the open field condition before recording package completion.",
    stale_state: "Work changed while this action was open. Reload current Work and review the decision again.",
    workspace_forbidden: "Your current membership cannot make this Deploy decision."
  };
  return messages[value] ?? value.replaceAll("_", " ");
}
export function CustomerDeployWorkspace({ initialWork, initialSchedule, initialSourceRevision,
  initialScheduleRevision, actorId, role, policy }: {
  initialWork: WorkRecord; initialSchedule: SharedSchedule | null; initialSourceRevision: number;
  initialScheduleRevision: number; actorId: string; role: string; policy?: DeployControlPolicy;
}) {
  const [work, setWork] = useState(initialWork);
  const [schedule, setSchedule] = useState(initialSchedule);
  const [sourceRevision, setSourceRevision] = useState(initialSourceRevision);
  const [scheduleRevision, setScheduleRevision] = useState(initialScheduleRevision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const workspace = work.workspace;
  async function refresh() {
    const url = `/api/d5o-hosted/customer-develop-action?workspace=${encodeURIComponent(workspace)}&workId=${encodeURIComponent(work.id)}`;
    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json() as { error?: string; work?: WorkRecord;
      sourceRevision?: number; schedule?: { state?: SharedSchedule; revision?: number } };
    if (!response.ok || !data.work || !Number.isInteger(data.sourceRevision))
      throw Error(data.error ?? "Current Work state is unavailable");
    setWork(data.work);
    setSourceRevision(data.sourceRevision!);
    setSchedule(data.schedule?.state ? { ...data.schedule.state, revision: data.schedule.revision ?? 0 } : null);
    setScheduleRevision(data.schedule?.revision ?? 0);
  }
  async function command(action: Action) {
    if (busy) return false;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/d5o-hosted/prototype-deploy-command?workspace=${encodeURIComponent(workspace)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...action,
          workId: work.id, expectedRevision: sourceRevision,
          expectedDesignRevision: work.design?.authorityRevision ?? 0,
          expectedScheduleRevision: scheduleRevision,
          expectedDecisionRevision: work.deploy?.authorityRevision ?? 0,
          commandId: crypto.randomUUID() }) });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw Error(result.message ?? result.error ?? "Deploy action was rejected");
      await refresh();
      setMessage("The decision was recorded and current Work state was refreshed.");
      return true;
    } catch (cause) { setError(readableError(cause instanceof Error ? cause.message : "Deploy action unavailable")); return false; }
    finally { setBusy(false); }
  }
  return <section>
    <nav aria-label="Work navigation"><a href={`/work/customer/${encodeURIComponent(workspace)}?workId=${encodeURIComponent(work.id)}`}>← Work overview</a></nav>
    <h1>Deploy · {work.title}</h1>
    <p>{work.customer} · {work.site}</p>
    {busy && <p role="status">Recording decision…</p>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <DeployWorkspace work={work} schedule={schedule} policy={policy} actorId={actorId} actorRole={role}
      onCommand={command} onUpload={async () => false} onDesignCommand={async () => false}
      onCrew={() => { window.location.href = `/work/customer/${encodeURIComponent(workspace)}?work=${encodeURIComponent(work.id)}#phase-develop`; }}
      hosted tenantNeutral />
  </section>;
}
