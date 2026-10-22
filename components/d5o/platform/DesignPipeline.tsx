"use client";

import { useEffect, useMemo, useState } from "react";
import type { ConfigurationInventory } from "@/lib/d5o/configuration/version-inventory";
import { resolvePublishedPhaseConfiguration } from "./published-phase-configuration";
import { assessDesignPackage, designState } from "./design-model";
import type { WorkRecord } from "./work-types";
import type { PackageCrewDemand } from "./schedule-model";
import styles from "./DesignWorkspace.module.css";

type Position = "Awaiting Develop" | "Receive basis" | "Legacy basis" | "Drafting" | "In review" | "Blocked" | "Ready" | "Awaiting Deploy" | "Received by Deploy";
type Row = { work: WorkRecord; position: Position; blocker: string; target: string; forecast: string; packages: number };
const positions: Position[] = ["Awaiting Develop", "Receive basis", "Legacy basis", "Drafting", "In review", "Blocked", "Ready", "Awaiting Deploy", "Received by Deploy"];

export function designPipelineRows(work: WorkRecord[], inventory: ConfigurationInventory, demands: PackageCrewDemand[]): Row[] {
  return work.filter((item) => item.discovery?.pursuitControl || designState(item).packages.length || ((item as WorkRecord & { packages?: unknown[] }).packages?.length ?? 0) > 0).map((item) => {
    const state = designState(item), config = resolvePublishedPhaseConfiguration(inventory, item.workspace, item.type, item);
    const packages = ((item as WorkRecord & { packages?: Array<{ id: string }> }).packages ?? []).map((entry) => entry.id);
    const assessments = packages.map((id) => assessDesignPackage(item, id, undefined, demands.find((demand) => demand.workId === item.id && demand.packageId === id) ?? null, config?.designControls));
    const open = assessments.flatMap((assessment) => assessment.findings);
    const releases = state.releases.filter((release) => !["Returned", "Withdrawn", "Held"].includes(release.status));
    const position: Position = item.discovery?.pursuitControl && item.discovery?.outcome !== "Won" ? "Awaiting Develop"
      : item.discovery?.pursuitControl && item.discovery.designHandoff?.status !== "accepted" ? "Receive basis"
      : !item.discovery?.pursuitControl && !state.packages.length ? "Legacy basis"
      : releases.some((release) => release.status === "Hold pending acknowledgment") ? "Blocked"
      : releases.some((release) => release.status === "Awaiting receipt") ? "Awaiting Deploy"
      : packages.length && releases.filter((release) => release.status === "Accepted").length === packages.length ? "Received by Deploy"
      : state.reviews.some((review) => review.status === "Requested") ? "In review"
      : packages.length && assessments.every((assessment) => assessment.recommendation === "Ready for release") ? "Ready"
      : open.some((finding) => finding.severity === "blocker") ? "Blocked" : "Drafting";
    const latestForecast = [...(state.forecasts ?? [])].sort((a, b) => b.at.localeCompare(a.at))[0];
    return { work: item, position, blocker: position === "Legacy basis" ? "Older package source is unverified; prepare an exact Design basis" : open[0]?.message ?? (position === "Receive basis" ? "Accept or return exact Develop handoff" : position === "Awaiting Develop" ? "Customer award and approved Develop basis required" : "None recorded"), target: latestForecast?.targetDate ?? "", forecast: latestForecast?.forecastDate ?? "", packages: packages.length };
  });
}

