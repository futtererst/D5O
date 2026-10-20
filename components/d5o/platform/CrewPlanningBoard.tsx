"use client";

import { type DragEvent, type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { assignmentAssessment, currentScheduleWeek, dateForSchedule, dateKeyForSchedule, personHours, personUnavailable, publishedWeekStatus, reconcileBookingDemand, replacementCandidates, scheduleDemand, shiftHours, weekdays, type Assignment, type CrewDemandSlot, type PackageCrewDemand, type PersonProfile, type ScheduleDemand, type ScheduleWork, type WorkspaceKey } from "./schedule-model";
import { ScheduleDemandQueue } from "./ScheduleDemandQueue";
import { SchedulePublicationPanel } from "./SchedulePublicationPanel";
import { AvailabilityEditor } from "./AvailabilityEditor";
import type { useSharedSchedule } from "./useSharedSchedule";

const shortDate = (date: Date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const shiftTimes = (shift: string) => { const [start = "07:00", end = "15:30"] = shift.split(/[–-]/); return { start, end }; };

function ScheduleIssueDetail({ candidate, work, assessment, onReviewWork }: {
  candidate: Assignment;
  work: ScheduleWork[];
  assessment: ReturnType<typeof assignmentAssessment>;
  onReviewWork: () => void;
}) {
  if (!assessment.issues.length && assessment.release !== "Release held" && assessment.release !== "Planning only" && assessment.release !== "Awaiting acceptance") return null;
  return <section className="d5o-schedule-resolution" aria-label="Schedule resolution">
    <h3>{assessment.issues.length ? "Resolve before saving" : "Release decision remains separate"}</h3>
    {assessment.issues.length ? <ul>{assessment.issues.map((issue, index) => <li key={`${issue.kind}:${issue.person ?? "package"}:${index}`}><strong>{issue.message}</strong><span>{issue.action}</span></li>)}</ul> : null}
    {assessment.release === "Release held" || assessment.release === "Planning only" || assessment.release === "Awaiting acceptance" ? <p><strong>{assessment.release}.</strong> {assessment.releaseDetail} Next: {assessment.nextDecision} · {assessment.decisionOwner}.</p> : null}
    {work.some((item) => item.id === candidate.workId) ? <div><button type="button" onClick={onReviewWork}>Open Work Record decision →</button></div> : null}
  </section>;
}

export function CrewPlanningBoard({ workspaceKey, work, workReady, profiles, onOpen, onOpenDecision, shared, entryFocus = null, focusWorkId = null }: { workspaceKey: WorkspaceKey; work: ScheduleWork[]; workReady: boolean; profiles: PersonProfile[]; onOpen: (item: ScheduleWork) => void; onOpenDecision: (item: ScheduleWork) => void; shared: ReturnType<typeof useSharedSchedule>; entryFocus?: "coverage" | "attendance" | null; focusWorkId?: string | null }) {
  const assignments = shared.schedule?.assignments ?? [];
  const packageDemands = shared.schedule?.packageDemands ?? [];
  const anchor = shared.schedule?.anchorDate ?? "";
  const [week, setWeek] = useState<number | null>(null);
  const visibleWeek = week ?? (anchor ? currentScheduleWeek(anchor) : 0);
  const dateFor = (offset: number, day: number) => anchor ? dateForSchedule(anchor, offset, day) : new Date();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [showAllDemand, setShowAllDemand] = useState(false);
  const [detailsTab, setDetailsTab] = useState<"booking" | "publication" | "overview" | "editor" | "availability">("overview");
  const [returnTab, setReturnTab] = useState<"booking" | "publication" | "overview" | "editor">("overview");
  const [absencePerson, setAbsencePerson] = useState("");
  const [absenceDay, setAbsenceDay] = useState(0);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const [people, setPeople] = useState<string[]>([]);
  const [crewName, setCrewName] = useState("");
  const [message, setMessage] = useState("");
  const [savingCrew, setSavingCrew] = useState(false);
  const [selectedDay, setSelectedDay] = useState(0);
  const [selectedShift, setSelectedShift] = useState("07:00–15:30");
  const [personHoursPerWorker, setPersonHoursPerWorker] = useState("");
  const [sourceSlot, setSourceSlot] = useState<CrewDemandSlot | null>(null);
  const [selectedPackage, setSelectedPackage] = useState("");
  const [showAllPeople, setShowAllPeople] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [draggingId, setDraggingId] = useState("");
  const [dropTarget, setDropTarget] = useState("");
  const [pendingMove, setPendingMove] = useState<Assignment | null>(null);
  const moveDialogRef = useRef<HTMLElement>(null);
  const moveOpen = Boolean(pendingMove);

  useEffect(() => {
    if (!shared.schedule || !entryFocus) return;
    const frame = requestAnimationFrame(() => document.getElementById(entryFocus === "coverage" ? "d5o-crew-coverage" : "d5o-crew-attendance")?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [entryFocus, shared.schedule]);
  useEffect(() => { if (moveOpen) moveDialogRef.current?.focus({ preventScroll: true }); }, [moveOpen]);
  useEffect(() => {
    if (!detailsOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawerCloseRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [detailsOpen]);

  const packageOptions = work.flatMap((record) => (record.packages ?? []).filter((entry) => {
    const requirement = packageDemands.find((demand) => demand.packageId === entry.id);
    return entry.status !== "accepted" && requirement?.crewSchedulable !== false && (!requirement || requirement.requiredSlots.some((slot) => slot.date >= dateKeyForSchedule(anchor, visibleWeek, 0) && slot.date <= dateKeyForSchedule(anchor, visibleWeek, 4)));
  }).map((entry) => ({ workId: record.id, packageId: entry.id, label: `${record.title} — ${entry.name}` })));
  const demand = scheduleDemand(work, assignments, visibleWeek, packageDemands, anchor);
  const focusedWork = focusWorkId ? work.find((item) => item.id === focusWorkId) : null;
  const visibleDemand = focusedWork && !showAllDemand ? demand.filter((item) => item.workId === focusWorkId) : demand;
  const visibleAssignments = assignments.filter((item) => item.week === visibleWeek);
  const publishedStatus = shared.schedule ? publishedWeekStatus(shared.schedule, visibleWeek) : null;
  const currentCannotAttend = publishedStatus?.cannotAttend.filter(({ assignment, recipient }) => visibleAssignments.some((item) => item.id === assignment.id && item.people.includes(recipient))) ?? [];
  const crews = [...new Set(visibleAssignments.map((item) => item.crew))];
  const assignedPeople = new Set(visibleAssignments.flatMap((item) => item.people));
  const assessed = visibleAssignments.map((item) => ({ item, assessment: assignmentAssessment(item, assignments, workspaceKey, work, profiles, packageDemands) }));
  const conflicts = assessed.filter(({ assessment }) => assessment.overlappingPeople.length > 0 || assessment.overCapacity.length > 0 || assessment.unavailablePeople.length > 0).length;
  const qualificationGaps = assessed.filter(({ assessment }) => assessment.unqualified.length > 0 || !assessment.requiredQualification).length;
  const releaseHeld = assessed.filter(({ assessment }) => ["Release held", "Planning only", "Awaiting acceptance", "Work/package unavailable"].includes(assessment.release));
  const uniqueReleaseHeld = releaseHeld.filter(({ item }, index) => releaseHeld.findIndex((candidate) => candidate.item.workId === item.workId && candidate.item.packageId === item.packageId) === index);
  const releasePending = uniqueReleaseHeld.length;
  const scheduledHours = visibleAssignments.reduce((sum, item) => sum + shiftHours(item.shift) * item.people.length, 0);
  const firstIssue = assessed.find(({ assessment }) => assessment.issues.length > 0);
  const estimateReview = demand.filter((item, index, all) => item.configured && item.scheduledPersonHours > item.estimatedPersonHours && all.findIndex((other) => other.packageId === item.packageId) === index);
  const selected = visibleAssignments.find((item) => item.id === selectedId);
  const selectedAssessment = selected ? assignmentAssessment(selected, assignments, workspaceKey, work, profiles, packageDemands) : null;
  const selectedWork = work.find((record) => record.id === selected?.workId);
  const pendingSource = assignments.find((item) => item.id === pendingMove?.id);
  const pendingRequirement = packageDemands.find((item) => item.workId === pendingMove?.workId && item.packageId === pendingMove?.packageId);
  const pendingRevisedDemand = !shared.requiresPublication && pendingMove && pendingSource && pendingRequirement
    ? reconcileBookingDemand(pendingRequirement, { date: pendingSource.date ?? "", shift: pendingSource.shift }, pendingMove, assignments.filter((item) => item.id !== pendingMove.id)) : null;
  const pendingDemands = pendingRevisedDemand ? [...packageDemands.filter((item) => item.packageId !== pendingRevisedDemand.packageId), pendingRevisedDemand] : packageDemands;
  const pendingAssessment = pendingMove ? assignmentAssessment(pendingMove, assignments, workspaceKey, work, profiles, pendingDemands) : null;
  const unchanged = Boolean(pendingMove && pendingSource && pendingMove.week === pendingSource.week && pendingMove.day === pendingSource.day && pendingMove.crew === pendingSource.crew && pendingMove.shift === pendingSource.shift && pendingMove.people.join("|") === pendingSource.people.join("|") && pendingMove.personHoursPerWorker === pendingSource.personHoursPerWorker);
  const chosenDemand = packageDemands.find((item) => `${item.workId}|${item.packageId}` === selectedPackage);
  const chosenDate = anchor ? dateKeyForSchedule(anchor, visibleWeek, selectedDay) : "";
  const editorSlotChange = Boolean(chosenDemand && sourceSlot && (sourceSlot.date !== chosenDate || sourceSlot.shift !== selectedShift));
  const editorSlotAllowed = Boolean(chosenDemand?.requiredSlots.some((slot) => slot.date === chosenDate && slot.shift === selectedShift));
  const editorRevisedDemand = !shared.requiresPublication && chosenDemand && sourceSlot ? reconcileBookingDemand(chosenDemand, sourceSlot,
    { id: "crew-preview", crew: "Preview", people: [], workId: chosenDemand.workId, packageId: chosenDemand.packageId, week: visibleWeek, day: selectedDay, date: chosenDate, shift: selectedShift }, assignments) : null;
  const editorDemands = editorRevisedDemand ? [...packageDemands.filter((item) => item.packageId !== editorRevisedDemand.packageId), editorRevisedDemand] : packageDemands;
  const qualifiedProfiles = chosenDemand ? profiles.filter((person) => person.qualifications.includes(chosenDemand.qualification)) : [];
  const editorChoices = chosenDemand ? profiles.map((person) => {
    const trial = assignmentAssessment({ id: "crew-preview", crew: "Preview", people: [person.name], workId: chosenDemand.workId, packageId: chosenDemand.packageId, week: visibleWeek, day: selectedDay, date: chosenDate, shift: selectedShift }, assignments, workspaceKey, work, profiles, editorDemands);
    const qualified = !trial.unqualified.includes(person.name);
    const dayBookings = assignments.filter((item) => item.week === visibleWeek && item.day === selectedDay && item.people.includes(person.name));
    const hours = personHours(assignments, person.name, visibleWeek);
    const reason = person.active === false ? "Inactive workforce profile" : person.bound === false ? "No confirmed account binding — planning only" : !qualified ? `Missing required skill: ${chosenDemand.qualification}` : trial.unavailablePeople.includes(person.name) ? personUnavailable(person, visibleWeek, selectedDay) ?? "Unavailable that day" : trial.overlappingPeople.includes(person.name) ? `Already booked that day: ${dayBookings.map((item) => `${item.crew} ${item.shift}`).join(", ")}` : trial.overCapacity.includes(person.name) ? `Weekly limit: ${hours}/${person.weeklyCapacityHours}h already booked` : "Eligible for this shift";
    return { person, qualified, reason, hours, dayBookings, eligible: person.active !== false && person.bound !== false && qualified && !trial.unavailablePeople.includes(person.name) && !trial.overlappingPeople.includes(person.name) && !trial.overCapacity.includes(person.name) };
  }) : [];
  const availableQualified = editorChoices.filter((choice) => choice.eligible);
  const allQualifiedAlreadyBooked = qualifiedProfiles.length > 0 && editorChoices.filter((choice) => choice.qualified).every((choice) => choice.reason.startsWith("Already booked that day:"));
  const existingPackageBooking = chosenDemand ? assignments.find((item) => item.workId === chosenDemand.workId && item.packageId === chosenDemand.packageId && item.week === visibleWeek && item.day === selectedDay && item.shift === selectedShift) : undefined;

  async function saveAssignments(next: Assignment[], success: string) {
    try { await shared.mutate({ action: "save-assignments", assignments: next }); setMessage(success); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : "Schedule save failed."); return false; }
  }
  async function saveBooking(assignment: Assignment, success: string, slot?: CrewDemandSlot) {
    if (shared.pending || shared.busy) { setMessage("Resolve the original schedule command before saving another booking."); return false; }
    if (shared.requiresPublication && !packageDemands.find((item) => item.workId === assignment.workId && item.packageId === assignment.packageId)?.requiredSlots.some((required) => required.date === assignment.date && required.shift === assignment.shift)) {
      setMessage("This date and shift are outside the current Design crew requirement. Revise the package basis before booking.");
      return false;
    }
    try { await shared.mutate({ action: "save-booking", assignment, sourceSlot: slot }); setMessage(success); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : "Schedule save failed."); return false; }
  }
  const visibleChoices = (showAllPeople ? editorChoices : editorChoices.filter((choice) => choice.qualified || people.includes(choice.person.name)))
    .sort((left, right) => Number(right.eligible) - Number(left.eligible) || Number(right.qualified) - Number(left.qualified) || left.person.name.localeCompare(right.person.name));

  function openAvailability(person = "", day = selectedDay) {
    if (!shared.canManageAvailability) return;
    setReturnTab(detailsTab === "availability" ? "overview" : detailsTab);
    setAbsencePerson(person);
    setAbsenceDay(day);
    setDetailsTab("availability");
    setDetailsOpen(true);
  }

  function planDemand(item: ScheduleDemand) {
    setSelectedPackage(`${item.workId}|${item.packageId}`);
    setSelectedDay([0, 1, 2, 3, 4].find((day) => dateKeyForSchedule(anchor, visibleWeek, day) === item.date) ?? 0);
    setSelectedShift(item.shift);
    setSourceSlot({ date: item.date, shift: item.shift });
    setPeople([]);
    setShowAllPeople(false);
    setDetailsTab("editor");
    setDetailsOpen(true);
    setMessage(`Schedule ${item.packageName}: choose ${item.minimumPeople}+ qualified people for ${item.date}, ${item.shift}. Scheduling remains separate from work release.`);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const crew = crewName.trim();
    const selection = packageOptions.find((item) => `${item.workId}|${item.packageId}` === selectedPackage);
    const day = Number(form.get("day"));
    const shift = selectedShift;
    if (!crew || !selection || !sourceSlot || !people.length || !Number.isInteger(day) || day < 0 || day > 4) {
      setMessage("Choose a crew, controlled package, day, and at least one named person.");
      return;
    }
    let serial = assignments.length + 1;
    while (assignments.some((item) => item.id === `crew-${workspaceKey}-${serial}`)) serial += 1;
    const candidate: Assignment = { id: `crew-${workspaceKey}-${serial}`, crew, people, workId: selection.workId, packageId: selection.packageId, week: visibleWeek, day, date: dateKeyForSchedule(anchor, visibleWeek, day), shift, personHoursPerWorker: Number(personHoursPerWorker) };
    if (!/^\d+(\.\d{1,2})?$/.test(personHoursPerWorker) || candidate.personHoursPerWorker! <= 0 || candidate.personHoursPerWorker! > 24) {
      setMessage("Enter estimated person-hours per worker, up to 24 hours."); return;
    }
    const demand = packageDemands.find((item) => item.workId === candidate.workId && item.packageId === candidate.packageId);
    if (!demand) { setMessage("This Work Package needs a configured crew requirement before it can be scheduled."); return; }
    const revisedDemand = shared.requiresPublication ? demand : reconcileBookingDemand(demand, sourceSlot, candidate, assignments);
    const assessment = assignmentAssessment(candidate, assignments, workspaceKey, work, profiles,
      [...packageDemands.filter((item) => item.packageId !== demand.packageId), revisedDemand]);
    if (assessment.errors.length) { setMessage(assessment.errors.join(" ")); return; }
    setSavingCrew(true);
    const saved = await saveBooking(candidate, `${people.length} people scheduled to ${crew} on ${weekdays[day]}. ${shared.requiresPublication ? "Publish this week's bookings in Plan details → Responses before workers can see them. " : "The booking was shared with assigned workers. "}${editorSlotChange && !shared.requiresPublication ? "The Work Package required slot was updated. " : ""}${assessment.release === "Release held" ? "Work release remains held; open the Work Record for the required decision." : "Saving the schedule does not release controlled work."}`, sourceSlot);
    setSavingCrew(false);
    if (!saved) return;
    setSelectedId(candidate.id);
    setPeople([]);
    setCrewName("");
    setPersonHoursPerWorker("");
    setDetailsOpen(false);
  }

  function proposeMove(assignment: Assignment, crew: string, day: number) {
    if (!shared.canEdit) return;
    const record = work.find((item) => item.id === assignment.workId);
    if (record?.packages?.find((item) => item.id === assignment.packageId)?.status === "accepted") {
      setMessage("This package is accepted. Its recorded assignment is historical; plan any additional execution as follow-on work.");
      return;
    }
    if (assignment.week === visibleWeek && assignment.crew === crew && assignment.day === day) return;
    setPendingMove({ ...assignment, crew, day, week: visibleWeek, date: dateKeyForSchedule(anchor, visibleWeek, day) });
    setMessage("");
  }

  function startDrag(event: DragEvent<HTMLElement>, assignment: Assignment) {
    event.dataTransfer.setData("text/plain", assignment.id);
    event.dataTransfer.effectAllowed = "move";
    setDraggingId(assignment.id);
    setSelectedId(assignment.id);
  }

  function drop(event: DragEvent<HTMLDivElement>, crew: string, day: number) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain") || draggingId;
    const assignment = visibleAssignments.find((item) => item.id === id);
    setDraggingId("");
    setDropTarget("");
    if (assignment) proposeMove(assignment, crew, day);
  }

  async function acknowledgeMove() {
    if (!pendingMove || !pendingSource) return;
    if (!pendingMove.personHoursPerWorker || pendingMove.personHoursPerWorker <= 0 || pendingMove.personHoursPerWorker > 24) {
      setMessage("Record the revised person-hours per worker before saving this assignment change."); return;
    }
    const assessment = assignmentAssessment(pendingMove, assignments, workspaceKey, work, profiles, pendingDemands);
    if (assessment.errors.length || unchanged) { setMessage(assessment.errors.join(" ") || "Choose a different crew or day."); return; }
    const placementChanged = pendingMove.week !== pendingSource.week || pendingMove.day !== pendingSource.day || pendingMove.crew !== pendingSource.crew;
    const peopleChanged = pendingMove.people.join("|") !== pendingSource.people.join("|");
    const timeChanged = pendingMove.shift !== pendingSource.shift;
    const hoursChanged = pendingMove.personHoursPerWorker !== pendingSource.personHoursPerWorker;
    if (!await saveBooking(pendingMove, `${pendingMove.crew}: ${placementChanged ? `moved from ${weekdays[pendingSource.day]} to ${weekdays[pendingMove.day]}` : "same day retained"}${timeChanged ? `; shift changed to ${pendingMove.shift}` : ""}${peopleChanged ? "; crew membership updated" : ""}${hoursChanged ? `; estimated effort changed to ${pendingMove.personHoursPerWorker} person-hours per worker` : ""}. Saved as a draft; publish the week before workers see the change and reserve the revised cost. ${assessment.release === "Release held" ? "Work release remains held pending the Work Record decision." : "This schedule change does not itself release work."}`)) return;
    setSelectedId(pendingMove.id);
    setPendingMove(null);
  }

  function closeDetails() {
    if (shared.pending) { setMessage("Keep this draft open until the original command is reconciled."); return; }
    setDetailsOpen(false);
    if (detailsTab === "editor") setMessage("");
  }
  function handleDetailsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { closeDetails(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(".d5o-schedule-drawer button:not([disabled]), .d5o-schedule-drawer a[href], .d5o-schedule-drawer select:not([disabled]), .d5o-schedule-drawer input:not([disabled])")]
      .filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  if (!shared.schedule || !workReady) return <section className="d5o-crew-concept d5o-schedule-workspace"><header className="d5o-crew-concept-head"><div><p>CREW SCHEDULE · {workspaceKey.toUpperCase()}</p><h1>Schedule crews and controlled work</h1><span>The shared crew plan and Work Records must load before staffing advice is shown.</span></div></header><div className="d5o-crew-load-state" role="status"><strong>{shared.error ? "Crew plan unavailable" : !workReady ? "Loading Work Records…" : "Loading the shared crew plan…"}</strong><span>{shared.error || "Checking the current workspace bookings, packages, dates, and publication."}</span>{shared.error ? <button onClick={() => shared.refresh().catch(() => undefined)}>Retry shared plan</button> : null}</div></section>;

  return <section className="d5o-crew-concept d5o-schedule-workspace">
    <header className="d5o-crew-concept-head"><div><p>CREW SCHEDULE · {workspaceKey === "rybex" ? "TECHNICAL DELIVERY" : "MODERNIZATION SERVICE"}</p><h1>Crew schedule</h1><span>{shared.requiresPublication ? "Choose qualified people, save the draft booking, then publish the week for worker response." : "Choose qualified people with their workload and conflicts in view. Saving shares the booking with workers for a response."}</span></div><div className="d5o-schedule-head-actions"><button type="button" onClick={() => { setDetailsTab("overview"); setDetailsOpen(true); }}>Plan details</button>{shared.canManageAvailability ? <button type="button" onClick={() => openAvailability("", 0)}>Record unavailability</button> : null}{shared.canEdit ? <button className="d5o-primary" onClick={() => { setSelectedPackage(""); setSourceSlot(null); setSelectedDay(0); setSelectedShift("07:00–15:30"); setPeople([]); setCrewName(""); setShowAllPeople(false); setMessage(""); setDetailsTab("editor"); setDetailsOpen(true); }}>+ Schedule crew</button> : null}</div></header>
    {shared.pending ? <section className="d5o-crew-message" role="status"><strong>{shared.busy ? "Schedule decision in progress." : "Schedule save outcome uncertain."}</strong> The original {shared.pending.action.replaceAll("-", " ")} input remains in this tab. Resolve it before another change. <button type="button" disabled={shared.busy} onClick={() => void shared.reconcilePending().catch(() => undefined)}>Check/retry original command</button></section> : null}
    {shared.stale ? <section className="d5o-crew-message" role="alert">Another scheduler changed the schedule. Keep your form input, load the current basis and compare before submitting a new decision. <button type="button" onClick={() => void shared.reviewCurrent().catch(() => undefined)}>Load current schedule</button></section> : null}

    {firstIssue ? <section className="d5o-schedule-action-strip" aria-label="Schedule actions"><button type="button" onClick={() => { setSelectedId(firstIssue.item.id); setDetailsTab("booking"); setDetailsOpen(true); }}><strong>{assessed.filter(({ assessment }) => assessment.issues.length > 0).length} booking{assessed.filter(({ assessment }) => assessment.issues.length > 0).length === 1 ? "" : "s"} need resolution</strong><span>Review people, skills, or shift conflicts →</span></button></section> : null}

    {message && !detailsOpen ? <p className="d5o-crew-message" role="status">{message}</p> : null}

    {currentCannotAttend.length ? <section className="d5o-attendance-queue" id="d5o-crew-attendance" aria-label="Crew attendance actions">
      <header><div><p>CREW RESPONSE · SCHEDULER ACTION</p><h2>{currentCannotAttend.length} person{currentCannotAttend.length === 1 ? "" : "s"} cannot attend</h2><span>These responses still affect a current booking. Save a replacement or schedule change to notify the affected crew.</span></div><b>CREW RESPONSE NEEDS ACTION</b></header>
      <div className="d5o-attendance-list">{currentCannotAttend.map(({ assignment, recipient }) => {
        const draft = assignments.find((item) => item.id === assignment.id);
        const stillBooked = Boolean(draft?.people.includes(recipient));
        const alternatives = draft && stillBooked ? replacementCandidates(draft, recipient, assignments, workspaceKey, work, profiles, packageDemands) : [];
        const record = work.find((item) => item.id === assignment.workId);
        const workPackage = record?.packages?.find((item) => item.id === assignment.packageId);
        return <article key={`${assignment.id}:${recipient}`}><div><strong>{recipient} · {assignment.crew}</strong><span>{assignment.date} · {assignment.shift} · {workPackage?.name ?? "Controlled package"}</span><small>{stillBooked ? `${alternatives.length} qualified, available replacement${alternatives.length === 1 ? "" : "s"} for this shift` : "This booking has changed; publish the revised week before newly assigned workers see it."}</small></div><div className="d5o-attendance-actions">{alternatives.slice(0, 3).map((person) => <button key={person.name} disabled={!shared.canEdit} onClick={() => { if (!draft) return; setSelectedId(draft.id); setPendingMove({ ...draft, people: draft.people.map((name) => name === recipient ? person.name : name) }); setMessage(`Review ${person.name} as a replacement for ${recipient}. Publishing the changed week shares it with assigned workers.`); }}>{person.displayName ?? person.name}<small>{personHours(assignments.filter((item) => item.id !== draft?.id), person.name, visibleWeek)}/{person.weeklyCapacityHours}h planned</small></button>)}{stillBooked && !alternatives.length && draft ? <button onClick={() => { setSelectedId(draft.id); setDetailsTab("booking"); setDetailsOpen(true); }}>Inspect booking →</button> : null}{record ? <button onClick={() => onOpen(record)}>Open Work Record →</button> : null}</div></article>;
      })}</div>
    </section> : null}

    {focusedWork ? <div className="d5o-crew-focus"><div><strong>Deploy · {focusedWork.title}</strong><span>{showAllDemand ? "All workspace demand is shown." : "Showing this Work Record’s package demand. The calendar still shows all crew bookings."}</span></div><a href={`/work/labor?workspace=${encodeURIComponent(workspaceKey)}&workId=${encodeURIComponent(focusedWork.id)}`}>Review labor authority →</a><button type="button" onClick={() => setShowAllDemand((current) => !current)}>{showAllDemand ? "Show this work only" : "Show all work"}</button></div> : null}
    <ScheduleDemandQueue demand={visibleDemand} assignments={assignments} anchorDate={anchor} week={visibleWeek} canEdit={shared.canEdit} onPlan={planDemand} onReviewPlan={(item) => { const booked = visibleAssignments.find((entry) => entry.workId === item.workId && entry.packageId === item.packageId); if (booked) { setSelectedId(booked.id); setDetailsTab("booking"); setDetailsOpen(true); } }} onOpenWork={(item) => { const record = work.find((entry) => entry.id === item.workId); if (record) onOpen(record); }} />

<section id="d5o-week-board" className="d5o-week-board"><header><div><p>WEEKLY CREW PLAN · ACTIONS</p><h2>Move or inspect bookings</h2></div><div className="d5o-week-controls"><button onClick={() => setWeek(visibleWeek - 1)} aria-label="Previous week">‹</button><strong>{shortDate(dateFor(visibleWeek, 0))} – {shortDate(dateFor(visibleWeek, 4))}</strong><button onClick={() => setWeek(visibleWeek + 1)} aria-label="Next week">›</button><button onClick={() => setWeek(null)}>Today</button></div></header><p className="d5o-week-scroll-hint">Drag a card to another day or crew. Select a card for details. Scroll right for later days →</p><div className="d5o-week-scroll"><div className="d5o-week-grid"><div className="d5o-week-colhead">CREW · QUALIFIED PEOPLE</div>{weekdays.map((day, index) => { const dayAssignments = visibleAssignments.filter((item) => item.day === index); const count = new Set(dayAssignments.flatMap((item) => item.people)).size; return <div className="d5o-week-colhead" key={day}>{day.toUpperCase()} <b>{shortDate(dateFor(visibleWeek, index))}</b><small>{count} people · {dayAssignments.reduce((sum, item) => sum + item.people.length * shiftHours(item.shift), 0)}h</small></div>; })}
      {crews.map((crew) => { const crewAssignments = visibleAssignments.filter((item) => item.crew === crew); const names = [...new Set(crewAssignments.flatMap((item) => item.people))]; return <div className="d5o-week-row" key={crew}><div className="d5o-week-crew"><i>{crew.split(" ").slice(0, 2).map((part) => part[0]).join("")}</i><strong>{crew}</strong><small>{names.length} people · {names.join(", ")}</small></div>{weekdays.map((day, index) => <div key={day} className={`d5o-week-cell d5o-schedule-dropzone ${dropTarget === `${crew}|${index}` ? "is-drop-target" : ""}`} onDragOver={(event) => { if (shared.canEdit && draggingId) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(`${crew}|${index}`); } }} onDragLeave={() => setDropTarget("")} onDrop={(event) => drop(event, crew, index)}>{crewAssignments.filter((item) => item.day === index).map((item) => { const record = work.find((candidate) => candidate.id === item.workId); const workPackage = record?.packages?.find((entry) => entry.id === item.packageId); const assessment = assignmentAssessment(item, assignments, workspaceKey, work, profiles, packageDemands); return <article key={item.id} draggable={shared.canEdit && workPackage?.status !== "accepted"} onDragStart={(event) => startDrag(event, item)} onDragEnd={() => { setDraggingId(""); setDropTarget(""); }} className={`d5o-schedule-card ${assessment.issues.length ? "is-conflict" : ""} ${assessment.release === "Release held" ? "is-blocked" : workPackage?.status === "accepted" ? "is-complete" : ""} ${selected?.id === item.id ? "is-selected" : ""} ${draggingId === item.id ? "is-dragging" : ""}`}><button className="d5o-schedule-card-main" onClick={() => { setSelectedId(item.id); setDetailsTab("booking"); setDetailsOpen(true); }}><span>{item.shift} · {item.people.length} people</span><strong>{workPackage?.name ?? "Controlled work"}</strong><small>{record?.title ?? "Work Record"}</small><em>{assessment.issues.length ? `${assessment.issues.length} planning issue${assessment.issues.length === 1 ? "" : "s"} · ${assessment.release}` : assessment.release}</em></button><button className="d5o-schedule-card-move" disabled={!shared.canEdit || workPackage?.status === "accepted"} title={workPackage?.status === "accepted" ? "Accepted package schedule is historical" : undefined} onClick={() => setPendingMove({ ...item })} aria-label={`Reschedule ${item.crew} on ${day}`}>Move</button></article>; })}{draggingId ? <span className="d5o-schedule-drop-cue">Drop to propose move</span> : null}</div>)}</div>; })}</div></div>{!crews.length ? <div className="d5o-ops-empty"><span>No crew bookings are planned for this week.</span><button type="button" disabled={!shared.canEdit} onClick={() => { setSelectedPackage(""); setPeople([]); setMessage(""); setDetailsTab("editor"); setDetailsOpen(true); }}>Schedule crew →</button></div> : null}</section>


    {detailsOpen ? <div className="d5o-schedule-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetails(); }} onKeyDown={handleDetailsKeyDown}><aside className="d5o-schedule-drawer" role="dialog" aria-modal="true" aria-labelledby="schedule-drawer-title"><header className="d5o-schedule-drawer-head"><div><p>CREW SCHEDULE · {detailsTab === "editor" ? "NEW ASSIGNMENT" : "SUPPORTING DETAILS"}</p><h2 id="schedule-drawer-title">{detailsTab === "editor" ? "Schedule crew" : detailsTab === "booking" ? "Booking details" : detailsTab === "publication" ? "Worker responses" : detailsTab === "availability" ? "Record unavailability" : "Plan overview"}</h2></div><button ref={drawerCloseRef} type="button" onClick={closeDetails} aria-label={detailsTab === "editor" ? "Close crew assignment" : "Close schedule details"}>×</button></header>{detailsTab === "overview" || detailsTab === "publication" ? <nav className="d5o-schedule-drawer-tabs" aria-label="Schedule details"><button type="button" className={detailsTab === "overview" ? "is-active" : ""} onClick={() => setDetailsTab("overview")}>Overview</button><button type="button" className={detailsTab === "publication" ? "is-active" : ""} onClick={() => setDetailsTab("publication")}>Responses</button></nav> : null}<div className="d5o-schedule-drawer-content">
      {shared.pending ? <section className="d5o-crew-message" role="status"><strong>{shared.busy ? "Schedule decision in progress." : "Schedule save outcome uncertain."}</strong> Keep this draft open and reconcile its original command. <button type="button" disabled={shared.busy} onClick={() => void shared.reconcilePending().catch(() => undefined)}>Check/retry original command</button></section> : null}
      {shared.stale ? <section className="d5o-crew-message" role="alert">Another scheduler changed the schedule. Compare your retained input with the current basis before a new decision. <button type="button" onClick={() => void shared.reviewCurrent().catch(() => undefined)}>Load current schedule</button></section> : null}
      {detailsTab === "overview" ? <><section className="d5o-schedule-pulse" aria-label="Schedule health"><article><span>CREW BOOKINGS</span><strong>{visibleAssignments.length}</strong><small>{assignedPeople.size} named people · {scheduledHours} person-hours this week</small></article><article className={qualificationGaps ? "has-risk" : ""}><span>QUALIFICATIONS</span><strong>{assessed.length - qualificationGaps}<small> / {assessed.length}</small></strong><small>Assignments meeting package requirements</small></article><article className={conflicts ? "has-risk" : ""}><span>PEOPLE CONFLICTS</span><strong>{conflicts}</strong><small>Unavailable, double-booked, or beyond capacity</small></article><article className={releasePending ? "has-risk" : ""}><span>NOT RELEASED</span><strong>{releasePending}</strong><small>Work Record conditions remain separate from staffing</small></article></section><section className="d5o-schedule-drawer-summary"><h3>Package demand</h3><p>{demand.filter((item) => item.configured).length} required date-and-shift slots this week. The main page shows only slots needing an assignment or correction.</p>{estimateReview.length ? <><h3>Estimate comparison</h3>{estimateReview.map((item) => <p key={item.workId + ":" + item.packageId}><strong>{item.packageName}</strong> · {item.scheduledPersonHours}h booked against {item.estimatedPersonHours}h estimated. This is a review signal, not automatically a conflict.</p>)}</> : null}</section>{releasePending || firstIssue ? <section className="d5o-schedule-drawer-summary"><h3>Items needing attention</h3>{assessed.filter(({ assessment }) => assessment.issues.length > 0).map(({ item, assessment }) => <article key={item.id}><strong>{item.crew}</strong><p>{assessment.issues[0]?.message}</p><button type="button" onClick={() => { setSelectedId(item.id); setDetailsTab("booking"); }}>Review booking →</button></article>)}{uniqueReleaseHeld.map(({ item, assessment }) => { const record = work.find((candidate) => candidate.id === item.workId); return <article key={item.id}><strong>{record?.packages?.find((entry) => entry.id === item.packageId)?.name ?? item.crew}</strong><p>{assessment.release} · {assessment.nextDecision} · {assessment.decisionOwner}</p><button type="button" onClick={() => record && onOpenDecision(record)}>Open Work Record decision →</button></article>; })}</section> : null}</> : null}
    {detailsTab === "booking" && selected && selectedAssessment ? <aside className="d5o-schedule-inspector"><div><p>SELECTED ASSIGNMENT</p><h2>{selected.crew}</h2><span>{selectedWork?.title ?? "Work Record"} · {weekdays[selected.day]} {selected.shift}</span></div><div className="d5o-schedule-inspector-grid"><section><b>QUALIFICATION</b><strong className={selectedAssessment.unqualified.length ? "is-risk" : ""}>{selectedAssessment.unqualified.length ? "Gap identified" : "People qualified"}</strong><small>{selectedAssessment.requiredQualification ?? "Requirement not configured"} · {selected.people.length - selectedAssessment.unqualified.length}/{selected.people.length} qualified</small></section><section><b>WORKLOAD</b><strong>{shiftHours(selected.shift)}h shift</strong><small>{selected.personHoursPerWorker == null ? "Economic effort not recorded" : `${selected.personHoursPerWorker} estimated person-hours per worker · ${selected.people.length * selected.personHoursPerWorker} total`}. {selected.people.map((name) => `${name}: ${personHours(assignments, name, visibleWeek)}h calendar capacity`).join(" · ")}</small></section><section><b>SCHEDULE ISSUES</b><strong className={selectedAssessment.issues.length ? "is-risk" : ""}>{selectedAssessment.issues.length ? "Needs resolution" : "No people conflicts"}</strong><small>{selectedAssessment.issues[0]?.message || "Qualifications, shift, and person-day capacity are clear."}</small></section><section><b>RELEASE DECISION</b><strong className={selectedAssessment.release === "Release held" ? "is-risk" : ""}>{selectedAssessment.release}</strong><small>{selectedAssessment.releaseDetail} Next: {selectedAssessment.nextDecision} · {selectedAssessment.decisionOwner}</small></section></div><div className="d5o-schedule-inspector-actions"><button disabled={!shared.canEdit || selectedAssessment.release === "Package complete"} onClick={() => setPendingMove({ ...selected })}>Revise draft assignment</button><button onClick={() => selectedWork && onOpen(selectedWork)}>Open Work Record →</button></div></aside> : null}
    {detailsTab === "booking" && selected && selectedAssessment?.issues.length ? <section className="d5o-schedule-issue-summary" aria-label="Selected assignment conflicts"><div><p>ASSIGNMENT NEEDS RESOLUTION</p><h3>{selectedAssessment.issues.length} issue{selectedAssessment.issues.length === 1 ? "" : "s"} on {selected.crew}</h3></div><ul>{selectedAssessment.issues.map((issue, index) => <li key={`${issue.kind}:${issue.person ?? "package"}:${index}`}><strong>{issue.message}</strong><span>{issue.action}</span></li>)}</ul><div>{shared.canEdit ? <button type="button" onClick={() => setPendingMove({ ...selected })}>Resolve assignment</button> : null}{shared.canManageAvailability ? <button type="button" onClick={() => openAvailability(selected.people[0] ?? "", selected.day)}>Record unavailability</button> : null}<button type="button" onClick={() => selectedWork && onOpenDecision(selectedWork)}>Open Work Record decision →</button></div></section> : null}

    {detailsTab === "publication" ? <SchedulePublicationPanel shared={shared} week={visibleWeek} workspace={workspaceKey} /> : null}
    {detailsTab === "availability" ? <><button className="d5o-schedule-back" type="button" disabled={Boolean(shared.pending)} onClick={() => setDetailsTab(returnTab)}>← Back to {returnTab === "editor" ? "crew selection" : returnTab === "booking" ? "booking" : "schedule details"}</button><AvailabilityEditor key={`${visibleWeek}:${absencePerson}:${absenceDay}`} profiles={profiles} blocks={shared.schedule.availabilityBlocks} assignments={assignments} weekIndex={visibleWeek} anchorDate={anchor} initialPerson={absencePerson} initialDay={absenceDay} canEdit={shared.canManageAvailability} pending={Boolean(shared.pending)} busy={shared.busy} onChange={(blocks) => shared.mutate({ action: "save-availability", availabilityBlocks: blocks }).then(() => undefined)} /></> : null}
    {detailsTab === "overview" ? <section className="d5o-crew-guidance"><strong>Schedule ≠ release.</strong><span>Saving a calendar move updates the draft. Publish the week to share it with the crew; the Work Record still controls readiness and field release.</span></section> : null}
    {detailsTab === "editor" ? <form id="d5o-crew-editor" className="d5o-crew-editor" onSubmit={submit}>
      <div><p>NEW CREW ASSIGNMENT</p><h2>Who will do which work, and when?</h2></div>
      <div className="d5o-crew-editor-grid">
        <label>Crew name<input name="crew" value={crewName} onChange={(event) => setCrewName(event.target.value)} placeholder="For example: Fiber remediation" required /></label>
        <label>Work Record and package<select name="package" value={selectedPackage} onChange={(event) => { const value = event.target.value; const next = packageDemands.find((item) => `${item.workId}|${item.packageId}` === value); const first = next?.requiredSlots.find((slot) => slot.date >= dateKeyForSchedule(anchor, visibleWeek, 0) && slot.date <= dateKeyForSchedule(anchor, visibleWeek, 4)); setSelectedPackage(value); setSourceSlot(first ? { date: first.date, shift: first.shift } : null); setPeople([]); setShowAllPeople(false); setSelectedShift(first?.shift ?? "07:00–15:30"); if (first) setSelectedDay([0, 1, 2, 3, 4].find((day) => dateKeyForSchedule(anchor, visibleWeek, day) === first.date) ?? 0); }} required><option value="" disabled>Choose controlled work</option>{packageOptions.map((item) => <option key={`${item.workId}|${item.packageId}`} value={`${item.workId}|${item.packageId}`}>{item.label}</option>)}</select></label>
        <label>Booking day<select name="day" value={selectedDay} onChange={(event) => setSelectedDay(Number(event.target.value))}>{[0, 1, 2, 3, 4].map((day) => <option key={day} value={day}>{dateFor(visibleWeek, day).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</option>)}</select></label>
        <label>Estimated person-hours per worker<input type="number" min="0.01" max="24" step="0.01" required value={personHoursPerWorker} onChange={(event) => setPersonHoursPerWorker(event.target.value)} /><small>Each person&apos;s effort, not total crew-hours. Publishing needs approved labor authority; draft planning reserves no budget.</small></label>
        <div className="d5o-crew-time-fields"><label>Start time<input type="time" value={shiftTimes(selectedShift).start} onChange={(event) => setSelectedShift(`${event.target.value}–${shiftTimes(selectedShift).end}`)} required /></label><label>End time<input type="time" value={shiftTimes(selectedShift).end} onChange={(event) => setSelectedShift(`${shiftTimes(selectedShift).start}–${event.target.value}`)} required /></label></div>
      </div>
      <p className="d5o-schedule-form-requirement">Work Package demand: <strong>{chosenDemand ? `${chosenDemand.minimumPeople}+ people · ${chosenDemand.qualification} · ${chosenDemand.requiredSlots.map((slot) => `${slot.date} ${slot.shift}`).join("; ")}` : selectedPackage ? "Not configured — set dates and shifts in Work Record Design" : "Select a package"}</strong>{shared.requiresPublication && chosenDemand && !editorSlotAllowed ? <span>This date and shift are outside the current Design requirement. Review the package basis before booking.</span> : editorSlotChange && !shared.requiresPublication ? <span>Saving this assignment will also update its required date/shift. Existing bookings on the original slot remain covered.</span> : null}</p>
      <div className="d5o-picker-controls"><span>{chosenDemand ? `${availableQualified.length} eligible for this shift · ${qualifiedProfiles.length} hold ${chosenDemand.qualification} · ${chosenDemand.minimumPeople} needed` : "Select a configured package to see eligible people"}</span>{chosenDemand ? <button type="button" onClick={() => setShowAllPeople((value) => !value)}>{showAllPeople ? "Show qualified people" : "Show all people"}</button> : null}</div>
      {chosenDemand && !availableQualified.length ? <div className="d5o-schedule-staffing-blocker" role="status"><strong>No qualified person is free for this shift.</strong><span>{existingPackageBooking && allQualifiedAlreadyBooked ? `${existingPackageBooking.people.join(" and ")} are already scheduled on this package for ${weekdays[selectedDay]} ${selectedShift}. This is a booking overlap, not a weekly capacity limit.` : `The ${qualifiedProfiles.length} people with ${chosenDemand.qualification} are booked, unavailable, or at capacity for ${weekdays[selectedDay]} ${selectedShift}. Try another day or time.`}</span>{existingPackageBooking ? <button type="button" onClick={() => { setSelectedId(existingPackageBooking.id); setDetailsTab("booking"); }}>Review existing booking →</button> : null}</div> : null}
      {chosenDemand ? <fieldset><legend>NAMED PEOPLE · {people.length} SELECTED</legend><p className="d5o-crew-candidate-guidance">Eligibility checks this shift against skills, recorded absences, overlapping bookings, and weekly hours. A release hold belongs to the Work Package and is shown after booking.</p><div>{visibleChoices.map(({ person, reason, qualified, eligible, hours, dayBookings }) => {
        const selectedPerson = people.includes(person.name);
        const blocked = !eligible && !selectedPerson;
        return <label key={person.name} className={[selectedPerson ? "is-selected" : "", !qualified ? "is-unqualified" : "", blocked ? "is-blocked" : ""].filter(Boolean).join(" ")}><input type="checkbox" checked={selectedPerson} disabled={blocked} onChange={() => setPeople((current) => current.includes(person.name) ? current.filter((item) => item !== person.name) : [...current, person.name])} /><span><strong>{person.displayName ?? person.name}</strong><small>{person.qualifications.join(" · ")} · {hours}/{person.weeklyCapacityHours}h this week · {person.weeklyCapacityHours - hours}h remaining</small><em className={eligible ? "is-eligible" : "is-ineligible"}>{reason}</em>{dayBookings.length ? <small>{weekdays[selectedDay]}: {dayBookings.map((item) => `${item.crew} ${item.shift}`).join(" · ")}</small> : <small>No other booking on {weekdays[selectedDay]}</small>}</span></label>;
      })}</div>{shared.canManageAvailability ? <button className="d5o-schedule-inline-action" type="button" onClick={() => openAvailability(people[0] ?? "", selectedDay)}>Record unavailability for this day →</button> : null}</fieldset> : <p className="d5o-crew-editor-empty">Choose a configured Work Package to see eligible people.</p>}
      <footer><span>Save checks dates, skills, conflicts, and capacity. This remains a draft until the week is published and never releases controlled work.</span>{message ? <p className="d5o-crew-message" role="status">{message}</p> : null}<button className="d5o-primary" type="submit" disabled={savingCrew || shared.busy || Boolean(shared.pending) || !shared.canEdit}>{savingCrew ? "Saving draft…" : "Save draft booking"}</button></footer>
    </form> : null}
    </div></aside></div> : null}

    {pendingMove && pendingSource && pendingAssessment ? <div className="d5o-schedule-dialog-backdrop" onKeyDown={(event) => { if (event.key === "Escape") setPendingMove(null); }}>
      <section ref={moveDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="schedule-change-title" aria-describedby="schedule-change-description" className="d5o-schedule-dialog">
        <p>ACKNOWLEDGE SCHEDULE CHANGE</p>
        <h2 id="schedule-change-title">Move {pendingSource.crew}</h2>
        <span id="schedule-change-description">Adjust the date, time, crew, or named people here. Saving revises the draft booking. Publish the week before workers see the change; publication does not release controlled work.</span>
        <div className="d5o-schedule-change-route"><div><small>FROM</small><strong>{weekdays[pendingSource.day]} {pendingSource.shift} · {pendingSource.crew}</strong></div><div aria-hidden="true">→</div><div><small>TO</small><strong>{weekdays[pendingMove.day]} {pendingMove.shift} · {pendingMove.crew}</strong></div></div>
        <div className="d5o-schedule-dialog-fields">
          <label>Estimated person-hours per worker<input type="number" min="0.01" max="24" step="0.01" required value={pendingMove.personHoursPerWorker ?? ""} onChange={(event) => setPendingMove({ ...pendingMove, personHoursPerWorker: Number(event.target.value) })} /></label>
          <label>Day<select value={pendingMove.day} onChange={(event) => setPendingMove({ ...pendingMove, day: Number(event.target.value), date: dateKeyForSchedule(anchor, visibleWeek, Number(event.target.value)) })}>{weekdays.map((day, index) => <option key={day} value={index}>{day} · {shortDate(dateFor(visibleWeek, index))}</option>)}</select></label>
          <label>Crew<select value={pendingMove.crew} onChange={(event) => setPendingMove({ ...pendingMove, crew: event.target.value })}>{crews.map((crew) => <option key={crew}>{crew}</option>)}</select></label>
          <label>Start time<input type="time" value={shiftTimes(pendingMove.shift).start} onChange={(event) => setPendingMove({ ...pendingMove, shift: `${event.target.value}–${shiftTimes(pendingMove.shift).end}` })} /></label>
          <label>End time<input type="time" value={shiftTimes(pendingMove.shift).end} onChange={(event) => setPendingMove({ ...pendingMove, shift: `${shiftTimes(pendingMove.shift).start}–${event.target.value}` })} /></label>
        </div>
        {pendingRevisedDemand && pendingRequirement && JSON.stringify(pendingRevisedDemand.requiredSlots) !== JSON.stringify(pendingRequirement.requiredSlots) ? <p className="d5o-schedule-demand-change">This move also updates the Work Package required date/shift. Other bookings on the original slot keep that slot in the plan.</p> : null}
        <fieldset className="d5o-schedule-move-people"><legend>Named people · {pendingMove.people.length} selected</legend><div>{profiles.filter((person) => person.qualifications.includes(pendingAssessment.requiredQualification ?? "") || pendingMove.people.includes(person.name)).map((person) => {
          const selectedPerson = pendingMove.people.includes(person.name);
          const trial = selectedPerson ? pendingAssessment : assignmentAssessment({ ...pendingMove, people: [...pendingMove.people, person.name] }, assignments, workspaceKey, work, profiles, pendingDemands);
          const blocked = !selectedPerson && (trial.unavailablePeople.includes(person.name) || trial.overlappingPeople.includes(person.name) || trial.overCapacity.includes(person.name));
          const reason = trial.unavailablePeople.includes(person.name) ? personUnavailable(person, pendingMove.week, pendingMove.day) : trial.overlappingPeople.includes(person.name) ? "Already booked at this time" : trial.overCapacity.includes(person.name) ? "Weekly capacity exceeded" : "Available";
          return <label key={person.name} className={selectedPerson ? "is-selected" : ""}><input type="checkbox" checked={selectedPerson} disabled={blocked} onChange={() => setPendingMove((current) => current ? { ...current, people: selectedPerson ? current.people.filter((name) => name !== person.name) : [...current.people, person.name] } : null)} /><span><strong>{person.displayName ?? person.name}</strong><small>{person.qualifications.join(" · ")} · {personHours(assignments.filter((item) => item.id !== pendingMove.id), person.name, pendingMove.week)}/{person.weeklyCapacityHours}h · {reason}</small></span></label>;
        })}</div></fieldset>
        <dl><div><dt>Qualifications</dt><dd>{pendingAssessment.unqualified.length ? `Missing for ${pendingAssessment.unqualified.join(", ")}` : `${pendingMove.people.length} people meet ${pendingAssessment.requiredQualification ?? "the configured requirement"}`}</dd></div><div><dt>Workload / conflicts</dt><dd>{pendingAssessment.overlappingPeople.length || pendingAssessment.overCapacity.length || pendingAssessment.unavailablePeople.length ? pendingAssessment.errors.join(" ") : "No person-day overlap or weekly capacity breach"}</dd></div><div><dt>Release decision</dt><dd><strong>{pendingAssessment.release}</strong> · {pendingAssessment.releaseDetail}</dd></div></dl>
        <ScheduleIssueDetail candidate={pendingMove} work={work} assessment={pendingAssessment} onReviewWork={() => { const record = work.find((item) => item.id === pendingMove.workId); if (record) { setPendingMove(null); onOpenDecision(record); } }} />
        {pendingAssessment.errors.length || unchanged ? <p className="d5o-schedule-dialog-error" role="alert">{pendingAssessment.errors.join(" ") || "Choose a different day, time, crew, or person before saving."}</p> : null}
        {shared.pending ? <p className="d5o-schedule-dialog-error" role="status">The schedule change may have committed. Keep these values and check the original command before another change. <button type="button" disabled={shared.busy} onClick={() => void shared.reconcilePending().catch(() => undefined)}>Check/retry original command</button></p> : null}
        <footer><button disabled={Boolean(shared.pending)} onClick={() => setPendingMove(null)}>Cancel</button><button className="d5o-primary" disabled={Boolean(shared.pending || shared.busy || pendingAssessment.errors.length || unchanged || !pendingMove.personHoursPerWorker)} onClick={acknowledgeMove}>Acknowledge & save schedule</button></footer>
      </section>
    </div> : null}
  </section>;
}
