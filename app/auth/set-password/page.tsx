"use client";

import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

type BrowserClient = ReturnType<typeof createBrowserClient>;

export default function SetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const clientRef = useRef<BrowserClient | null>(null);
  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!url || !key) throw new Error("auth_unconfigured");
        const client = createBrowserClient(url, key);
        clientRef.current = client;
        const fragment = new URLSearchParams(window.location.hash.slice(1));
        const access = fragment.get("access_token"), refresh = fragment.get("refresh_token");
        if (access && refresh) {
          const result = await client.auth.setSession({ access_token: access, refresh_token: refresh });
          if (result.error) throw result.error;
          window.history.replaceState(null, "", window.location.pathname);
        } else {
          const code = new URLSearchParams(window.location.search).get("code");
          if (code) {
            const result = await client.auth.exchangeCodeForSession(code);
            if (result.error) throw result.error;
            window.history.replaceState(null, "", window.location.pathname);
          }
        }
        const current = await client.auth.getUser();
        if (active) { setReady(Boolean(current.data.user));
          if (!current.data.user) setMessage("This invitation or recovery link is unavailable or expired. Request a new link from your workspace administrator."); }
      } catch { if (active) setMessage("This link could not be verified. Request a fresh link from your workspace administrator."); }
    }
    void restore();
    return () => { active = false; clientRef.current = null; };
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm || password.length < 12) { setMessage("Use at least 12 characters and matching passwords."); return; }
    setBusy(true); setMessage("");
    const client = clientRef.current;
    if (!client) { setMessage("Authentication is unavailable. Please reopen your recovery link."); setBusy(false); return; }
    const result = await client.auth.updateUser({ password });
    if (result.error) setMessage("Password update was rejected. The current link may have expired.");
    else { setPassword(""); setConfirm(""); setMessage("Password saved. You can now open your workspace."); }
    setBusy(false);
  }
  return <main style={{ maxWidth: "29rem", margin: "5vh auto", padding: "2rem", fontFamily: "system-ui" }}>
    <h1>Set your D5O password</h1><p>Use the invitation or recovery link sent to your approved mailbox. Workspace access remains separate from this sign-in account.</p>
    {ready && <form onSubmit={(event) => void save(event)}>
      <label>New password<input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label>Confirm password<input type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
      <button disabled={busy}>{busy ? "Saving…" : "Save password"}</button></form>}
    <p role="status">{message}</p><Link href="/auth/sign-in">Go to sign-in</Link>
  </main>;
}
