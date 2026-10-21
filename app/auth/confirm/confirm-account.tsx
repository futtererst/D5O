"use client";

import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";
import { useEffect, useState } from "react";

export function ConfirmAccount({ next }: { next: string }) {
  const [message, setMessage] = useState("Checking your confirmation link…");
  const [complete, setComplete] = useState(false);
  const [otherSession, setOtherSession] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    async function confirm() {
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!url || !key) throw new Error("auth_unconfigured");
        const client = createBrowserClient(url, key, { isSingleton: false, auth: { detectSessionInUrl: false } });
        const query = new URLSearchParams(window.location.search);
        const fragment = new URLSearchParams(window.location.hash.slice(1));
        const code = query.get("code");
        const access = fragment.get("access_token"), refresh = fragment.get("refresh_token");
        if (query.get("error") || fragment.get("error") || (!code && (!access || !refresh))) throw new Error("invalid_link");
        const current = await client.auth.getUser();
        if (current.data.user) {
          if (active) { setOtherSession(true); setMessage("Another account is signed in. Sign out of it, then reopen this same confirmation link."); }
          return;
        }
        const result = code
          ? await client.auth.exchangeCodeForSession(code)
          : await client.auth.setSession({ access_token: access!, refresh_token: refresh! });
        if (result.error) throw result.error;
        const verified = await client.auth.getUser();
        if (!verified.data.user?.email_confirmed_at) throw new Error("confirmation_unverified");
        window.history.replaceState(null, "", window.location.pathname);
        await client.auth.signOut();
        if (active) { setComplete(true); setMessage("Email confirmed. Sign in with your new account. Workspace access is a separate administrator decision."); }
      } catch {
        if (active) setMessage("This confirmation link is invalid, expired or already used. Request a new confirmation email, or sign in if your account is already confirmed.");
      }
    }
    void confirm();
    return () => { active = false; };
  }, []);

  async function leaveOtherSession() {
    setBusy(true);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && key) await createBrowserClient(url, key, { isSingleton: false, auth: { detectSessionInUrl: false } }).auth.signOut();
    window.location.reload();
  }

  return <main className="d5o-signin-page d5o-auth-single"><section className="d5o-signin-card">
    <div className="d5o-signin-mark" aria-hidden="true">D</div>
    <p className="d5o-eyebrow">ACCOUNT CONFIRMATION</p>
    <h1>Confirm your D5O account</h1>
    <p role="status">{message}</p>
    {otherSession && <button className="button" type="button" disabled={busy} onClick={() => void leaveOtherSession()}>Sign out of the other account</button>}
    <p><Link href={complete ? `/auth/sign-in?next=${encodeURIComponent(next)}` : "/auth/create-account?resend=1"}>{complete ? "Go to sign-in" : "Request a new confirmation"}</Link> · <Link href="/auth/sign-in">Sign in</Link></p>
  </section></main>;
}
