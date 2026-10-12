import { dateKeyForSchedule, publishedWeekStatus, type SharedSchedule } from "./schedule-model";
import { actionDueLabel, actionImpactLabel, compareActionPriority, type ActionImpact, type ActionPriority } from "./action-priority";
import { configuredTransitionsFor, roleLabel } from "./lifecycle-profiles";
import type { ConnectedWorkPosition } from "./connected-work-position";

type WorkLike = ActionPriority & {
  id: string;
  workspace: "rybex" | "rotork";
  title: string;
  customer: string;
  site: string;
  stage: string;
  owner: string;
  nextAction: string;
  value: string;
  status: "attention" | "moving" | "complete";
  blockers: string[];
  packages?: { id: string; name: string; status: string }[];
};

export function OperationalHome<T extends WorkLike>({ workspaceName, currentOwner, ownedIds, actions, work, schedule, scheduleWeek, onOpenDecision, onPortfolio, onConditions, onAssignedToYou, onMyWork, onCrewCoverage, onCrewAttendance, getBlockers, currentPosition }: {
  workspaceName: string;
  currentOwner: string;
  ownedIds?: string[];
  actions: T[];
  work: T[];
  schedule: SharedSchedule | null;
  scheduleWeek: number;
  onOpenDecision: (item: T) => void;
  onPortfolio: () => void;
  onConditions: () => void;
  onAssignedToYou: () => void;
  onMyWork: () => void;
  onCrewCoverage: () => void;
  onCrewAttendance: () => void;
  getBlockers: (item: T) => string[];
  currentPosition: (item: T) => ConnectedWorkPosition | null;
}) {
  const owned = ownedIds ? new Set(ownedIds) : null;
  const isMine = (item: T) => owned ? owned.has(item.id) : item.owner === currentOwner;
  const mine = actions.filter(isMine)
    .sort((left, right) => compareActionPriority(left, right) || left.title.localeCompare(right.title));
  const lead = mine[0];
  const leadPosition = lead ? currentPosition(lead) : null;
  const leadBlockers = leadPosition ? leadPosition.warning ? [leadPosition.warning] : [] : lead ? getBlockers(lead) : [];
  const leadTransitions = lead && !leadPosition ? configuredTransitionsFor(lead.workspace, lead.stage).map((transition) => `${transition.label} · ${roleLabel(lead.workspace, transition.role)}`) : [];
  const holds = work.filter((item) => item.status !== "complete" && (currentPosition(item)?.warning ? true : !currentPosition(item) && getBlockers(item).length > 0));
  const weekStart = schedule ? dateKeyForSchedule(schedule.anchorDate, scheduleWeek, 0) : "";
  const weekEnd = schedule ? dateKeyForSchedule(schedule.anchorDate, scheduleWeek, 4) : "";
  const uncovered = schedule?.packageDemands.flatMap((demand) => {
    const record = work.find((item) => item.id === demand.workId);
    const workPackage = record?.packages?.find((item) => item.id === demand.packageId);
    if (!record || !workPackage || workPackage.status === "accepted" || demand.crewSchedulable === false) return [];
    return demand.requiredSlots.filter((slot) => slot.date >= weekStart && slot.date <= weekEnd).flatMap((slot) => {
      const people = new Set(schedule.assignments.filter((item) => item.week === scheduleWeek && item.workId === demand.workId && item.packageId === demand.packageId && item.date === slot.date && item.shift === slot.shift).flatMap((item) => item.people));
      return people.size < demand.minimumPeople ? [{ demand, slot, record, packageName: workPackage.name, missing: demand.minimumPeople - people.size }] : [];
    });
  }) ?? [];
  const declined = schedule ? publishedWeekStatus(schedule, scheduleWeek).cannotAttend.filter(({ assignment, recipient }) => schedule.assignments.some((item) => item.id === assignment.id && item.people.includes(recipient))) : [];
  const demandImpact = (workId: string, packageId: string): ActionImpact | null => {
    const priority = schedule?.packageDemands.find((item) => item.workId === workId && item.packageId === packageId)?.priority;
    return priority === "Normal" ? "Standard" : priority ?? null;
  };
  const exceptions: (ActionPriority & { id: string; label: string; title: string; context: string; detail: string; action: string; open: () => void })[] = [
    ...declined.map(({ assignment, recipient }) => ({ id: `receipt-${assignment.id}-${recipient}`, nextActionDue: assignment.date, nextActionImpact: demandImpact(assignment.workId, assignment.packageId), label: "CREW RESPONSE", title: `${recipient} cannot attend`, context: `${assignment.crew} · ${assignment.date} ${assignment.shift}`, detail: "A replacement or schedule change needs the scheduler.", action: "Resolve in Crew Schedule →", open: onCrewAttendance })),
    ...holds.filter((item) => !isMine(item)).map((item) => ({ id: `hold-${item.id}`, nextActionDue: item.nextActionDue, nextActionImpact: item.nextActionImpact, label: "WORK CONDITION", title: item.title, context: `${currentPosition(item)?.label ?? item.stage} · ${item.owner}`, detail: currentPosition(item)?.warning ?? getBlockers(item)[0], action: "Open condition →", open: () => onOpenDecision(item) })),
    ...uncovered.map(({ demand, slot, record, packageName, missing }) => ({ id: `coverage-${demand.packageId}-${slot.date}-${slot.shift}`, nextActionDue: slot.date, nextActionImpact: demand.priority === "Normal" ? "Standard" as const : demand.priority, label: "CREW COVERAGE", title: packageName, context: `${record.title} · ${slot.date} ${slot.shift}`, detail: `${missing} more qualified ${missing === 1 ? "person" : "people"} required for this shift.`, action: "Staff in Crew Schedule →", open: onCrewCoverage })),
  ].sort((left, right) => compareActionPriority(left, right) || left.title.localeCompare(right.title));

  return <section className="d5o-ops-home d5o-hub">
    <header className="d5o-ops-heading"><div><p>WORK HUB · {workspaceName.toUpperCase()}</p><h1>What needs attention now</h1><span>{currentOwner} · your next action and the workspace exceptions that need coordination.</span></div></header>
    <section className="d5o-hub-status" aria-label="Actionable workspace status">
      <button type="button" onClick={onAssignedToYou} disabled={!mine.length}><strong>{mine.length}</strong><span>Assigned to you</span><small>{mine.length ? "Open assigned actions →" : "No action assigned"}</small></button>
      <button type="button" onClick={onConditions} disabled={!holds.length}><strong>{holds.length}</strong><span>Work with open conditions</span><small>{holds.length ? "Review affected work →" : "No open condition"}</small></button>
      <button type="button" onClick={onCrewCoverage} disabled={!schedule || !uncovered.length}><strong>{schedule ? uncovered.length : "—"}</strong><span>Required shifts short of crew</span><small>{!schedule ? "Crew plan not loaded" : uncovered.length ? "Staff required shifts →" : "No shift needs staffing"}</small></button>
      <button type="button" onClick={onCrewAttendance} disabled={!schedule || !declined.length}><strong>{schedule ? declined.length : "—"}</strong><span>Workers unable to attend</span><small>{!schedule ? "Crew plan not loaded" : declined.length ? "Resolve responses →" : "No response needs action"}</small></button>
    </section>
    <div className="d5o-hub-layout">
      <section className="d5o-ops-panel d5o-hub-mine"><header><div><p>YOUR RESPONSIBILITY</p><h2>Next action</h2><small className="d5o-hub-sort-rule">Earliest due date first; impact breaks ties. Undated actions follow.</small></div><button type="button" onClick={onMyWork}>All my work →</button></header>
        {lead ? <div className="d5o-hub-focus"><span className={leadBlockers.length ? "is-held" : ""}>{leadBlockers.length ? "CONDITION OPEN" : leadPosition ? "CURRENT POSITION" : "READY FOR REVIEW"} · {leadPosition?.label ?? lead.stage}</span><h3>{leadPosition?.nextAction ?? lead.nextAction}</h3><p>{lead.title} · {lead.customer}</p><p className="d5o-hub-priority">{actionDueLabel(lead.nextActionDue)} <span>·</span> {actionImpactLabel(lead.nextActionImpact)}</p>{leadTransitions.length ? <p className="d5o-hub-configured-decision"><strong>Configured decision</strong>{leadTransitions.join(" / ")}</p> : null}<div className="d5o-hub-focus-context"><strong>{leadBlockers.length ? "Why it cannot advance" : "Why it is here"}</strong><p>{leadBlockers[0] || (leadPosition ? "Use My Work for the exact eligible action and current revision." : "The accountable decision is ready for review.")}</p><strong>Value connected to this work</strong><p>{leadPosition?.value ?? lead.value}</p></div><button className="d5o-primary" type="button" onClick={() => onOpenDecision(lead)}>{leadBlockers.length ? "Resolve condition in Work Record →" : leadPosition ? "Open current Work Record →" : "Review decision in Work Record →"}</button></div> : <div className="d5o-hub-clear"><strong>No action assigned to you here</strong><p>Other workspace conditions are shown alongside. Open My work for the complete action list.</p></div>}
        {mine.slice(1, 3).map((item) => <button className="d5o-hub-more-action" type="button" key={item.id} onClick={() => onOpenDecision(item)}><span><strong>{currentPosition(item)?.nextAction ?? item.nextAction}</strong><small>{item.title} · {currentPosition(item)?.warning ?? (currentPosition(item) ? "Current committed phase position" : getBlockers(item)[0] || "Ready for review")}</small><small>{actionDueLabel(item.nextActionDue)} · {actionImpactLabel(item.nextActionImpact)}</small></span><b>Review →</b></button>)}
      </section>
      <section className="d5o-ops-panel d5o-hub-exceptions"><header><div><p>WORKSPACE COORDINATION</p><h2>Exceptions needing action</h2><small className="d5o-hub-sort-rule">Sorted by required date, then configured or recorded impact.</small></div><span>{exceptions.length} open</span></header>
        {exceptions.slice(0, 4).map((item) => <button type="button" key={item.id} onClick={item.open}><span className="d5o-hub-exception-label">{item.label}</span><strong>{item.title}</strong><small>{item.context}</small><small className="d5o-hub-priority">{actionDueLabel(item.nextActionDue)} · {actionImpactLabel(item.nextActionImpact)}</small><em>{item.detail}</em><b>{item.action}</b></button>)}
        {!exceptions.length ? <div className="d5o-hub-clear"><strong>No coordination exception in view</strong><p>Use Portfolio to browse all Work Records or Crew Schedule to review the complete plan.</p></div> : null}
        {exceptions.length > 4 ? <p className="d5o-hub-overflow">{exceptions.length - 4} more exception{exceptions.length - 4 === 1 ? "" : "s"} remain in their owning views.</p> : null}
      </section>
    </div>
    <nav className="d5o-hub-routes" aria-label="Full worksurfaces"><span>Need the full picture?</span><button type="button" onClick={onPortfolio}>Browse Portfolio →</button><button type="button" onClick={onMyWork}>Open My work →</button><button type="button" onClick={onCrewCoverage}>Open Crew Schedule →</button></nav>
  </section>;
}
