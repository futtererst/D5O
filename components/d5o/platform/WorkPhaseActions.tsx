"use client";

import { useState, type FormEvent } from "react";
import { decisionCheckPhase, type DecisionCheckResult, type PhaseComponent, type PhaseDefinition, type WorkTypeConfiguration } from "./phase-configuration";
import styles from "./WorkPhaseActions.module.css";

type Target = "Plan" | "Readiness" | "Execution" | "Evidence" | "Commercial" | "Handoff" | "Lifecycle Value";
type PhaseWork = {
  id: string;
  phaseRegisters?: Record<string, Array<Record<string, string>>>;
  packages?: Array<{ id: string; name: string; installed: number; tested: number; accepted: number; status: string }>;
  evidence?: Array<{ state: string }>;
  lifecycle?: Array<{ status: string }>;
  definition?: { status: string };
  design?: { reviews: Array<{ status: string }> };
  commercial?: { confidence: string; condition: string };
  value: string;
};

const targets: Record<string, Target> = {
  "develop.capacity": "Plan", "develop.variance": "Commercial",
  "design.work_packages": "Plan", "design.design_review": "Readiness",
  "deploy.execution_facts": "Execution", "deploy.proof": "Evidence", "deploy.acceptance": "Readiness",
  "operate.service_actions": "Handoff", "operate.value": "Lifecycle Value",
};

function status(work: PhaseWork, key: string, demandCount: number, assignmentCount: number): string {
  const packages = work.packages ?? [];
  switch (key) {
    case "develop.capacity": return `${demandCount} package demand${demandCount === 1 ? "" : "s"} defined`;
    case "develop.variance": return work.commercial?.confidence ?? "Commercial basis not recorded";
    case "design.work_packages": return `${packages.length} controlled package${packages.length === 1 ? "" : "s"}`;
    case "design.design_review": return `${work.design?.reviews.filter((item) => item.status === "Approved").length ?? 0} revision-specific Design reviews approved`;
    case "deploy.schedule": return `${assignmentCount} crew booking${assignmentCount === 1 ? "" : "s"}`;
    case "deploy.execution_facts": return `${packages.filter((item) => item.installed > 0 || item.tested > 0).length} package${packages.length === 1 ? "" : "s"} with facts`;
    case "deploy.proof": return `${work.evidence?.length ?? 0} proof reference${work.evidence?.length === 1 ? "" : "s"}`;
    case "deploy.acceptance": return `${packages.filter((item) => item.status === "accepted").length} of ${packages.length} packages accepted`;
    case "operate.service_actions": return `${work.lifecycle?.length ?? 0} lifecycle action${work.lifecycle?.length === 1 ? "" : "s"}`;
    case "operate.value": return work.commercial?.condition || work.value;
    default: return "Work Record context";
  }
}

