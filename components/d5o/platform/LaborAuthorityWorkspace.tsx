"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import styles from "./GraybarWorkspace.module.css";

type Authority = { id: string; status: string; cap_minor: number; rate_minor: number; rate_version: string;
  rate_source: string; rate_basis: string; scope: string; conditions: string; valid_from: string;
  valid_until: string; prepared_by: string; review_reason?: string };
type Reservation = { id: string; package_id: string; person: string; work_date: string; status: string;
  authorized_hours: number; amount_minor: number; reviewedHours: number; incurredMinor: number };
type Position = { revision: number; source: { digest: string; kind: string; defineRevision: number; estimateRevision: number } | null;
  parentAuthorityId: string | null; parentCapMinor: number | null; parentRemainingMinor: number | null;
  laborAuthorityId: string | null; laborCapMinor: number | null; laborRemainingMinor: number | null;
  laborExposureMinor: number; designConsumedMinor: number; purchaseConsumedMinor: number; subcontractConsumedMinor: number;
  authorities: Authority[]; reservations: Reservation[] };
type ReviewRoute = { subjectId: string; revision: number; canReview: boolean; route: string };
const money = (minor: number | null | undefined) => minor == null ? "Not approved" :
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);
const minor = (value: string) => Math.round(Number(value) * 100);