export function DesignPipeline({ work, inventory, demands, onSelect }: { work: WorkRecord[]; inventory: ConfigurationInventory; demands: PackageCrewDemand[]; onSelect: (id: string) => void }) {
  const [view, setView] = useState<"Table" | "Board">("Table");
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<Position | "All">("All");
  const [owner, setOwner] = useState("All");
  const [sort, setSort] = useState<"Next action" | "Target release" | "Customer">("Next action");
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextPosition = params.get("designPosition");
    const nextSort = params.get("designSort");
    queueMicrotask(() => {
      setView(params.get("designView") === "Board" ? "Board" : "Table");
      setQuery(params.get("designQ") ?? "");
      setPosition(positions.includes(nextPosition as Position) ? nextPosition as Position : "All");
      setOwner(params.get("designOwner") ?? "All");
      setSort(nextSort === "Target release" || nextSort === "Customer" ? nextSort : "Next action");
      setRestored(true);
    });
  }, []);
  useEffect(() => {
    if (!restored) return;
    const url = new URL(window.location.href);
    for (const [key, value, defaultValue] of [["designView", view, "Table"], ["designQ", query, ""], ["designPosition", position, "All"], ["designOwner", owner, "All"], ["designSort", sort, "Next action"]]) {
      if (value === defaultValue) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    window.history.replaceState(window.history.state, "", url);
  }, [restored, view, query, position, owner, sort]);
  const rows = useMemo(() => designPipelineRows(work, inventory, demands), [work, inventory, demands]);
  const owners = [...new Set(rows.map((row) => row.work.owner))].sort();
  const filtered = rows.filter((row) => (position === "All" || row.position === position) && (owner === "All" || row.work.owner === owner)
    && `${row.work.title} ${row.work.customer} ${row.work.site} ${row.work.owner}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === "Target release" ? (a.target || "9999").localeCompare(b.target || "9999") : sort === "Customer" ? a.work.customer.localeCompare(b.work.customer) : positions.indexOf(a.position) - positions.indexOf(b.position));
  const openRecord = (row: Row) => <button type="button" onClick={() => onSelect(row.work.id)}>{row.work.title} →</button>;
  return <section className={styles.card}><div className={styles.pipelineHeading}><div><h3>Design work requiring action</h3><p>One Work Record across the lifecycle. Choose a record to inspect its exact Design basis and package decisions.</p></div><div className={styles.actions}><button type="button" aria-pressed={view === "Table"} onClick={() => setView("Table")}>Table</button><button type="button" aria-pressed={view === "Board"} onClick={() => setView("Board")}>Board</button></div></div>
    <div className={styles.pipelineFilters}><label>Find work<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Customer, work, site, owner" /></label><label>Position<select value={position} onChange={(event) => setPosition(event.target.value as Position | "All")}><option>All</option>{positions.map((value) => <option key={value}>{value}</option>)}</select></label><label>Owner<select value={owner} onChange={(event) => setOwner(event.target.value)}><option>All</option>{owners.map((value) => <option key={value}>{value}</option>)}</select></label><label>Sort<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option>Next action</option><option>Target release</option><option>Customer</option></select></label></div>
    {view === "Table" ? <><div className={styles.pipelineTable}><table><thead><tr><th>Work / customer</th><th>Position</th><th>Owner</th><th>Packages</th><th>Target / forecast</th><th>Primary action</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.work.id}><td>{openRecord(row)}<small>{row.work.customer} · {row.work.site}</small></td><td>{row.position}</td><td>{row.work.owner}</td><td>{row.packages}</td><td>{row.target || "Unknown"} / {row.forecast || "Unknown"}</td><td>{row.blocker}</td></tr>)}</tbody></table></div><div className={styles.pipelineCompact} aria-label="Design work records">{filtered.map((row) => <article key={row.work.id}><strong>{row.work.title}</strong><small>{row.work.customer} · {row.work.site}</small><span>{row.position} · {row.packages} package{row.packages === 1 ? "" : "s"}</span><span>Next: {row.blocker}</span><small>Owner {row.work.owner} · target {row.target || "unknown"} · forecast {row.forecast || "unknown"}</small>{openRecord(row)}</article>)}</div></>
      : <div className={styles.pipelineBoard}>{positions.map((value) => { const group = filtered.filter((row) => row.position === value); return group.length ? <section key={value}><h4>{value} · {group.length}</h4>{group.map((row) => <article key={row.work.id}>{openRecord(row)}<small>{row.work.customer} · {row.work.owner}</small><p>{row.blocker}</p><small>Target {row.target || "unknown"}</small></article>)}</section> : null; })}</div>}
    {!filtered.length ? <p>No Design work matches these filters.</p> : null}
  </section>;
}
