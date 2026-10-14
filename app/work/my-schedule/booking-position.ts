/** Presentation only: compare a published shift with the worker device clock. */
export function bookingShiftEnded(date: string | undefined, shift: string, now: Date): boolean {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  const startOfDay = new Date(year, month - 1, day);
  if (Number.isNaN(startOfDay.getTime()) || startOfDay.getFullYear() !== year ||
    startOfDay.getMonth() !== month - 1 || startOfDay.getDate() !== day) return false;
  const match = /^(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})$/.exec(shift.trim());
  if (!match) return startOfDay.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const [, sh, sm, eh, em] = match.map(Number);
  if (sh > 23 || eh > 23 || sm > 59 || em > 59) return false;
  const start = new Date(year, month - 1, day, sh, sm);
  const end = new Date(year, month - 1, day, eh, em);
  if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
  return now.getTime() >= end.getTime();
}
