import type { TaskInboxItem, TaskInboxKind } from '@/types';
import { friendlyEventValue } from '@/lib/task-activity';

export const INBOX_KIND_LABELS: Record<TaskInboxKind, string> = {
  assignment: 'Assignment changed',
  instruction: 'Instruction',
  reply: 'Reply',
  blocker: 'Blocker raised',
  blocker_cleared: 'Blocker cleared',
  schedule: 'Date changed',
  priority: 'Priority changed',
};

export interface InboxAlertText {
  title: string;
  body: string;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The one-line "what changed" under a date or priority update, worded in the viewer's own calendar. */
export function describeInboxChange(item: Pick<TaskInboxItem, 'change'>): string | undefined {
  const change = item.change;
  if (!change) return undefined;
  const from = change.from ? friendlyEventValue(change.from) : null;
  const to = change.to ? friendlyEventValue(change.to) : null;
  switch (change.field) {
    case 'day':
      if (!to) return 'Taken off the plan';
      return from ? `Moved from ${from} to ${to}` : `Planned for ${to}`;
    case 'due_at':
      if (!to) return 'Due date cleared';
      return from ? `Due ${to} (was ${from})` : `Due ${to}`;
    case 'priority':
      return change.to === 'high' ? 'Now high priority' : 'Back to normal priority';
  }
}

/** The one line under a task in the inbox: who did what, as briefly as it can be said. */
export function inboxSummary(item: TaskInboxItem): string {
  const who = firstName(item.actorName);
  const change = describeInboxChange(item);
  switch (item.kind) {
    case 'assignment': return `${who} assigned this`;
    case 'instruction':
    case 'reply': return `${who}: ${item.excerpt}`;
    case 'blocker': return `${who} raised a blocker · ${item.excerpt}`;
    case 'blocker_cleared': return `${who} cleared the blocker`;
    case 'schedule':
    case 'priority': return `${who} · ${change ?? INBOX_KIND_LABELS[item.kind]}`;
  }
}

/** "now", "5m", "3h", "2d", then a date: short enough to sit beside a title. */
export function compactAge(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** What a single update says in a desktop notification or toast: who, what, which task. */
export function describeInboxAlert(item: TaskInboxItem): InboxAlertText {
  const who = firstName(item.actorName);
  const task = `${item.taskKey} · ${item.title}`;
  const change = describeInboxChange(item);
  switch (item.kind) {
    case 'assignment':
      return { title: `${who} assigned ${item.taskKey}`, body: item.title };
    case 'instruction':
      return { title: `${who} sent an instruction`, body: `${task}\n${clip(item.excerpt, 140)}` };
    case 'reply':
      return { title: `${who} replied on ${item.taskKey}`, body: `${item.title}\n${clip(item.excerpt, 140)}` };
    case 'blocker':
      return { title: `${who} flagged a blocker on ${item.taskKey}`, body: `${item.title}\n${clip(item.excerpt, 140)}` };
    case 'blocker_cleared':
      return { title: `Blocker cleared on ${item.taskKey}`, body: item.title };
    case 'schedule': {
      const due = item.change?.field === 'due_at';
      return { title: `${who} ${due ? 'changed the due date on' : 'rescheduled'} ${item.taskKey}`, body: `${item.title}\n${change ?? 'Date changed'}` };
    }
    case 'priority':
      return {
        title: item.change?.to === 'high' ? `${who} marked ${item.taskKey} high priority` : `${who} lowered the priority of ${item.taskKey}`,
        body: item.title,
      };
  }
}

/** Several updates at once read as one notification, not a stack. */
export function describeInboxBatch(items: TaskInboxItem[]): InboxAlertText {
  const shown = items.slice(0, 3).map((item) => `${item.taskKey} · ${INBOX_KIND_LABELS[item.kind]}`);
  if (items.length > shown.length) shown.push(`+${items.length - shown.length} more`);
  return { title: `${items.length} new updates`, body: shown.join('\n') };
}

const UNREAD_PREFIX = /^\(\d+\+?\)\s/;

/** "(3) LeadOS": the count rides in the tab title so a background tab still says something changed. */
export function titleWithUnread(title: string, unread: number): string {
  const base = title.replace(UNREAD_PREFIX, '');
  return unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${base}` : base;
}

let faviconSource: Promise<string | null> | undefined;
const loadFavicon = (href: string) => (faviconSource ??= typeof fetch === 'function'
  ? fetch(href).then((response) => (response.ok ? response.text() : null)).catch(() => null)
  : Promise.resolve(null));

/**
 * Draws a small red dot on the tab icon while updates are waiting. It is a flourish: any failure
 * (no icon link, no fetch, a blocked request) leaves the original icon and the title count in place.
 */
export async function setFaviconBadge(on: boolean): Promise<void> {
  const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) return;
  const original = (link.dataset.originalHref ??= link.getAttribute('href') ?? '');
  link.dataset.badgeWanted = on ? 'on' : 'off';
  if (!on) {
    if (link.getAttribute('href') !== original) link.setAttribute('href', original);
    return;
  }
  const svg = await loadFavicon(original);
  // The badge may have been switched off again while the icon was loading.
  if (!svg || link.dataset.badgeWanted === 'off') return;
  const dot = '<circle cx="172" cy="44" r="38" fill="#EF4444" stroke="#09090B" stroke-width="10"/>';
  link.setAttribute('href', `data:image/svg+xml,${encodeURIComponent(svg.replace('</svg>', `${dot}</svg>`))}`);
}
