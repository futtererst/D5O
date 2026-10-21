"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { createClient } from "@supabase/supabase-js";

function registrationClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("auth_unconfigured");
  // Confirmation may be opened on a different device. An implicit link can be
  // exchanged there without a PKCE verifier retained in the signup browser.
  return createClient(url, key, { auth: { flowType: "implicit", persistSession: false,
    autoRefreshToken: false, detectSessionInUrl: false } });
}

function confirmationDestination(next: string) {
  const origin = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? window.location.origin : "https://d5o-system-of-work.vercel.app";
  return `${origin}/auth/confirm?next=${encodeURIComponent(next)}`;
}

export function CreateAccountForm({ next, initialResend }: { next: string; initialResend: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resend, setResend] = useState(initialResend);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!resend && (password.length < 12 || password !== confirmation)) {
      setMessage(password.length < 12 ? "Use at least 12 characters for your password." : "Passwords do not match.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const client = registrationClient();
      const address = email.trim().toLowerCase();
      const options = { emailRedirectTo: confirmationDestination(next) };
      const { error } = resend
        ? await client.auth.resend({ type: "signup", email: address, options })
        : await client.auth.signUp({ email: address, password, options });
      if (error) {
        if (error.status === 429 || /rate.limit|too many/i.test(error.message))
          setMessage("Email requests are temporarily limited. Wait before trying again; your entries are preserved.");
        else if (/password|weak/i.test(error.message))
          setMessage("The password did not meet the email provider’s requirements. Choose a stronger password and try again.");
        else if (/already.registered|already exists/i.test(error.message)) {
          setSent(true);
          setMessage("If this address is eligible, check its mailbox. You can also sign in or recover an existing account.");
        } else setMessage("The request could not be completed. Check your entries and try again; they are preserved.");
        return;
      }
      setPassword("");
      setConfirmation("");
      setSent(true);
      setMessage("Request accepted by the email provider. Check your mailbox for a confirmation link. Delivery is not yet verified.");
    } catch {
      setMessage("The request could not be completed. Check your connection and try again; your entries are preserved.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <main className="d5o-signin-page d5o-auth-single"><section className="d5o-signin-card" aria-labelledby="create-account-title">
    <div className="d5o-signin-mark" aria-hidden="true">D</div>
    <p className="d5o-eyebrow">D5O ACCOUNT</p>
    <h1 id="create-account-title">{resend ? "Resend confirmation" : "Create account"}</h1>
    <p>{resend ? "Request another confirmation email if the first link was lost or expired." : "Create a sign-in account. Email confirmation is required. A workspace administrator grants access separately."}</p>
    <form className="d5o-signin-form" onSubmit={(event) => void submit(event)}>
      <label>Email<input autoComplete="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      {!resend && !sent && <>
        <label>Password<input autoComplete="new-password" type={showPassword ? "text" : "password"} minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby="d5o-password-help" /></label>
        <p id="d5o-password-help" className="d5o-auth-help">Use at least 12 characters. The provider may require a stronger password.</p>
        <button className="d5o-auth-toggle" type="button" aria-pressed={showPassword} aria-label={showPassword ? "Hide passwords" : "Show passwords"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide passwords" : "Show passwords"}</button>
        <label>Confirm password<input autoComplete="new-password" type={showPassword ? "text" : "password"} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      </>}
      {(resend || !sent) && <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Requesting…" : resend ? "Resend confirmation" : "Create account"}</button>}
    </form>
    {message && <p role={sent ? "status" : "alert"}>{message}</p>}
    {sent && <p>After confirming, sign in. If you see “Account ready · workspace access pending,” ask your trial operator to grant access. Registration does not assign a role, roster person or booking.</p>}
    <p><button className="d5o-auth-link" type="button" onClick={() => { setResend(!resend); setSent(false); setMessage(""); }}>{resend ? "Create account" : "Resend confirmation email"}</button> · <Link href={`/auth/sign-in?next=${encodeURIComponent(next)}`}>Return to sign-in</Link></p>
  </section></main>;
}
