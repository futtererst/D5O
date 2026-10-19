"use client";

import { useRef, useState } from "react";

type Pending = { endpoint: string; body: Record<string, unknown>; commandId: string };

export function useAdminCommand(workspace: string, refresh: () => Promise<unknown>) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [message, setMessage] = useState("");

  async function checkReceipt(command: Pending) {
    const query = new URLSearchParams({ workspace, commandId: command.commandId });
    const response = await fetch(`/api/d5o-hosted/admin-receipt?${query}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Receipt check unavailable. Keep the current input and command identity.");
    return response.json() as Promise<{ found: boolean }>;
  }

  async function reconcile() {
    if (!pending) return;
    setBusy(true);
    try {
      const receipt = await checkReceipt(pending);
      if (receipt.found) {
        pendingRef.current = null; setPending(null); setCanRetry(false);
        await refresh();
        setMessage("The original command committed. No duplicate was sent.");
      } else { setCanRetry(true); setMessage("No committed receipt yet. You may retry the same command identity; do not start a different change."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Receipt unavailable."); }
    finally { setBusy(false); }
  }

  async function send(command: Pending, success: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(command.endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...command.body, commandId: command.commandId }) });
      const body = await response.json() as { error?: string; message?: string };
      if (!response.ok && response.status !== 503) {
        pendingRef.current = null; setPending(null); setCanRetry(false);
        await refresh();
        setMessage(body.message ?? `${body.error ?? "Change rejected"}. Your input remains available; compare the current basis.`);
        return;
      }
      if (!response.ok) throw new Error("uncertain_response");
      pendingRef.current = null; setPending(null); setCanRetry(false);
      await refresh();
      setMessage(success);
    } catch {
      try {
        const receipt = await checkReceipt(command);
        if (receipt.found) {
          pendingRef.current = null; setPending(null); setCanRetry(false);
          await refresh();
          setMessage("The change committed despite a lost response. No duplicate was sent.");
        } else { setCanRetry(true); setMessage("Outcome uncertain. The receipt is absent; retry only this command identity."); }
      } catch { setMessage("Save and receipt checks are unavailable. Keep the input; do not issue another command."); }
    } finally { setBusy(false); }
  }

  function execute(endpoint: string, body: Record<string, unknown>, success: string) {
    if (pendingRef.current) { setMessage("Reconcile the pending command before starting another change."); return; }
    const command = { endpoint, body, commandId: crypto.randomUUID() };
    pendingRef.current = command;
    setPending(command); setCanRetry(false);
    void send(command, success);
  }

  function retry() {
    if (pending && canRetry && !busy) { setCanRetry(false); void send(pending, "The original command was accepted on retry."); }
  }

  return { pending, busy, canRetry, message, setMessage, execute, reconcile, retry };
}
