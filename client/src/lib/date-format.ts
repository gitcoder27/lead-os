import { differenceInCalendarDays, format, parseISO } from 'date-fns';

/**
 * docs/56 UX-17: one human date style across the Team drawer, waiting lists and 1:1s —
 * "Sat 3 Oct, 10:00" for a moment and "Mon 5 Oct" for a day, with the year only when it differs.
 * Never raw ISO dates or locale strings.
 */
function parse(value: string): Date | null {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseISO(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayPattern(date: Date, reference: Date): string {
  return date.getFullYear() === reference.getFullYear() ? 'EEE d MMM' : 'EEE d MMM yyyy';
}

/** "Sat 3 Oct, 10:00" (local time); '' when there is no value. */
export function formatDayTime(value: string | null | undefined, now = new Date()): string {
  const date = value ? parse(value) : null;
  if (!date) return value ?? '';
  return format(date, `${dayPattern(date, now)}, HH:mm`);
}

/** "Mon 5 Oct" for a `YYYY-MM-DD` day (or the local day of an instant). */
export function formatDay(value: string | null | undefined, today: string): string {
  const date = value ? parse(value) : null;
  if (!date) return value ?? '';
  return format(date, dayPattern(date, parseISO(today)));
}

/** "Mon 5 Oct · tomorrow" — the relative word only for yesterday, today and tomorrow. */
export function formatDayWithRelative(value: string | null | undefined, today: string): string {
  const date = value ? parse(value) : null;
  if (!date) return value ?? '';
  const diff = differenceInCalendarDays(date, parseISO(today));
  const relative = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : diff === -1 ? 'yesterday' : null;
  return relative ? `${formatDay(value, today)} · ${relative}` : formatDay(value, today);
}
