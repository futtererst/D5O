"use client";

import { useEffect, useMemo, useState } from "react";
import { groupIndicativeOrders, type ForecastPeriod } from "./discover-forecast";
import { activeForecast } from "./discover-decision";
import type { WorkRecord } from "./work-types";
import styles from "./DevelopPipeline.module.css";

type State = "Awaiting Define receipt" | "Legacy commercial history" | "Developing solution" | "Solution review" | "Estimating" | "Pricing review" | "Proposal preparation" | "Proposal review" | "Submitted" | "Clarification / negotiation" | "Awarded" | "Lost / no bid" | "Awaiting Design receipt" | "Accepted into Design";
function state(work: WorkRecord): State {
  const d = work.discovery;
  const handoff = work.definition?.developHandoff;
  if (d?.designHandoff?.status === "accepted") return "Accepted into Design";
  if (d?.outcome === "Won") return d.designHandoff?.status === "submitted" ? "Awaiting Design receipt" : "Awarded";
  if (d?.outcome === "Lost" || d?.outcome === "No bid") return "Lost / no bid";
  if (!work.definition || work.definition.status !== "Approved") return "Awaiting Define receipt";
  if (handoff?.status !== "accepted" || handoff.revision !== work.definition.revision) return d?.estimate.revision || d?.proposal.submission ? "Legacy commercial history" : "Awaiting Define receipt";
  if (d?.proposal.responseEvents?.at(-1)?.status === "Clarification requested" || d?.proposal.responseEvents?.at(-1)?.status === "Commercial negotiation") return "Clarification / negotiation";
  if (d?.proposal.submission) return "Submitted";
  if (d?.proposal.status === "Internal review") return "Proposal review";
  if (d?.estimate.status === "Approved") return "Proposal preparation";
  if (d?.estimate.status === "Pricing review") return "Pricing review";
  if ((d?.estimate.revision ?? 0) > 0) return "Estimating";
  if (work.develop?.review?.status === "Submitted") return "Solution review";
  return "Developing solution";
}
const currentStates: State[] = ["Awaiting Define receipt", "Legacy commercial history", "Developing solution", "Solution review", "Estimating", "Pricing review", "Proposal preparation", "Proposal review", "Submitted", "Clarification / negotiation", "Awarded", "Awaiting Design receipt", "Accepted into Design", "Lost / no bid"];
const money = (amount: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
function value(work: WorkRecord) {
  const d = work.discovery;
  const submitted = d?.proposal.submission?.packageSnapshot;
  if (submitted) return { amount: submitted.sellPrice, currency: submitted.pricingBasis?.currency ?? "USD", basis: `Submitted offer ${submitted.revision}` };
  if (d?.estimate.detailed) return { amount: d.estimate.sellPrice, currency: d.estimate.detailed.input.currency, basis: `Estimate ${d.estimate.revision} · ${d.estimate.status}` };
  return { amount: d?.crm?.forecast.value ?? null, currency: d?.crm?.forecast.currency ?? "USD", basis: "Discover indication" };
}

export function DevelopPipeline({ work, selectedId, onSelect }: { work: WorkRecord[]; selectedId?: string; onSelect: (id: string) => void }) {
  const [surface, setSurface] = useState<"pipeline" | "forecast">("pipeline");
  const [display, setDisplay] = useState<"table" | "board">("table");
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<State | "All">("All");
  const [ownerFilter, setOwnerFilter] = useState("All");
  const [period, setPeriod] = useState<ForecastPeriod>("month");
  const [contributors, setContributors] = useState<string[]>([]);
  const [routeReady, setRouteReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("developSurface") === "forecast") setSurface("forecast");
      if (params.get("developDisplay") === "board") setDisplay("board");
      setQuery(params.get("developQ") ?? "");
      const stage = params.get("developStage");
      if (stage && currentStates.includes(stage as State)) setStageFilter(stage as State);
      setOwnerFilter(params.get("developOwner") ?? "All");
      if (params.get("developPeriod") === "quarter") setPeriod("quarter");
      setContributors((params.get("developContributors") ?? "").split(",").filter(Boolean));
      setRouteReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!routeReady) return;
    const url = new URL(window.location.href);
    const values = { developSurface: surface === "forecast" ? surface : "", developDisplay: display === "board" ? display : "", developQ: query, developStage: stageFilter === "All" ? "" : stageFilter, developOwner: ownerFilter === "All" ? "" : ownerFilter, developPeriod: period === "quarter" ? period : "", developContributors: contributors.join(",") };
    for (const [key, value] of Object.entries(values)) { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); }
    window.history.replaceState(window.history.state, "", url);
  }, [routeReady, surface, display, query, stageFilter, ownerFilter, period, contributors]);
  const rows = useMemo(() => work.filter((item) => item.discovery).map((item) => ({ item, position: state(item) })).filter(({ item, position }) => (stageFilter === "All" || position === stageFilter) && (ownerFilter === "All" || item.owner === ownerFilter) && `${item.title} ${item.customer} ${item.site} ${item.type}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => (a.item.nextActionDue || "9999").localeCompare(b.item.nextActionDue || "9999")), [work, stageFilter, ownerFilter, query]);
  const owners = [...new Set(work.map((item) => item.owner))].sort();
  const forecastWork = work.filter((item) => item.definition?.status === "Approved" && item.discovery);
  const forecastGroups = groupIndicativeOrders(forecastWork, period, new Date().toISOString().slice(0, 10));
  const activeCount = forecastWork.filter(activeForecast).length;
  const renderCard = (item: WorkRecord, position: State) => { const v = value(item); const isSelected = item.id === selectedId; return <button type="button" className={`${styles.card} ${isSelected ? styles.selected : ""}`} key={item.id} onClick={() => onSelect(item.id)}><strong>{item.title}</strong><span>{item.customer} · {item.site}</span><small>{position} · {item.owner}</small><b>{v.amount === null ? "Value unknown" : money(v.amount, v.currency)}</b><span>{item.nextAction} · {item.nextActionDue || "Date not set"}</span></button>; };
  return <section className={styles.surface} aria-label="Develop pipeline and indicative order forecast">
    <header><div><small>DEVELOP · TENANT COMMERCIAL VIEW</small><h2>{surface === "pipeline" ? "Solution and offer pipeline" : "Indicative order forecast"}</h2><p>One Work Record per pursuit. Customer progress, internal decisions and lifecycle receiving remain separate.</p></div><nav><button type="button" className={surface === "pipeline" ? styles.active : ""} onClick={() => setSurface("pipeline")}>Pipeline</button><button type="button" className={surface === "forecast" ? styles.active : ""} onClick={() => setSurface("forecast")}>Forecast</button></nav></header>
    {surface === "pipeline" ? <><div className={styles.filters}><label>Find opportunity<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Customer, site, service or work" /></label><label>Progress<select value={stageFilter} onChange={(event) => setStageFilter(event.target.value as State | "All")}><option>All</option>{currentStates.map((item) => <option key={item}>{item}</option>)}</select></label><label>Owner<select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option>All</option>{owners.map((item) => <option key={item}>{item}</option>)}</select></label><div><button type="button" className={display === "table" ? styles.active : ""} onClick={() => setDisplay("table")}>Table</button><button type="button" className={display === "board" ? styles.active : ""} onClick={() => setDisplay("board")}>Board</button></div></div>{display === "table" ? <div className={styles.tableWrap}><table><thead><tr><th>Opportunity / customer</th><th>Develop position</th><th>Commercial basis</th><th>Next action</th></tr></thead><tbody>{rows.map(({ item, position }) => { const v = value(item); const margin = item.discovery?.estimate.detailed?.evaluation.marginPercent; return <tr key={item.id} tabIndex={0} role="button" aria-label={`Open ${item.title}`} className={item.id === selectedId ? styles.selected : ""} onClick={() => onSelect(item.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(item.id); } }}><td><strong>{item.title}</strong><small>{item.customer} · {item.site} · {item.type}</small></td><td><strong>{position}</strong><small>Owner: {item.owner} · solution {item.develop?.revision ?? "—"} · estimate {item.discovery?.estimate.revision ?? "—"}</small></td><td><strong>{v.amount === null ? "Unknown" : money(v.amount, v.currency)}</strong><small>{v.basis} · margin {margin === null || margin === undefined ? "unknown" : `${margin.toFixed(1)}%`}</small></td><td><strong>{item.nextAction}</strong><small>{item.nextActionDue || "No due date"} · expected award {item.discovery?.crm?.forecast.awardDate || "unknown"}</small></td></tr>; })}</tbody></table></div> : <div className={styles.board}>{currentStates.filter((position) => rows.some((row) => row.position === position)).map((position) => <div key={position}><h3>{position} · {rows.filter((row) => row.position === position).length}</h3>{rows.filter((row) => row.position === position).map(({ item }) => renderCard(item, position))}</div>)}</div>}{!rows.length ? <p className={styles.empty}>No pursuits match these filters.</p> : null}</> : <><div className={styles.filters}><label>Period<select value={period} onChange={(event) => { setPeriod(event.target.value as ForecastPeriod); setContributors([]); }}><option value="month">Monthly</option><option value="quarter">Quarterly</option></select></label><p>{activeCount} open opportunities. Value × the explicitly recorded Discover probability. No implied revenue, win probability, or crew booking.</p></div><div className={styles.forecast}>{forecastGroups.map((group) => <button type="button" key={`${group.period}-${group.currency}-${group.category}`} onClick={() => setContributors(group.workIds)}><strong>{group.period} · {group.currency} · {group.category}</strong><span>{money(group.unweighted, group.currency)} unweighted · {money(group.weighted, group.currency)} weighted</span><small>{group.workIds.length} records · {group.missingValue} missing value · {group.missingProbability} missing probability · {group.pastDue} overdue awards</small><small>Movement: {group.movement === null ? "Not yet comparable" : money(group.movement, group.currency)}</small></button>)}</div>{!forecastGroups.length ? <p className={styles.empty}>No open Develop opportunity has a reviewed Discover forecast yet.</p> : null}{contributors.length ? <div className={styles.contributors}><h3>Contributing opportunities</h3>{forecastWork.filter((item) => contributors.includes(item.id)).map((item) => renderCard(item, state(item)))}</div> : null}</>}
  </section>;
}
