"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/auth/password-recovery", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await response.json() as { message?: string };
      setMessage(body.message ?? "Recovery is temporarily unavailable.");
    } catch { setMessage("Recovery is temporarily unavailable. Your input is retained; try again later."); }
    finally { setBusy(false); }
  }
  return <main className="d5o-signin-page">
    <section className="d5o-signin-card" style={{ width: "min(100%, 30rem)" }}>
      <p className="d5o-eyebrow">ACCOUNT RECOVERY</p>
      <h1>Reset your password</h1>
      <p>Enter your synthetic trial account email. If it is eligible, you will receive a recovery link. Workspace access and role will not change.</p>
      <form className="d5o-signin-form" onSubmit={(event) => void submit(event)}>
        <label>Email<input type="email" autoComplete="email" required value={email}
          onChange={(event) => setEmail(event.target.value)} /></label>
        <button className="button button-primary" disabled={busy}>{busy ? "Requesting…" : "Request recovery link"}</button>
      </form>
      <p role="status">{message}</p>
      <p><Link href="/auth/sign-in">Return to sign-in</Link></p>
    </section>
  </main>;
}
