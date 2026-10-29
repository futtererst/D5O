/** One booking records the person's effort in its exact shift, not the total project estimate. */
export function personHoursForShift(shift: string): number {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(shift);
  if (!match) return 0;
  const [, startHour, startMinute, endHour, endMinute] = match.map(Number);
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return 0;
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  if (start === end) return 0;
  const minutes = (end - start + 1440) % 1440;
  const effort = minutes - (minutes >= 360 ? 30 : 0);
  return Math.round(effort / 60 * 100) / 100;
}
