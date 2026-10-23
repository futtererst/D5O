/** Presentation only: compare a published shift with its Work-pinned local time zone. */
export function bookingLocalDate(now: Date, timeZone?: string): string {
  if (!timeZone) return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${value("year")}-${value("month")}-${value("day")}`;
  } catch { return ""; }
}

export function bookingShiftEnded(date: string | undefined, shift: string, now: Date, timeZone?: string): boolean {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const startDay = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(startDay.getTime()) || startDay.toISOString().slice(0, 10) !== date) return false;
  const today = bookingLocalDate(now, timeZone);
  if (!today) return false;
  const match = /^(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})$/.exec(shift.trim());
  if (!match) return date < today;
  const [, sh, sm, eh, em] = match.map(Number);
  if (sh > 23 || eh > 23 || sm > 59 || em > 59) return false;
  const endDate = eh * 60 + em <= sh * 60 + sm
    ? new Date(startDay.getTime() + 86400000).toISOString().slice(0, 10) : date;
  let localHour: number, localMinute: number;
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
      localHour = Number(parts.find((part) => part.type === "hour")?.value);
      localMinute = Number(parts.find((part) => part.type === "minute")?.value);
    } catch { return false; }
  } else { localHour = now.getHours(); localMinute = now.getMinutes(); }
  return today > endDate || (today === endDate && localHour * 60 + localMinute >= eh * 60 + em);
}