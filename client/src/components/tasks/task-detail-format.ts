import { addDays, differenceInCalendarDays, format, parseISO, setHours, setMinutes, startOfDay } from 'date-fns';
import type { TaskStatus } from '@/types';
import { isOpenStatus, nextMonday } from '@/lib/task-list';
import { getLocalIsoDate } from '@/lib/utils';

export type DateTone = 'default' | 'accent' | 'warning' | 'danger' | 'muted';

export interface DateDisplay {
  label: string;
  /** Secondary context, e.g. "3d ago" — rendered muted next to the label. */
  hint?: string;
  tone: DateTone;
}

function safeParse(value: string): Date | null {
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayName(date: Date, now: Date): string {
  const diff = differenceInCalendarDays(date, now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return format(date, 'EEEE');
  return format(date, date.getFullYear() === now.getFullYear() ? 'EEE, MMM d' : 'MMM d, yyyy');
}

/** A plan date (`YYYY-MM-DD`) as a human label with slip context for open work. */
export function describePlanDate(value: string | null, status: TaskStatus, today = getLocalIsoDate()): DateDisplay | null {
  if (!value) return null;
  const date = safeParse(value);
  if (!date) return { label: value, tone: 'default' };
  const now = parseISO(today);
  const diff = differenceInCalendarDays(date, now);
  const open = isOpenStatus(status);
  if (!open) return { label: dayName(date, now), tone: 'muted' };
  if (diff === 0) return { label: 'Today', tone: 'accent' };
  if (diff < 0) return { label: dayName(date, now), hint: `${-diff}d ago`, tone: -diff > 2 ? 'danger' : 'warning' };
  return { label: dayName(date, now), tone: 'default' };
}

/** A moment (ISO datetime) as "Tomorrow, 09:00"; past follow-ups on open work read as due. */
export function describeMoment(value: string | null, status: TaskStatus, now = new Date()): DateDisplay | null {
  if (!value) return null;
  const date = safeParse(value);
  if (!date) return { label: value, tone: 'default' };
  const label = `${dayName(date, now)}, ${format(date, 'HH:mm')}`;
  if (!isOpenStatus(status)) return { label, tone: 'muted' };
  if (date.getTime() < now.getTime()) return { label, hint: 'due', tone: 'warning' };
  if (differenceInCalendarDays(date, now) === 0) return { label, tone: 'accent' };
  return { label, tone: 'default' };
}

export function toneColor(tone: DateTone): string {
  switch (tone) {
    case 'accent': return 'var(--accent)';
    case 'warning': return 'var(--warning)';
    case 'danger': return 'var(--danger)';
    case 'muted': return 'var(--text-muted)';
    default: return 'var(--text-primary)';
  }
}

/** Full timestamp for metadata ("Sep 20, 2026 · 14:00"). */
export function formatStamp(value: string | null | undefined): string {
  if (!value) return '—';
  const date = safeParse(value);
  return date ? format(date, 'MMM d, yyyy · HH:mm') : value;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : parts[0]!.charAt(1);
  return `${first}${last}`.toUpperCase();
}

/** Stable hue per person so avatars are recognisable across the app. */
export function avatarHue(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  return Math.abs(hash) % 360;
}

export interface MomentPreset {
  key: string;
  label: string;
  hint: string;
  value: string;
}

/** Follow-up shortcuts, all landing at 09:00 local. */
export function followUpPresets(now = new Date()): MomentPreset[] {
  const at9 = (date: Date) => setMinutes(setHours(startOfDay(date), 9), 0);
  const today = getLocalIsoDate(now);
  const tomorrow = at9(addDays(now, 1));
  const inThree = at9(addDays(now, 3));
  const monday = at9(parseISO(nextMonday(today)));
  return [
    { key: 'tomorrow', label: 'Tomorrow', hint: format(tomorrow, 'EEE HH:mm'), value: tomorrow.toISOString() },
    { key: 'three', label: 'In 3 days', hint: format(inThree, 'EEE HH:mm'), value: inThree.toISOString() },
    { key: 'monday', label: 'Next Monday', hint: format(monday, 'MMM d'), value: monday.toISOString() },
  ];
}

/** `datetime-local` input value for an ISO instant, in local time. */
export function toLocalDateTimeInputValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

/** Compact display for an external URL: host + path, no scheme. */
export function prettyUrl(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname === '/' ? '' : url.pathname;
    return `${url.host}${path}`;
  } catch {
    return value;
  }
}
