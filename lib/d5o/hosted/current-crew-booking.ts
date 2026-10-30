type Slot = { date: string; shift: string };
type Booking = { id?: string; workId?: string; packageId?: string; date?: string;
  shift?: string; week?: number };
type Publication = { id?: string; week?: number; assignments?: Booking[] };

export function currentCrewBooking<T extends Booking>(
  assignments: T[], publications: Publication[], workId: string,
  packageId: string, slot: Slot | undefined,
) {
  const scoped = assignments.filter((item) => item.workId === workId
    && item.packageId === packageId);
  const current = slot ? scoped.findLast((item) => item.date === slot.date
    && item.shift === slot.shift) : undefined;
  const prior = slot ? scoped.findLast((item) => item.date !== slot.date
    || item.shift !== slot.shift) : undefined;
  const publishedCandidate = current && publications.findLast((item) =>
    (item.assignments ?? []).some((assignment) => assignment.id === current.id
      && assignment.date === current.date && assignment.shift === current.shift));
  const published = publishedCandidate && publications.findLast((item) =>
    item.week === publishedCandidate.week)?.id === publishedCandidate.id
    ? publishedCandidate : undefined;
  const priorPublication = slot && publications.findLast((item) =>
    (item.assignments ?? []).some((assignment) => assignment.workId === workId
      && assignment.packageId === packageId
      && (assignment.date !== slot.date || assignment.shift !== slot.shift)));
  const activePriorPublication = priorPublication && publications.findLast((item) =>
    item.week === priorPublication.week)?.id === priorPublication.id
    ? priorPublication : undefined;
  return { current, prior, published, activePriorPublication };
}
