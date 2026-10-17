/** Synthetic planning data for the local prototype. Scheduling never grants work authority. */
export type WorkspaceKey = "rybex" | "rotork";
export type Assignment = { id: string; crew: string; people: string[]; workId: string; packageId: string; week: number; day: number; date?: string; shift: string; personHoursPerWorker?: number };
export type ScheduleWork = { id: string; title: string; site: string; stage?: string; owner?: string; nextAction?: string; blockers: string[]; packages?: { id: string; name: string; status: "planned" | "in progress" | "ready" | "accepted" }[]; design?: { packages: { packageId: string; revision: number }[]; releases: { packageId: string; packageRevision: number; status: string }[] } };
export type PersonProfile = { name: string; displayName?: string; qualifications: string[]; weeklyCapacityHours: number; active?: boolean; bound?: boolean; unavailable?: { week: number; day: number; reason: string }[] };
export type AvailabilityBlock = { id: string; person: string; week: number; day: number; date?: string; reason: string };
export type ScheduleActor = { id: string; name: string; role: string };
export type PublishedSchedule = { id: string; week: number; weekStart: string; draftRevision: number; publishedAt: string; publishedBy: ScheduleActor; assignments: Assignment[]; packageDemands?: PackageCrewDemand[] };
export type CrewReceipt = { id: string; publicationId: string; assignmentId: string; recipient: string; recordedAt: string; recordedBy: ScheduleActor; statement: string; source?: "coordinator" | "self" | "carried"; carriedFromReceiptId?: string; response?: "acknowledged" | "cannot-attend" };
export type SharedSchedule = {
  schemaVersion: 1; workspace: WorkspaceKey; anchorDate: string; revision: number; draftRevision: number;
  assignments: Assignment[]; availabilityBlocks: AvailabilityBlock[]; publications: PublishedSchedule[]; receipts: CrewReceipt[];
  packageDemands: PackageCrewDemand[];
};
export type PublishedBookingResponse = { assignment: Assignment; recipient: string; receipt?: CrewReceipt };

/** Read the latest immutable worker-visible schedule. Unrelated plan edits do not revoke it. */
export function publishedWeekStatus(schedule: SharedSchedule, week: number) {
  const publication = schedule.publications.filter((item) => item.week === week).at(-1);
  const currentBookings = schedule.assignments.filter((item) => item.week === week);
  const responses: PublishedBookingResponse[] = publication?.assignments.flatMap((assignment) =>
    assignment.people.map((recipient) => ({
      assignment,
      recipient,
      receipt: schedule.receipts.find((receipt) => receipt.publicationId === publication.id && receipt.assignmentId === assignment.id && receipt.recipient === recipient),
    }))) ?? [];
  return {
    publication,
    responses,
    current: Boolean(publication && JSON.stringify(publication.assignments) === JSON.stringify(currentBookings)),
    acknowledged: responses.filter((item) => item.receipt && item.receipt.response !== "cannot-attend").length,
    cannotAttend: responses.filter((item) => item.receipt?.response === "cannot-attend"),
    awaiting: responses.filter((item) => !item.receipt),
  };
}
export type ScheduleIssue = { kind: "qualification" | "overlap" | "capacity" | "availability" | "crew" | "window" | "configuration" | "work" | "shift"; person?: string; message: string; action: string };
export type ScheduleRequirement = { packageId: string; qualification: string; minimumPeople: number; estimatedPersonHours: number; fixtureSeedDay: number; priority: "Critical" | "High" | "Normal"; prerequisite: string; crewSchedulable: boolean };
export type CrewDemandSlot = { date: string; shift: string };
export type PackageCrewDemand = Omit<ScheduleRequirement, "fixtureSeedDay"> & { workId: string; requiredSlots: CrewDemandSlot[]; designPackageRevision?: number };
export type ScheduleDemand = PackageCrewDemand & CrewDemandSlot & { configured: boolean; workTitle: string; packageName: string; site: string; packageStatus: string; scheduledPersonHours: number; remainingPersonHours: number; release: string; releaseDetail: string };

