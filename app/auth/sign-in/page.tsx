import type { Metadata } from "next";
import Link from "next/link";
import { safeInternalRedirectPath } from "@/lib/d5o/auth/redirects";
import { signInAction } from "./actions";

export const metadata: Metadata = {
  title: "Sign in | D5O"
};

type SignInPageProps = {
  searchParams?: Promise<{
    error?: string;
    next?: string;
  }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = (await searchParams) ?? {};
  const next = safeInternalRedirectPath(params.next);
  const hasError = params.error === "invalid";

  return (
    <main className="d5o-signin-page">
      <section className="d5o-signin-intro">
        <p className="d5o-kicker">D5O / SYSTEM OF WORK</p>
        <h1>Bring the right work into focus.</h1>
        <p>Sign in to the workspace where you have a role. D5O will show the work you own, what needs attention, and the next decision you can make.</p>
        <div className="d5o-signin-principles"><span>Your workspace</span><span>Your role</span><span>Your next action</span></div>
      </section>
      <section className="d5o-signin-card" aria-labelledby="sign-in-title">
        <div className="d5o-signin-mark" aria-hidden="true">D</div>
        <div>
          <p className="d5o-eyebrow">WORKSPACE ACCESS</p>
          <h2 id="sign-in-title">Sign in to D5O</h2>
          <p>Use an authorized workspace account to continue.</p>
        </div>
      <form action={signInAction} className="d5o-signin-form">
        <input type="hidden" name="next" value={next} />
        <label>
          Email
          <input
            autoComplete="email"
            name="email"
            required
            type="email"
          />
        </label>
        <label>
          Password
          <input
            autoComplete="current-password"
            name="password"
            required
            type="password"
          />
        </label>
        {hasError ? (
          <p role="alert" style={{ margin: 0, color: "#b42318", fontSize: 14 }}>
            The email or password was not accepted.
          </p>
        ) : null}
        <button className="button button-primary" type="submit">Continue to your work</button>
      </form>
      <p><Link href="/auth/forgot-password">Forgot password?</Link></p>
      </section>
    </main>
  );
}
