import type { DiscoveryRecord, WorkRecord } from "./work-types";
import { assessmentBasis } from "./discover-decision";

export type Pursuit = NonNullable<DiscoveryRecord["pursuitControl"]>;
export type PursuitCommand =
  | { kind: "save"; expected: number; actor: string; fields: Pick<Pursuit, "requester" | "intendedOutcome" | "roughValue" | "currency" | "requiredDate" | "knownRisk">; workFields: { customer: string; site: string; owner: string; need: string } }
  | { kind: "submit"; expected: number; actor: string }
  | { kind: "decide"; expected: number; actor: string; outcome: "returned" | "qualified" | "held" | "declined"; reason: string }
  | { kind: "request-spend"; expected: number; actor: string; cap: number; purpose: string }
  | { kind: "decide-spend"; expected: number; actor: string; outcome: "authorized" | "returned"; reason: string }
  | { kind: "submit-handoff"; expected: number; actor: string; brief: string }
  | { kind: "respond-handoff"; expected: number; actor: string; outcome: "accepted" | "returned"; reason: string };

export const blankPursuit = (): Pursuit => ({
  revision: 0, status: "draft", requester: "", intendedOutcome: "", roughValue: "", currency: "USD", requiredDate: "", knownRisk: "",
  spend: { status: "not_requested", cap: 0, purpose: "" },
  handoff: { status: "not_started", receiver: "", brief: "", revision: 0 }, history: [],
});