/** Keep an adjusted booking and its required slot in the same draft revision. */
export function reconcileBookingDemand(demand: PackageCrewDemand, source: CrewDemandSlot, booking: Assignment, remaining: Assignment[]): PackageCrewDemand {
  if (!booking.date) return demand;
  const target = { date: booking.date, shift: booking.shift };
  if (source.date === target.date && source.shift === target.shift) return demand;
  const sourceStillBooked = remaining.some((item) => item.workId === demand.workId && item.packageId === demand.packageId && item.date === source.date && item.shift === source.shift);
  const slots = demand.requiredSlots.filter((slot) => sourceStillBooked || slot.date !== source.date || slot.shift !== source.shift);
  if (!slots.some((slot) => slot.date === target.date && slot.shift === target.shift)) slots.push(target);
  return { ...demand, requiredSlots: slots };
}

export const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/** A persisted Monday anchors every relative week number to real calendar dates. */
export function planningMonday(now = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const weekday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - weekday + (weekday >= 5 ? 7 : 0));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dateForSchedule(anchor: string, week: number, day: number): Date {
  const [year, month, date] = anchor.split("-").map(Number);
  const result = new Date(year, month - 1, date, 12);
  result.setDate(result.getDate() + week * 7 + day);
  return result;
}

export function dateKeyForSchedule(anchor: string, week: number, day: number): string {
  const date = dateForSchedule(anchor, week, day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function currentScheduleWeek(anchor: string, now = new Date()): number {
  const anchorDay = Date.parse(`${anchor}T00:00:00Z`);
  const currentDay = Date.parse(`${planningMonday(now)}T00:00:00Z`);
  return Math.round((currentDay - anchorDay) / (7 * 24 * 60 * 60 * 1000));
}

export function datedAssignments(assignments: Assignment[], anchor: string): Assignment[] {
  return assignments.map((item) => ({ ...item, date: dateKeyForSchedule(anchor, item.week, item.day) }));
}

export function datedAvailability(blocks: AvailabilityBlock[], anchor: string): AvailabilityBlock[] {
  return blocks.map((item) => ({ ...item, date: dateKeyForSchedule(anchor, item.week, item.day) }));
}

export const peopleProfiles: Record<WorkspaceKey, PersonProfile[]> = {
  rybex: [
    { name: "Nate Walker", qualifications: ["Fiber installation"], weeklyCapacityHours: 40 },
    { name: "Avery Reed", qualifications: ["Fiber installation", "Network cabling"], weeklyCapacityHours: 40 },
    { name: "Tomas Bell", qualifications: ["Fiber installation"], weeklyCapacityHours: 40 },
    { name: "Mia Owens", qualifications: ["Fiber installation", "Network cabling"], weeklyCapacityHours: 40 },
    { name: "Jordan Lee", qualifications: ["Network cabling", "Controls service"], weeklyCapacityHours: 40 },
    { name: "Samira Khan", qualifications: ["Controls service"], weeklyCapacityHours: 40 },
    { name: "Jules Ortiz", qualifications: ["Network cabling"], weeklyCapacityHours: 40 },
    { name: "Drew Myers", qualifications: ["Network cabling"], weeklyCapacityHours: 40 },
    { name: "Riley Grant", qualifications: ["Network cabling"], weeklyCapacityHours: 40 },
    { name: "Kai Patel", qualifications: ["Controls service"], weeklyCapacityHours: 40 },
    { name: "Maya Chen", qualifications: ["Certification review"], weeklyCapacityHours: 40 },
    { name: "Inez Flores", qualifications: ["Certification review"], weeklyCapacityHours: 40 },
    { name: "Owen Price", qualifications: ["Controls service"], weeklyCapacityHours: 40 },
    { name: "Quinn Hart", qualifications: ["Controls service"], weeklyCapacityHours: 40 }
  ],
  rotork: [
    { name: "Priya Shah", qualifications: ["Pilot delivery", "Service engineering"], weeklyCapacityHours: 40 },
    { name: "Omar Ellis", qualifications: ["Pilot delivery"], weeklyCapacityHours: 40 },
    { name: "Gabe Watts", qualifications: ["Pilot delivery"], weeklyCapacityHours: 40 },
    { name: "Zoe King", qualifications: ["Service engineering"], weeklyCapacityHours: 40 },
    { name: "Elliot Brooks", qualifications: ["Service engineering"], weeklyCapacityHours: 40 },
    { name: "Dani Ross", qualifications: ["Service engineering"], weeklyCapacityHours: 40 },
    { name: "Morgan Li", qualifications: ["Pilot delivery", "Rollout commissioning"], weeklyCapacityHours: 40 },
    { name: "Harper Singh", qualifications: ["Rollout commissioning"], weeklyCapacityHours: 40 },
    { name: "Noah James", qualifications: ["Rollout commissioning"], weeklyCapacityHours: 40 },
    { name: "Aisha Brown", qualifications: ["Rollout commissioning"], weeklyCapacityHours: 40 },
    { name: "Cole Martin", qualifications: ["Service engineering"], weeklyCapacityHours: 40 },
    { name: "Eva Wilson", qualifications: ["Rollout commissioning"], weeklyCapacityHours: 40 }
  ]
};

export const roster: Record<WorkspaceKey, string[]> = {
  rybex: peopleProfiles.rybex.map((person) => person.name),
  rotork: peopleProfiles.rotork.map((person) => person.name)
};

/** Labels for the synthetic Work Records; scheduling identity remains the stable IDs above. */
const scheduleWorkContext: Record<string, { title: string; site: string }> = {
  "rybex-1": { title: "North Campus Data Hall Turnover", site: "DC-2 · Ashburn" },
  "rybex-2": { title: "West Wing Network Retrofit", site: "DC-1 · Ashburn" },
  "rybex-3": { title: "Generator Monitoring Upgrade", site: "DC-3 · Manassas" },
  "rotork-1": { title: "Offshore Actuator Modernization", site: "Platform Delta" },
  "rotork-2": { title: "Valve Reliability Pilot", site: "Unit 4" },
  "rotork-3": { title: "Terminal Control Upgrade", site: "Bay 7" }
};
const schedulePackageLabels: Record<string, string> = {
  "wp-fibre-rybex-1": "Fiber trunks and termination", "wp-copper-rybex-1": "Copper management-network cabling", "wp-turnover-rybex-1": "Certification and turnover package",
  "wp-fibre-rybex-2": "Fiber trunks and termination", "wp-copper-rybex-2": "Copper management-network cabling", "wp-turnover-rybex-2": "Certification and turnover package",
  "wp-monitoring-rybex-3": "Monitoring equipment and site survey", "wp-service-rybex-3": "Service integration plan",
  "wp-assessment-rotork-1": "Assessment and modernization case", "wp-pilot-rotork-1": "Paid pilot delivery", "wp-rollout-rotork-1": "Rollout authorization package",
  "wp-assessment-rotork-2": "Assessment and modernization case", "wp-pilot-rotork-2": "Paid pilot delivery", "wp-rollout-rotork-2": "Rollout authorization package",
  "wp-assessment-rotork-3": "Assessment and modernization case", "wp-pilot-rotork-3": "Paid pilot delivery", "wp-rollout-rotork-3": "Rollout authorization package"
};
export function scheduleBookingContext(assignment: Assignment) {
  const record = scheduleWorkContext[assignment.workId];
  return { workTitle: record?.title ?? "Work Record to confirm with scheduler", site: record?.site ?? "Site to confirm",
    packageName: schedulePackageLabels[assignment.packageId] ?? "Work package to confirm with scheduler" };
}

export const initialAvailabilityBlocks: Record<WorkspaceKey, AvailabilityBlock[]> = {
  rybex: [{ id: "leave-mia-thu", person: "Mia Owens", week: 0, day: 3, reason: "Approved leave" }],
  rotork: [{ id: "training-zoe-tue", person: "Zoe King", week: 0, day: 1, reason: "Customer-site training" }]
};

export function applyAvailability(profiles: PersonProfile[], blocks: AvailabilityBlock[]): PersonProfile[] {
  return profiles.map((person) => ({ ...person, unavailable: blocks.filter((block) => block.person === person.name).map(({ week, day, reason }) => ({ week, day, reason })) }));
}

/** Package requirements are configuration data; assessment logic is shared across both workspaces. */
export const packageQualifications: Record<string, string> = {
  "wp-fibre-rybex-1": "Fiber installation",
  "wp-copper-rybex-1": "Network cabling",
  "wp-turnover-rybex-1": "Certification review",
  "wp-fibre-rybex-2": "Fiber installation",
  "wp-copper-rybex-2": "Network cabling",
  "wp-turnover-rybex-2": "Certification review",
  "wp-monitoring-rybex-3": "Controls service",
  "wp-service-rybex-3": "Controls service",
  "wp-assessment-rotork-1": "Service engineering",
  "wp-pilot-rotork-1": "Pilot delivery",
  "wp-rollout-rotork-1": "Rollout commissioning",
  "wp-assessment-rotork-2": "Service engineering",
  "wp-pilot-rotork-2": "Pilot delivery",
  "wp-rollout-rotork-2": "Rollout commissioning",
  "wp-assessment-rotork-3": "Service engineering",
  "wp-pilot-rotork-3": "Pilot delivery",
  "wp-rollout-rotork-3": "Rollout commissioning"
};

/** Fixture metadata only. Runtime scheduling reads persisted Work Package slots, not these seed hints. */
const demandPlans: Record<string, Partial<Omit<ScheduleRequirement, "packageId" | "qualification">>> = {
  "wp-fibre-rybex-1": { minimumPeople: 3, estimatedPersonHours: 24, fixtureSeedDay: 0, priority: "Critical", prerequisite: "FT-24 retest or independent exception" },
  "wp-turnover-rybex-1": { minimumPeople: 2, estimatedPersonHours: 15, fixtureSeedDay: 2, priority: "High", prerequisite: "Internal quality verification" },
  "wp-monitoring-rybex-3": { minimumPeople: 2, estimatedPersonHours: 14, fixtureSeedDay: 2, priority: "High", prerequisite: "Confirm package plan" },
  "wp-service-rybex-3": { minimumPeople: 2, estimatedPersonHours: 14, fixtureSeedDay: 3, priority: "Normal", prerequisite: "Monitoring site survey" },
  "wp-pilot-rotork-1": { minimumPeople: 3, estimatedPersonHours: 22.5, fixtureSeedDay: 0, priority: "Critical", prerequisite: "Pilot outcome review" },
  "wp-rollout-rotork-1": { minimumPeople: 3, estimatedPersonHours: 24, fixtureSeedDay: 3, priority: "High", prerequisite: "Rollout authorization", crewSchedulable: false },
  "wp-rollout-rotork-2": { minimumPeople: 3, estimatedPersonHours: 24, fixtureSeedDay: 2, priority: "High", prerequisite: "Commercial readiness", crewSchedulable: false },
  "wp-rollout-rotork-3": { crewSchedulable: false }
};

export function scheduleRequirement(packageId: string): ScheduleRequirement | null {
  const qualification = packageQualifications[packageId];
  if (!qualification) return null;
  return { packageId, qualification, minimumPeople: 2, estimatedPersonHours: 16, fixtureSeedDay: 0, priority: "Normal", prerequisite: "Work Record release", crewSchedulable: true, ...demandPlans[packageId] };
}

/** Legacy weekday hints are used only to seed explicit date-and-shift demand slots. */
export function initialPackageDemands(workspace: WorkspaceKey, anchor: string): PackageCrewDemand[] {
  return Object.keys(packageQualifications).filter((packageId) => packageId.includes(`-${workspace}-`)).map((packageId) => {
    const requirement = scheduleRequirement(packageId)!;
    const { fixtureSeedDay, ...operational } = requirement;
    const workId = `${workspace}-${packageId.split("-").at(-1)}`;
    const bookings = initialAssignments[workspace].filter((item) => item.packageId === packageId);
    const slots = bookings.length ? bookings.map((item) => ({ date: dateKeyForSchedule(anchor, item.week, item.day), shift: item.shift }))
      : [{ date: dateKeyForSchedule(anchor, 0, fixtureSeedDay), shift: "07:00–15:30" }];
    return { ...operational, workId, requiredSlots: slots.filter((slot, index) => slots.findIndex((other) => other.date === slot.date && other.shift === slot.shift) === index) };
  });
}

export function packageDemand(packageId: string, demands?: PackageCrewDemand[]): PackageCrewDemand | null {
  return demands?.find((item) => item.packageId === packageId) ?? null;
}

export function personUnavailable(person: PersonProfile, week: number, day: number): string | null {
  return person.unavailable?.find((entry) => entry.week === week && entry.day === day)?.reason ?? null;
}

function packageRelease(record: ScheduleWork | undefined, workPackage: NonNullable<ScheduleWork["packages"]>[number] | undefined) {
  if (!record || !workPackage) return "Work/package unavailable";
  if (workPackage.status === "accepted") return "Package complete";
  const currentRevision = record.design?.packages.find((entry) => entry.packageId === workPackage.id)?.revision;
  if (currentRevision && record.design?.releases.some((entry) => entry.packageId === workPackage.id && entry.packageRevision === currentRevision && entry.status === "Accepted")) return "Design release received";
  if (currentRevision) return "Release held";
  if (record.blockers.length) return "Release held";
  if (workPackage.status === "planned") return "Planning only";
  if (workPackage.status === "ready") return "Awaiting acceptance";
  return "In progress";
}

function packageReleaseDetail(record: ScheduleWork | undefined, workPackage: NonNullable<ScheduleWork["packages"]>[number] | undefined) {
  const release = packageRelease(record, workPackage);
  if (release === "Design release received") return "Deploy accepted the current package revision. Booking publication, worker response, and field-start authorization remain separate.";
  if (release === "Release held" && record?.design?.packages.some((entry) => entry.packageId === workPackage?.id)) return "The current Design package revision has no accepted Deploy receipt.";
  if (release === "Package complete") return "This package is already accepted; review whether further work is required.";
  return record?.blockers[0] ?? (workPackage?.status === "planned" ? "Package planning is incomplete." : "Scheduling does not grant work release.");
}

export function scheduleDemand(work: ScheduleWork[], assignments: Assignment[], week: number, demands: PackageCrewDemand[] = [...initialPackageDemands("rybex", planningMonday()), ...initialPackageDemands("rotork", planningMonday())], anchor = ""): ScheduleDemand[] {
  const weekStart = anchor ? dateKeyForSchedule(anchor, week, 0) : "";
  const weekEnd = anchor ? dateKeyForSchedule(anchor, week, 4) : "";
  return work.flatMap((record) => (record.packages ?? []).filter((entry) => entry.status !== "accepted" && packageDemand(entry.id, demands)?.crewSchedulable !== false).flatMap((entry) => {
    const requirement = packageDemand(entry.id, demands);
    const slots = requirement?.requiredSlots.filter((slot) => !anchor || (slot.date >= weekStart && slot.date <= weekEnd)) ?? [{ date: "", shift: "" }];
    return slots.map((slot) => {
    const scheduledPersonHours = assignments.filter((item) => item.week === week && item.workId === record.id && item.packageId === entry.id).reduce((sum, item) => sum + item.people.length * shiftHours(item.shift), 0);
    return {
      packageId: entry.id, qualification: requirement?.qualification ?? "Not configured", minimumPeople: requirement?.minimumPeople ?? 0,
      estimatedPersonHours: requirement?.estimatedPersonHours ?? 0,
      priority: requirement?.priority ?? "Normal", prerequisite: requirement?.prerequisite ?? "Define scheduling requirements", crewSchedulable: requirement?.crewSchedulable ?? true,
      requiredSlots: requirement?.requiredSlots ?? [], date: slot.date, shift: slot.shift,
      configured: Boolean(requirement), workId: record.id, workTitle: record.title, packageName: entry.name, site: record.site,
      packageStatus: entry.status, scheduledPersonHours, remainingPersonHours: Math.max(0, (requirement?.estimatedPersonHours ?? 0) - scheduledPersonHours),
      release: packageRelease(record, entry), releaseDetail: packageReleaseDetail(record, entry)
    } as ScheduleDemand;
    });
  })).sort((a, b) => {
    const rank = (item: ScheduleDemand) => !item.configured ? 0 : item.remainingPersonHours > 0 ? 1 : item.scheduledPersonHours > item.estimatedPersonHours ? 2 : 3;
    return rank(a) - rank(b) || ({ Critical: 0, High: 1, Normal: 2 })[a.priority] - ({ Critical: 0, High: 1, Normal: 2 })[b.priority] || b.remainingPersonHours - a.remainingPersonHours;
  });
}

export const initialAssignments: Record<WorkspaceKey, Assignment[]> = {
  rybex: [
    { id: "seed-fiber", crew: "Fiber installation", people: ["Nate Walker", "Avery Reed", "Tomas Bell"], workId: "rybex-1", packageId: "wp-fibre-rybex-1", week: 0, day: 0, shift: "07:00–15:30" },
    { id: "seed-cabling", crew: "Network cabling", people: ["Jules Ortiz", "Drew Myers", "Riley Grant"], workId: "rybex-1", packageId: "wp-copper-rybex-1", week: 0, day: 1, shift: "07:00–15:30" },
    { id: "seed-quality", crew: "Commissioning & turnover", people: ["Maya Chen", "Inez Flores"], workId: "rybex-1", packageId: "wp-turnover-rybex-1", week: 0, day: 2, shift: "08:00–16:00" },
    { id: "seed-service", crew: "Lifecycle service", people: ["Owen Price", "Quinn Hart"], workId: "rybex-3", packageId: "wp-monitoring-rybex-3", week: 0, day: 3, shift: "09:00–16:00" }
  ],
  rotork: [
    { id: "seed-pilot", crew: "Pilot delivery", people: ["Priya Shah", "Omar Ellis", "Gabe Watts"], workId: "rotork-1", packageId: "wp-pilot-rotork-1", week: 0, day: 0, shift: "08:00–16:00" },
    { id: "seed-engineering", crew: "Service engineering", people: ["Elliot Brooks", "Dani Ross"], workId: "rotork-2", packageId: "wp-assessment-rotork-2", week: 0, day: 2, shift: "09:00–16:00" },
    { id: "seed-rollout", crew: "Rollout field team", people: ["Harper Singh", "Noah James", "Aisha Brown"], workId: "rotork-3", packageId: "wp-rollout-rotork-3", week: 0, day: 3, shift: "07:00–15:30" }
  ]
};

export function shiftHours(shift: string): number {
  const match = /^(\d{2}):(\d{2})[–-](\d{2}):(\d{2})$/.exec(shift);
  if (!match) return 0;
  const [startHour, startMinute, endHour, endMinute] = match.slice(1).map(Number);
  if (startHour > 23 || endHour > 24 || startMinute > 59 || endMinute > 59 || (endHour === 24 && endMinute !== 0)) return 0;
  const minutes = endHour * 60 + endMinute - startHour * 60 - startMinute;
  return Math.max(0, (minutes - (minutes >= 360 ? 30 : 0)) / 60);
}


export function personHours(assignments: Assignment[], person: string, week: number): number {
  return assignments.filter((item) => item.week === week && item.people.includes(person)).reduce((hours, item) => hours + shiftHours(item.shift), 0);
}

export function assignmentAssessment(candidate: Assignment, assignments: Assignment[], workspaceKey: WorkspaceKey, work: ScheduleWork[], profile = applyAvailability(peopleProfiles[workspaceKey], initialAvailabilityBlocks[workspaceKey]), demands: PackageCrewDemand[] = initialPackageDemands(workspaceKey, planningMonday())) {
  const requirement = packageDemand(candidate.packageId, demands);
  const requiredQualification = requirement?.qualification;
  const unqualified = candidate.people.filter((name) => !requiredQualification || !profile.find((person) => person.name === name)?.qualifications.includes(requiredQualification));
  const unbound = candidate.people.filter((name) => { const person = profile.find((entry) => entry.name === name); return !person || person.active === false || person.bound === false; });
  const unavailablePeople = candidate.people.filter((name) => {
    const person = profile.find((entry) => entry.name === name);
    return person && personUnavailable(person, candidate.week, candidate.day);
  });
  const collisions = assignments.filter((item) => item.id !== candidate.id && item.week === candidate.week && item.day === candidate.day && item.people.some((name) => candidate.people.includes(name)));
  const overlappingPeople = [...new Set(collisions.flatMap((item) => item.people.filter((name) => candidate.people.includes(name))))];
  const withoutCandidate = assignments.filter((item) => item.id !== candidate.id);
  const overCapacity = candidate.people.filter((name) => {
    const person = profile.find((entry) => entry.name === name);
    return !person || personHours(withoutCandidate, name, candidate.week) + shiftHours(candidate.shift) > person.weeklyCapacityHours;
  });
  const record = work.find((item) => item.id === candidate.workId);
  const workPackage = record?.packages?.find((item) => item.id === candidate.packageId);
  const original = assignments.find((item) => item.id === candidate.id);
  const changed = !original || original.week !== candidate.week || original.day !== candidate.day || original.date !== candidate.date || original.crew !== candidate.crew || original.shift !== candidate.shift || original.people.join("|") !== candidate.people.join("|") || original.personHoursPerWorker !== candidate.personHoursPerWorker;
  const requiredDateSlots = requirement?.requiredSlots.filter((slot) => slot.date === candidate.date) ?? [];
  const outsideRequiredDates = Boolean(requirement && candidate.date && requiredDateSlots.length === 0);
  const outsideRequiredShift = Boolean(requirement && candidate.date && requiredDateSlots.length > 0 && !requiredDateSlots.some((slot) => slot.shift === candidate.shift));
  const requiredDateList = requirement?.requiredSlots.map((slot) => slot.date).filter((date, index, all) => all.indexOf(date) === index).join(", ") ?? "";
  const authorizationPackageChanged = requirement?.crewSchedulable === false && changed;
  const acceptedPackageChanged = workPackage?.status === "accepted" && (!original || original.week !== candidate.week || original.day !== candidate.day || original.crew !== candidate.crew || original.shift !== candidate.shift || original.people.join("|") !== candidate.people.join("|"));
  const release = packageRelease(record, workPackage);
  const errors = [
    ...(shiftHours(candidate.shift) <= 0 || shiftHours(candidate.shift) > 16 ? ["The shift must have a valid start and end time and be no longer than 16 hours."] : []),
    ...(!requiredQualification ? ["No qualification requirement is configured for this package."] : []),
    ...(authorizationPackageChanged ? ["This is an authorization package, not crew execution work. Schedule a field Work Package after the required authorization."] : []),
    ...(requirement && candidate.people.length < requirement.minimumPeople ? [`This package needs at least ${requirement.minimumPeople} qualified people.`] : []),
    ...(outsideRequiredDates ? [`This booking is outside the Work Package required dates: ${requiredDateList}.`] : []),
    ...(outsideRequiredShift ? [`This booking shift must be ${requiredDateSlots.map((slot) => slot.shift).join(" or ")} on ${candidate.date}.`] : []),
    ...(unbound.length ? [`Account binding or active profile required: ${unbound.join(", ")}.`] : []),
    ...(unqualified.length ? [`Qualification missing: ${unqualified.join(", ")}.`] : []),
    ...(unavailablePeople.length ? [`Unavailable on ${weekdays[candidate.day] ?? "this day"}: ${unavailablePeople.join(", ")}.`] : []),
    ...(overlappingPeople.length ? [`Already scheduled that day: ${overlappingPeople.join(", ")}.`] : []),
    ...(overCapacity.length ? [`Weekly capacity exceeded: ${overCapacity.join(", ")}.`] : []),
    ...(acceptedPackageChanged ? ["This package is accepted; create follow-on work rather than changing its schedule."] : []),
    ...(!record || !workPackage ? ["The linked Work Record or package is unavailable."] : [])
  ];
  const issues: ScheduleIssue[] = [
    ...(shiftHours(candidate.shift) <= 0 || shiftHours(candidate.shift) > 16 ? [{ kind: "shift" as const, message: `Shift ${candidate.shift} is invalid.`, action: "Choose a valid shift of 16 hours or less." }] : []),
    ...(!requiredQualification ? [{ kind: "configuration" as const, message: `No qualification rule is configured for package ${workPackage?.name ?? candidate.packageId}.`, action: "Open the Work Record; package configuration must be resolved before scheduling." }] : []),
    ...(authorizationPackageChanged ? [{ kind: "work" as const, message: `${workPackage?.name ?? "This package"} records authorization rather than field crew execution.`, action: "Open the Work Record and establish the rollout execution package after authorization." }] : []),
    ...(requirement && candidate.people.length < requirement.minimumPeople ? [{ kind: "crew" as const, message: `${workPackage?.name ?? "This package"} needs ${requirement.minimumPeople} qualified people; ${candidate.people.length} selected.`, action: "Add qualified people before saving." }] : []),
    ...(outsideRequiredDates ? [{ kind: "window" as const, message: `${workPackage?.name ?? "This package"} is booked outside its required dates: ${requiredDateList}.`, action: "Choose a required date or revise the Work Package demand." }] : []),
    ...(outsideRequiredShift ? [{ kind: "shift" as const, message: `${workPackage?.name ?? "This package"} requires ${requiredDateSlots.map((slot) => slot.shift).join(" or ")} on ${candidate.date}.`, action: "Choose a required shift or revise the Work Package demand." }] : []),
    ...unbound.map((name) => ({ kind: "qualification" as const, person: name, message: `${name} is inactive or has no confirmed account binding.`, action: "Use Workforce administration to activate and bind this person." })),
    ...unqualified.map((name) => ({ kind: "qualification" as const, person: name, message: `${name} does not hold ${requiredQualification ?? "the required package qualification"}.`, action: "Replace this person with someone qualified." })),
    ...unavailablePeople.map((name) => ({ kind: "availability" as const, person: name, message: `${name} is unavailable ${weekdays[candidate.day]}: ${personUnavailable(profile.find((entry) => entry.name === name)!, candidate.week, candidate.day)}.`, action: "Choose another day or replace this person." })),
    ...collisions.flatMap((item) => item.people.filter((name) => candidate.people.includes(name)).map((name) => ({ kind: "overlap" as const, person: name, message: `${name} is already booked on ${item.crew}, ${weekdays[item.day]} ${item.shift}.`, action: "Choose another day or replace this person." }))),
    ...overCapacity.map((name) => { const person = profile.find((entry) => entry.name === name); const total = personHours(withoutCandidate, name, candidate.week) + shiftHours(candidate.shift); return { kind: "capacity" as const, person: name, message: `${name} would reach ${total}h against ${person?.weeklyCapacityHours ?? 0}h weekly capacity.`, action: "Reduce the person's workload or choose another qualified person." }; }),
    ...(acceptedPackageChanged ? [{ kind: "work" as const, message: "This package is accepted; its recorded schedule is historical.", action: "Create independently governed follow-on work before planning more execution." }] : []),
    ...(!record || !workPackage ? [{ kind: "work" as const, message: "The linked Work Record or package is unavailable in this workspace.", action: "Open the Work Record and choose a valid package." }] : [])
  ];
  const releaseDetail = packageReleaseDetail(record, workPackage);
  return { requiredQualification, requirement, unbound, unqualified, unavailablePeople, overlappingPeople, overCapacity, release, releaseDetail, nextDecision: release === "Design release received" ? "Publish the booking, obtain the worker response, then assess field-start readiness" : record?.nextAction ?? "Review Work Record", decisionOwner: release === "Design release received" ? "Crew coordinator and Delivery Leader" : record?.stage === "Customer acceptance" ? "Owner representative · customer acceptance" : record?.owner ?? "Work owner", errors, issues };
}

export function replacementCandidates(candidate: Assignment, replacedPerson: string, assignments: Assignment[], workspaceKey: WorkspaceKey, work: ScheduleWork[], profile = applyAvailability(peopleProfiles[workspaceKey], initialAvailabilityBlocks[workspaceKey]), demands: PackageCrewDemand[] = initialPackageDemands(workspaceKey, planningMonday())) {
  const required = packageDemand(candidate.packageId, demands)?.qualification;
  if (!required) return [];
  return profile.filter((person) => person.active !== false && person.bound !== false && person.qualifications.includes(required) && !candidate.people.includes(person.name)).filter((person) => {
    const replacement = { ...candidate, people: candidate.people.map((name) => name === replacedPerson ? person.name : name) };
    const assessment = assignmentAssessment(replacement, assignments, workspaceKey, work, profile, demands);
    return !assessment.unqualified.includes(person.name) && !assessment.unavailablePeople.includes(person.name) && !assessment.overlappingPeople.includes(person.name) && !assessment.overCapacity.includes(person.name);
  });
}
