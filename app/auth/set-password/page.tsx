"use client";

import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

type BrowserClient = ReturnType<typeof createBrowserClient>;

export default function SetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [otherSession, setOtherSession] = useState(false);
  const [message, setMessage] = useState("Checking this link…");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const clientRef = useRef<BrowserClient | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const [initialInvitation, setInitialInvitation] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!url || !key) throw new Error("auth_unconfigured");
        // Check for a signed-in identity before consuming this recipient link.
        const client = createBrowserClient(url, key, {
          isSingleton: false, auth: { detectSessionInUrl: false },
        });
        clientRef.current = client;
        const fragment = new URLSearchParams(window.location.hash.slice(1));
        const query = new URLSearchParams(window.location.search);
        requestIdRef.current = query.get("request");
        const initial = query.get("initial"), workspace = query.get("workspace");
        if (initial && workspace && /^[a-z][a-z0-9_-]{2,63}$/.test(workspace))
          setInitialInvitation(`/work/initial-invitation?workspace=${encodeURIComponent(workspace)}&request=${encodeURIComponent(initial)}`);
        const access = fragment.get("access_token"), refresh = fragment.get("refresh_token");
        const code = query.get("code");
        if ((!access || !refresh) && !code) {
          if (active) setMessage("This link is invalid, expired or already used. Request a fresh invitation or recovery email.");
          return;
        }
        const previous = await client.auth.getUser();
        if (previous.data.user) {
          if (active) { setOtherSession(true);
            setMessage("Another account is signed in. Sign out first, then reopen this same link to continue as its intended recipient."); }
          return;
        }
        const result = access && refresh
          ? await client.auth.setSession({ access_token: access, refresh_token: refresh })
          : await client.auth.exchangeCodeForSession(code!);
        if (result.error) throw result.error;
        const current = await client.auth.getUser();
        if (!current.data.user) throw new Error("link_identity_missing");
        window.history.replaceState(null, "", window.location.pathname);
        if (active) { setReady(true); setMessage("Verified link. Choose a new password for this account."); }
      } catch {
        if (active) setMessage("This link is invalid, expired or already used. Request a fresh invitation or recovery email.");
      }
    }
    void restore();
    return () => { active = false; clientRef.current = null; };
  }, []);
  async function leaveOtherSession() {
    const client = clientRef.current;
    if (!client) return;
    setBusy(true);
    await client.auth.signOut();
    window.location.reload();
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (password !== confirm || password.length < 12) { setMessage("Use at least 12 characters and matching passwords."); return; }
    setBusy(true); setMessage("");
    const client = clientRef.current;
    if (!client) { setMessage("Authentication is unavailable. Reopen your recovery link."); setBusy(false); return; }
    const result = await client.auth.updateUser({ password });
    if (result.error) { setMessage("Password update was rejected. Request a fresh link if this one expired."); setBusy(false); return; }
    let setupRecorded = true;
    if (requestIdRef.current) {
      try {
        const recorded = await fetch("/api/d5o-hosted/invitation-setup", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: requestIdRef.current }),
        });
        setupRecorded = recorded.ok;
      } catch { setupRecorded = false; }
    }
    setPassword(""); setConfirm(""); setReady(false);
    await client.auth.signOut();
    setMessage(setupRecorded
      ? initialInvitation
        ? "Password saved. Sign in as this recipient, then accept the administrator invitation."
        : "Password saved. Sign in normally. Your administrator must separately activate workspace access."
      : "Password saved, but invitation completion could not be recorded. Sign in normally and ask your administrator to reconcile the pending invitation.");
    setBusy(false);
  }
  return <main className="d5o-signin-page d5o-auth-single"><section className="d5o-signin-card">
    <div className="d5o-signin-mark" aria-hidden="true">D</div>
    <p className="d5o-eyebrow">WORKSPACE ACCESS</p>
    <h1>Set your D5O password</h1>
    <p>Use the invitation or recovery link sent to your approved mailbox. Workspace membership and roster binding remain separate.</p>
    {otherSession && <button type="button" disabled={busy} onClick={() => void leaveOtherSession()}>
      Sign out of the other account and continue</button>}
    {ready && <form onSubmit={(event) => void save(event)} className="d5o-signin-form">
      <label>New password<input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label>Confirm password<input type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
      <button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save password"}</button></form>}
    <p role="status">{message}</p>
    {initialInvitation && !ready && <p><Link href={`/auth/sign-in?next=${encodeURIComponent(initialInvitation)}`}>Sign in to accept your administrator invitation</Link></p>}
    <p><Link href="/auth/forgot-password">Request a new recovery link</Link> · <Link href="/auth/sign-in">Go to sign-in</Link></p>
  </section></main>;
}