export function applyPursuitCommand(work: WorkRecord, command: PursuitCommand): { work?: WorkRecord; error?: string } {
  const discovery = work.discovery;
  if (!discovery) return { error: "This Work Record has no Discover intake." };
  const prior = discovery.pursuitControl ?? blankPursuit();
  if (command.expected !== prior.revision) return { error: "This intake changed. Reopen it before deciding; your draft is still visible." };
  if (!command.actor.trim()) return { error: "An identified actor is required." };
  const at = new Date().toISOString();
  let next: Pursuit = { ...prior, revision: prior.revision + 1 };
  let action = "", note = "", nextAction = work.nextAction, fit = discovery.fit;
  let correctedWork = work;
  let correctedNeed = discovery.need;
  if (command.kind === "save") {
    if (!["draft", "returned", "held"].includes(prior.status)) return { error: "This decision is closed. Start a governed correction before editing it." };
    const f = command.fields;
    if (!f.requester.trim() || !f.intendedOutcome.trim() || !Number.isFinite(Number(f.roughValue)) || Number(f.roughValue) <= 0
      || !/^[A-Z]{3}$/.test(f.currency) || !/^\d{4}-\d{2}-\d{2}$/.test(f.requiredDate)
      || Number.isNaN(new Date(`${f.requiredDate}T12:00:00Z`).getTime()) || !f.knownRisk.trim()
      || !command.workFields.customer.trim() || !command.workFields.site.trim() || !command.workFields.owner.trim()
      || command.workFields.owner.trim() === "Unassigned" || !command.workFields.need.trim())
      return { error: "Complete customer, site, accountable owner, need, requester, outcome, rough value, currency, required date and risk." };
    next = { ...next, ...f, status: "draft" };
    fit = "Unassessed";
    correctedWork = { ...work, customer: command.workFields.customer.trim(), site: command.workFields.site.trim(), owner: command.workFields.owner.trim() };
    correctedNeed = command.workFields.need.trim();
    action = prior.status === "returned" || prior.status === "held" ? "Intake corrected" : "Intake saved";
    note = f.intendedOutcome; nextAction = "Submit intake for pursuit decision";
  } else if (command.kind === "submit") {
    if (prior.status !== "draft" || !prior.requester || !prior.intendedOutcome || !prior.roughValue || !prior.requiredDate || !prior.knownRisk || !work.customer || !work.site || !work.owner || work.owner === "Unassigned" || !discovery.need || !work.phaseConfigurationVersionId) return { error: "Complete the intake, customer/site, accountable owner and pinned Work Type before submission." };
    next = { ...next, status: "submitted", submission: { revision: next.revision, at, actor: command.actor } };
    action = "Pursuit decision requested"; note = `Intake revision ${next.revision}`; nextAction = "Qualification authority: decide pursuit";
  } else if (command.kind === "decide") {
    if (prior.status !== "submitted" || !prior.submission) return { error: "Submit an intake revision before recording a pursuit decision." };
    if (command.reason.trim().length < 10) return { error: "Give a decision reason of at least 10 characters." };
    const assessment = discovery.crm?.assessmentHistory.at(-1);
    if (command.outcome === "qualified" && discovery.crm && (discovery.crm.disqualifier !== "None" || !assessment || assessment.basis !== assessmentBasis(work) || !["Pursue", "Pursue with conditions"].includes(assessment.recommendation))) return { error: "A current positive assessment without a restriction is required before qualification." };
    next = { ...next, status: command.outcome, decision: { revision: prior.submission.revision, outcome: command.outcome, reason: command.reason.trim(), at, actor: command.actor, assessmentRevision: assessment?.revision, recommendation: assessment?.recommendation, policyVersion: assessment?.policyVersion } };
    fit = command.outcome === "qualified" ? "Qualified" : command.outcome === "declined" ? "Disqualified" : "Unassessed";
    action = `Pursuit ${command.outcome}`; note = command.reason.trim();
    nextAction = command.outcome === "qualified" ? "Request bounded pursuit spend or send Define handoff" : command.outcome === "declined" ? "Retain decline reason and close pursuit" : "Correct intake and resubmit";
  } else if (command.kind === "request-spend") {
    if (prior.status !== "qualified") return { error: "Pursuit qualification is required before requesting spend." };
    if (!Number.isFinite(command.cap) || command.cap <= 0 || !command.purpose.trim()) return { error: "Enter a positive spend cap and purpose." };
    next = { ...next, spend: { status: "requested", cap: command.cap, purpose: command.purpose.trim(), actor: command.actor, at } };
    action = "Pursuit spend requested"; note = `${command.cap} ${prior.currency} · ${command.purpose.trim()}`; nextAction = "Investment authority: decide bounded pursuit spend";
  } else if (command.kind === "decide-spend") {
    if (prior.status !== "qualified" || prior.spend?.status !== "requested") return { error: "No bounded pursuit spend request is awaiting decision." };
    if (command.reason.trim().length < 10) return { error: "Give a spend decision reason of at least 10 characters." };
    next = { ...next, spend: { ...prior.spend, status: command.outcome, reason: command.reason.trim(), actor: command.actor, at } };
    action = `Pursuit spend ${command.outcome}`; note = command.reason.trim(); nextAction = "Prepare accepted Define handoff";
  } else if (command.kind === "submit-handoff") {
    if (prior.status !== "qualified" || prior.handoff?.status === "accepted") return { error: "A qualified pursuit without an accepted handoff is required." };
    if (command.brief.trim().length < 20) return { error: "Provide a receiving brief of at least 20 characters." };
    next = { ...next, handoff: { status: "submitted", receiver: "Configured receiver queue", brief: command.brief.trim(), revision: (prior.handoff?.revision ?? 0) + 1, actor: command.actor, at } };
    action = "Define handoff submitted"; note = "Configured receiver queue"; nextAction = "Define receiver queue: accept or return the brief";
  } else {
    if (prior.handoff?.status !== "submitted") return { error: "No Define handoff is awaiting a receiver." };
    if (command.actor.trim().toLocaleLowerCase() === prior.handoff.actor?.trim().toLocaleLowerCase())
      return { error: "A separate receiver must accept or return this brief." };
    if (command.reason.trim().length < 10) return { error: "Give an acceptance or return reason of at least 10 characters." };
    next = { ...next, handoff: { ...prior.handoff, status: command.outcome, reason: command.reason.trim(), actor: command.actor, at } };
    action = `Define handoff ${command.outcome}`; note = command.reason.trim(); nextAction = command.outcome === "accepted" ? "Define owner: establish scope baseline" : "Pursuit owner: correct Define brief";
  }
  next.history = [...prior.history, { revision: next.revision, action, actor: command.actor, at, note }];
  return { work: { ...correctedWork, nextAction, discovery: { ...discovery, need: correctedNeed, fit, pursuitControl: next }, history: [`${at} · ${action} by ${command.actor}: ${note}`, ...work.history] } };
}