export function LaborAuthorityWorkspace({ workspace, workId, role, build, task }: {
  workspace: string; workId: string; role: string; build: string;
  task?: { step: string; revision: number; decision: string };
}) {
  const [position, setPosition] = useState<Position | null>(null);
  const [work, setWork] = useState<{ title: string; customer: string; site: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewRoute, setReviewRoute] = useState<ReviewRoute | null>(null);
  const taskDecision = task?.decision;
  const url = `/api/d5o-hosted/labor-authority?workspace=${encodeURIComponent(workspace)}&workId=${encodeURIComponent(workId)}`;
  const refresh = useCallback(async () => {
    const [authority, records] = await Promise.all([
      fetch(url, { cache: "no-store" }),
      fetch(`/api/d5o-hosted/prototype-state?workspace=${encodeURIComponent(workspace)}&key=work`, { cache: "no-store" })
    ]);
    const body = await authority.json();
    if (authority.ok) {
      const next = body as Position;
      setPosition(next);
      const current = next.authorities.find((item) => item.status === "Prepared" && (!taskDecision || item.id === taskDecision));
      setReviewRoute(null);
      if (current && role === "admin") {
        const routeResponse = await fetch(`/api/d5o-hosted/spending-review-route?workspace=${encodeURIComponent(workspace)}&workId=${encodeURIComponent(workId)}&category=field_labor_authority&subjectId=${encodeURIComponent(current.id)}`, { cache: "no-store" });
        if (routeResponse.ok) {
          const route = await routeResponse.json() as { canReview?: boolean; route?: string };
          setReviewRoute({ subjectId: current.id, revision: next.revision, canReview: route.canReview === true,
            route: route.route ?? "This review is not assigned to you." });
        } else setReviewRoute({ subjectId: current.id, revision: next.revision, canReview: false,
          route: "The configured reviewer could not be checked. Refresh before deciding." });
      }
    } else { setPosition(null); setReviewRoute(null); setNotice(body.error ?? "Labor position unavailable"); }
    if (records.ok) {
      const list = (await records.json() as { state?: { records?: Array<{ id: string; title: string; customer: string; site: string }> } }).state?.records ?? [];
      setWork(list.find((item) => item.id === workId) ?? null);
    }
  }, [url, workspace, workId, role, taskDecision]);
  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, [refresh]);
  const pending = position?.authorities.find((item) => item.status === "Prepared" && (!task?.decision || item.id === task.decision));
  const permittedReview = !!pending && reviewRoute?.subjectId === pending.id &&
    reviewRoute.revision === position?.revision && reviewRoute.canReview;
  const stale = !!task && !!position && (task.revision !== position.revision ||
    task.step === "review" && !pending || task.step === "prepare" && !!position.laborAuthorityId);
  const command = async (action: string, input: Record<string, unknown>) => {
    if (!position?.source || stale) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, input, commandId: crypto.randomUUID(), expectedRevision: position.revision,
          expectedSourceDigest: position.source.digest }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Labor decision failed");
      setNotice(`${action} retained. The authority and queue have been refreshed.`);
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Labor decision unavailable"); }
    finally { setBusy(false); }
  };
  return <div className={styles.shell}>
    <header className={styles.top}><Link href={`/work?workspace=${workspace}&view=my-work`}>D5O · My Work</Link><small>Build {build.slice(0, 12)}</small></header>
    <main className={styles.main}>
      <div className={styles.heading}><div><p className={styles.eyebrow}>FIELD LABOR · ECONOMIC AUTHORITY</p>
        <h1>Authorize a labor commitment</h1><p>{work?.title ?? "Loading Work"} · {work?.customer ?? ""} · {work?.site ?? ""}</p></div>
        <Link href={`/work?workspace=${workspace}&view=my-work`}>Back to tasks</Link></div>
      {stale && <p className={styles.notice} role="alert">This exact task changed or was decided. Return to the refreshed task list.</p>}
      {notice && <p className={styles.status} role="status">{notice}</p>}
      <section className={styles.card}>
        <h2>Current authority</h2>
        <p>Draft crew planning reserves nothing. Publishing qualified, current bookings reserves estimated person-hours at the independently reviewed cost rate. Field start is a separate decision. Reviewed actual hours can exceed the estimate and remain recorded.</p>
        <div className={styles.grid}>
          <p><b>Commercial source</b><br />{position?.source ? `${position.source.kind} · Define ${position.source.defineRevision} · estimate ${position.source.estimateRevision}` : "Current approved source missing"}</p>
          <p><b>Work cap / headroom</b><br />{money(position?.parentCapMinor)} / {money(position?.parentRemainingMinor)}</p>
          <p><b>Labor sublimit / headroom</b><br />{money(position?.laborCapMinor)} / {money(position?.laborRemainingMinor)}</p>
          <p><b>Labor committed or incurred</b><br />{money(position?.laborExposureMinor ?? null)}<br />Purchasing {money(position?.purchaseConsumedMinor ?? null)} · Design {money(position?.designConsumedMinor ?? null)} · subcontract {money(position?.subcontractConsumedMinor ?? null)}</p>
        </div>
        {!position?.parentAuthorityId && <p role="alert">The Work-level economic authority must be independently approved before labor allocation can be prepared.</p>}
        {position?.parentAuthorityId && !position.laborAuthorityId && role === "project_manager" && !pending && !stale &&
          <form className={styles.grid} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget);
            void command("prepare", { capMinor: minor(String(form.get("cap"))), rateMinor: minor(String(form.get("rate"))),
              rateVersion: form.get("rateVersion"), rateSource: form.get("rateSource"), rateBasis: form.get("rateBasis"),
              scope: form.get("scope"), conditions: form.get("conditions"), validFrom: form.get("from"), validUntil: form.get("until"),
              supersedesId: position.authorities.find((item) => ["Returned", "Revoked"].includes(item.status))?.id }); }}>
            <label>Labor sublimit USD<input name="cap" type="number" min="0.01" step="0.01" required /></label>
            <label>Approved fully burdened cost rate USD per person-hour<input name="rate" type="number" min="0.01" step="0.01" required /></label>
            <label>Rate version<input name="rateVersion" required /></label>
            <label>Retained rate source reference<input name="rateSource" required /></label>
            <label>Rate basis and applicable premiums<textarea name="rateBasis" required /></label>
            <label>Included work and package scope<textarea name="scope" required /></label>
            <label>Funding conditions and exclusions<textarea name="conditions" required /></label>
            <label>Effective from<input name="from" type="date" required /></label>
            <label>Expires<input name="until" type="date" required /></label>
            <button className={styles.primary} disabled={busy}>Prepare independent review</button>
          </form>}
        {pending && <article className={styles.record}><b>Prepared labor allocation · {money(pending.cap_minor)}</b>
          <span>{pending.scope} · {pending.valid_from} to {pending.valid_until}</span><small>Cost basis {pending.rate_version} · {money(pending.rate_minor)} per person-hour · {pending.rate_source}</small>
          <p>{pending.rate_basis}</p><p>Conditions: {pending.conditions}</p>
          {role === "admin" && !stale && permittedReview && <form className={styles.inline} onSubmit={(event) => { event.preventDefault();
            const form = new FormData(event.currentTarget);
            void command(String((event.nativeEvent as SubmitEvent).submitter?.getAttribute("value")),
              { authorityId: pending.id, reason: String(form.get("reason")) }); }}>
            <label>Independent review reason<input name="reason" minLength={10} required /></label>
            <button value="approve" disabled={busy}>Approve labor allocation</button><button value="return" disabled={busy}>Return for correction</button>
          </form>}
          {role === "admin" && !stale && !permittedReview && <p>{reviewRoute?.route ?? "Checking the configured reviewer."}</p>}
        </article>}
        <h3>Commitments and reviewed actuals</h3>
        {position?.reservations.length ? position.reservations.map((item) => <article className={styles.record} key={item.id}>
          <b>{item.package_id} · {item.person} · {item.work_date}</b><span>{item.status} · authorized {item.authorized_hours} person-hours / {money(item.amount_minor)}</span>
          <small>Reviewed {item.reviewedHours} hours / incurred {money(item.incurredMinor)} · outstanding reservation {money(item.status === "Active" ? Math.max(item.amount_minor - item.incurredMinor, 0) : 0)}</small>
          {item.incurredMinor > item.amount_minor && <p role="alert">Actual cost exceeds this assignment&apos;s estimate. Further commitments require available Work and labor headroom.</p>}
        </article>) : <p>No current labor reservation. Prepare the crew draft, then publish only after approval.</p>}
        <h3>Decision history</h3>
        {position?.authorities.map((item) => <article className={styles.record} key={item.id}><b>{item.status} · {money(item.cap_minor)} · {item.rate_version}</b>
          <small>{item.scope} · {item.review_reason ?? "Review pending"}</small>
          {item.status === "Approved" && role === "admin" && !stale && <button disabled={busy} onClick={() => {
            const reason = window.prompt("Why must this labor authority stop authorizing future assignments?");
            if (reason) void command("revoke", { authorityId: item.id, reason });
          }}>Revoke future authority</button>}</article>)}
      </section>
    </main>
  </div>;
}