function PhaseRegister({ work, phase, component, onSave, onRemove }: {
  work: PhaseWork; phase: PhaseDefinition; component: PhaseComponent;
  onSave: (key: string, row: Record<string, string>, index: number | null) => void;
  onRemove: (key: string, index: number) => void;
}) {
  const registerKey = `${phase.key}.${component.key}`;
  const rows = work.phaseRegisters?.[registerKey] ?? [];
  const [editing, setEditing] = useState<number | null>(null);
  const fields = component.fields ?? [];
  const selected = editing === null ? null : rows[editing] ?? null;
  const packageReference = (key: string) => registerKey === "design.verification_plan" && key === "package";
  const displayValue = (fieldKey: string, value: string | undefined) => {
    if (!value || !packageReference(fieldKey)) return value ?? "";
    return work.packages?.find((item) => item.id === value)?.name ?? `${value} · unlinked package reference`;
  };
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = new FormData(form);
    const row = Object.fromEntries(fields.map((field) => [field.key, String(input.get(field.key) ?? "").trim()]));
    if (fields.some((field) => field.required && !row[field.key])) return;
    onSave(registerKey, row, editing);
    setEditing(null);
    form.reset();
  }
  return <div className={styles.register}>
    {rows.length ? <div className={styles.rows}>{rows.map((row, index) => <article key={`${registerKey}-${index}`}><div><strong>{displayValue(fields[0]?.key, row[fields[0]?.key]) || `${component.label} ${index + 1}`}</strong><span>{fields.slice(1).map((field) => displayValue(field.key, row[field.key])).filter(Boolean).join(" · ")}</span></div><div><button type="button" onClick={() => setEditing(index)}>Edit</button><button type="button" onClick={() => { onRemove(registerKey, index); if (editing === index) setEditing(null); }}>Remove</button></div></article>)}</div> : <p>No {component.label.toLowerCase()} recorded on this Work Record.</p>}
    {fields.length ? <form key={`${registerKey}:${editing ?? "new"}`} onSubmit={submit}><div className={styles.fields}>{fields.map((field) => <label key={field.key}>{field.label}{packageReference(field.key) ? <select name={field.key} defaultValue={selected?.[field.key] ?? ""} required={field.required} disabled={!work.packages?.length}><option value="">Select a Work Package</option>{(work.packages ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : field.kind === "select" ? <select name={field.key} defaultValue={selected?.[field.key] ?? ""} required={field.required}><option value="">Select</option>{(field.options ?? []).map((option) => <option key={option}>{option}</option>)}</select> : <input name={field.key} type={field.kind === "date" ? "date" : "text"} defaultValue={selected?.[field.key] ?? ""} required={field.required} />}</label>)}</div>{registerKey === "design.verification_plan" && !work.packages?.length ? <p>Create a controlled Work Package in Design before adding its verification plan.</p> : null}<div className={styles.formActions}><button type="submit" disabled={registerKey === "design.verification_plan" && !work.packages?.length}>{editing === null ? `Add ${component.label.toLowerCase()}` : "Save changes"}</button>{editing !== null ? <button type="button" onClick={() => setEditing(null)}>Cancel</button> : null}</div></form> : <p>This exact configuration version has no structured input for this component. Its published definition must be revised before entries can be captured.</p>}
  </div>;
}

export function WorkPhaseActions({ config, phase, work, currentTab, currentDecision, demandCount, assignmentCount, onTab, onSave, onRemove }: {
  config: WorkTypeConfiguration; phase: PhaseDefinition; work: PhaseWork; currentTab: Target;
  currentDecision: { label: string; profile: string; checks: DecisionCheckResult[] } | null;
  demandCount: number; assignmentCount: number; onTab: (tab: Target) => void;
  onSave: (key: string, row: Record<string, string>, index: number | null) => void;
  onRemove: (key: string, index: number) => void;
}) {
  const phaseChecks = currentDecision?.checks.filter(({ check }) => decisionCheckPhase(check) === phase.key) ?? [];
  const openChecks = phaseChecks.filter((item) => !item.met);
  const needsInput = (component: PhaseComponent) => ["design.verification_plan", "operate.handoff"].includes(`${phase.key}.${component.key}`);
  const actionable = phase.components.filter((component) => needsInput(component) || (targets[`${phase.key}.${component.key}`] && targets[`${phase.key}.${component.key}`] !== currentTab));
  const context = phase.components.filter((component) => !actionable.includes(component));
  const renderAction = (component: PhaseComponent) => {
    const key = `${phase.key}.${component.key}`;
    const target = targets[key];
    return <article key={component.key}><div><small>{component.kind.replaceAll("_", " ")}</small><strong>{component.label}</strong><p>{component.help}</p>{needsInput(component) ? <PhaseRegister work={work} phase={phase} component={component} onSave={onSave} onRemove={onRemove} /> : <span>{status(work, key, demandCount, assignmentCount)}</span>}</div>{target && target !== currentTab ? <button type="button" onClick={() => onTab(target)}>Open {target} →</button> : null}</article>;
  };
  return <section className={styles.panel} aria-label={`${phase.label} work controls`}>
    <header><div><p>{phase.label.toUpperCase()} · WORK TYPE</p><h2>{phase.purpose}</h2><span>{config.workTypeLabel} · {config.version === "prototype-v1" ? "Legacy reference" : "Published phase form"}</span></div><b>{phase.gate}</b></header>
    {phaseChecks.length ? <div className={`${styles.decisionStatus} ${openChecks.length ? styles.hasOpenChecks : styles.allChecksMet}`} aria-label={`${phase.label} current decision checks`}><div><small>CURRENT DECISION · {currentDecision?.label}</small><strong>{openChecks.length ? `${openChecks.length} action${openChecks.length === 1 ? "" : "s"} needed in this phase` : "This phase's current decision checks are met"}</strong><span>Decision profile: {currentDecision?.profile}</span></div><ul>{phaseChecks.map(({ check, met }, index) => <li className={met ? styles.metCheck : styles.openCheck} key={`${check.op}-${check.key ?? check.field ?? check.evidenceKind ?? index}`}><span aria-hidden="true">{met ? "✓" : "!"}</span><p>{check.message}</p><b>{met ? "Met" : check.surface === currentTab ? "Complete below" : `Open ${check.surface}`}</b>{!met && check.surface !== currentTab ? <button type="button" onClick={() => onTab(check.surface)}>Open {check.surface} →</button> : null}</li>)}</ul></div> : null}
    <div className={styles.items}>{actionable.map(renderAction)}</div>
    {context.length ? <details className={styles.context}><summary>Other {phase.label} context</summary><div>{context.map((component) => <article key={component.key}><strong>{component.label}</strong><span>{status(work, `${phase.key}.${component.key}`, demandCount, assignmentCount)}</span><small>{component.help}</small></article>)}</div></details> : null}
    <footer><details><summary>Form source and decision ownership</summary><p>Pinned configuration version: {config.version}. Release, acceptance and phase decisions require the separate authorized review for this Work Record.</p></details></footer>
  </section>;
}
