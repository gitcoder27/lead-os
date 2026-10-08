import { ArrowRight, CalendarClock, CalendarDays, Flag, Hash, Hourglass, Inbox, Link2, NotebookPen, Repeat, Tags, UserRound, Users } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { CaptureTokenKind, ResolvedCapture } from 'shared/capture-grammar';
import { taskLabelDisplayName } from '@/types';

/**
 * The capture preview vocabulary, shared by the capture box and the public
 * landing page's demo so both describe a capture in the same words.
 */

/** Per-kind token highlight colors — the live preview paints these in-place. */
export const CAPTURE_TOKEN_COLORS: Record<CaptureTokenKind, string> = {
  command: 'var(--md-accent)',
  person: 'var(--accent)',
  jira: 'var(--info)',
  parent: 'var(--success)',
  taskref: 'var(--success)',
  date: 'var(--warning)',
  due: 'var(--danger)',
  priority: 'var(--danger)',
  later: 'var(--text-muted)',
  meeting: 'var(--md-accent)',
  followup: 'var(--warning)',
  waiting: 'var(--warning)',
  label: 'var(--accent)',
};

export const CAPTURE_TOKEN_BG: Record<CaptureTokenKind, string> = {
  command: 'color-mix(in srgb, var(--md-accent) 12%, transparent)',
  person: 'var(--accent-glow)',
  jira: 'color-mix(in srgb, var(--info) 14%, transparent)',
  parent: 'color-mix(in srgb, var(--success) 12%, transparent)',
  taskref: 'color-mix(in srgb, var(--success) 12%, transparent)',
  date: 'color-mix(in srgb, var(--warning) 14%, transparent)',
  due: 'color-mix(in srgb, var(--danger) 12%, transparent)',
  priority: 'color-mix(in srgb, var(--danger) 12%, transparent)',
  later: 'var(--bg-tertiary)',
  meeting: 'color-mix(in srgb, var(--md-accent) 12%, transparent)',
  followup: 'color-mix(in srgb, var(--warning) 12%, transparent)',
  waiting: 'color-mix(in srgb, var(--warning) 12%, transparent)',
  label: 'var(--accent-glow)',
};

export function CaptureChip({ icon, children, tone }: { icon?: React.ReactNode; children: React.ReactNode; tone?: 'error' | 'warning' }) {
  const color = tone === 'error' ? 'var(--danger)' : tone === 'warning' ? 'var(--warning)' : 'var(--text-secondary)';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium"
      style={{ background: 'var(--bg-tertiary)', color, border: '1px solid var(--border)' }}
    >
      {icon}
      {children}
    </span>
  );
}

/** The structured summary under a capture: one chip per thing the text was understood as. */
export function summarizeCapture(resolved: ResolvedCapture, developerNames: Map<string, string>, omitOwner = false) {
  const Chip = CaptureChip;
  const chips: React.ReactNode[] = [];
  if (resolved.intent === 'update') {
    chips.push(<Chip key="intent" icon={<ArrowRight size={10} />}>Update {resolved.updateTargetKey}</Chip>);
  } else if (resolved.intent === 'note') {
    chips.push(<Chip key="intent" icon={<NotebookPen size={10} />}>Today's note</Chip>);
  }
  if (resolved.owner && !omitOwner) {
    chips.push(<Chip key="owner" icon={<UserRound size={10} />}>{developerNames.get(resolved.owner.accountId) ?? resolved.owner.accountId}</Chip>);
  }
  if (resolved.waitingOn) {
    chips.push(<Chip key="waiting" icon={<Hourglass size={10} />}>Waiting on {resolved.waitingOn.displayName}</Chip>);
  }
  if (resolved.meeting) chips.push(<Chip key="meeting" icon={<Users size={10} />}>Meeting</Chip>);
  if (resolved.later) {
    chips.push(<Chip key="later" icon={<Repeat size={10} />}>Later{resolved.hideUntil ? ` · back ${format(parseISO(resolved.hideUntil), 'EEE, MMM d')}` : ''}</Chip>);
  } else if (resolved.intent === 'create' && !resolved.owner && !omitOwner && !resolved.scheduledOn && !resolved.dueOn && !resolved.followUp && !resolved.waitingOn) {
    chips.push(<Chip key="inbox" icon={<Inbox size={10} />}>Inbox</Chip>);
  }
  if (resolved.priority === 'high') chips.push(<Chip key="prio" icon={<Flag size={10} />}>High priority</Chip>);
  // docs/56 UX-06: each date chip says what it was understood as — a plan date or a check-by date.
  if (resolved.scheduledOn) {
    chips.push(<Chip key="date" icon={<CalendarDays size={10} />}>Plan {format(parseISO(resolved.scheduledOn), 'EEE, MMM d')}</Chip>);
  }
  if (resolved.dueOn) {
    chips.push(<Chip key="due" icon={<CalendarClock size={10} />}>Due {format(parseISO(resolved.dueOn), 'EEE, MMM d')}</Chip>);
  }
  if (resolved.followUpAt) {
    chips.push(<Chip key="fu" icon={<CalendarClock size={10} />}>Check {format(parseISO(resolved.followUpAt), 'EEE, MMM d')}</Chip>);
  } else if (resolved.followUp && !resolved.waitingOn) {
    chips.push(<Chip key="fu" icon={<CalendarDays size={10} />}>Follow-up</Chip>);
  }
  for (const label of resolved.labels.filter((l) => l !== 'category:follow_up')) {
    chips.push(<Chip key={`label-${label}`} icon={<Tags size={10} />}>+{taskLabelDisplayName(label)}</Chip>);
  }
  for (const link of resolved.jiraLinks) {
    chips.push(<Chip key={`jira-${link.key}`} icon={<Hash size={10} />}>{link.key}{link.primary ? ' ●' : ''}</Chip>);
  }
  for (const key of resolved.taskLinks) {
    chips.push(<Chip key={`task-${key}`} icon={<Link2 size={10} />}>{key}</Chip>);
  }
  if (resolved.parentKey) chips.push(<Chip key="parent" icon={<Link2 size={10} />}>child of {resolved.parentKey}</Chip>);
  for (const person of resolved.peopleLinks) {
    chips.push(<Chip key={`pl-${person.kind ?? 'developer'}-${person.accountId}`} icon={<UserRound size={10} />}>↔ {person.displayName || (developerNames.get(person.accountId) ?? person.accountId)}</Chip>);
  }
  return chips;
}
