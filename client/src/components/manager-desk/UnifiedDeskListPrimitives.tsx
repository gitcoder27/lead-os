import type { ReactNode } from 'react';
import { Archive, CheckCircle2, History, Inbox, ListChecks } from 'lucide-react';
import type { ManagerDeskItem } from '@/types/manager-desk';
import type { ManagerDeskQuickFilter } from './workbench-utils';

export const lensCopy: Record<ManagerDeskQuickFilter, { title: string; subtitle: string; empty: string }> = {
  all: {
    title: 'Today',
    subtitle: 'Your desk grouped by the manager rhythm.',
    empty: 'No desk work matches this view.',
  },
  now: {
    title: 'Now',
    subtitle: 'Work already in motion.',
    empty: 'Nothing is in motion right now.',
  },
  planned: {
    title: 'Planned',
    subtitle: 'Committed work and parked follow-ups that have not started yet.',
    empty: 'Nothing is planned in this view.',
  },
  inbox: {
    title: 'Needs triage',
    subtitle: 'Fresh captures waiting for a decision.',
    empty: 'Triage is clear.',
  },
  backlog: {
    title: 'Later',
    subtitle: 'Saved work that is intentionally off your current plate.',
    empty: 'No work has been moved to Later.',
  },
  done: {
    title: 'Done',
    subtitle: 'Resolved work for the current lens.',
    empty: 'No completed work matches this view.',
  },
  carried: {
    title: 'Carried over',
    subtitle: 'Open work that continued from earlier days.',
    empty: 'Nothing continued from earlier days.',
  },
};

export function getCardVariant(item: ManagerDeskItem): 'default' | 'meeting' | 'waiting' | 'inbox' | 'backlog' | 'completed' {
  if (item.status === 'done' || item.status === 'cancelled') return 'completed';
  if (item.status === 'backlog') return 'backlog';
  if (item.status === 'inbox') return 'inbox';
  if (item.kind === 'meeting') return 'meeting';
  if (item.status === 'waiting' || item.kind === 'waiting') return 'waiting';
  return 'default';
}

export function SignalChip({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: 'accent' | 'muted' | 'success';
}) {
  const color = tone === 'success' ? 'var(--success)' : tone === 'accent' ? 'var(--md-accent)' : 'var(--text-secondary)';
  const background = tone === 'success' ? 'rgba(16,185,129,0.10)' : tone === 'accent' ? 'var(--md-accent-glow)' : 'var(--bg-secondary)';

  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]"
      style={{ borderColor: 'var(--border)', background, color }}
    >
      {icon}
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
}

export function UnifiedEmptyState({
  quickFilter,
  message,
}: {
  quickFilter: ManagerDeskQuickFilter;
  message: string;
}) {
  const Icon = quickFilter === 'done'
    ? CheckCircle2
    : quickFilter === 'inbox'
    ? Inbox
    : quickFilter === 'backlog'
    ? Archive
    : quickFilter === 'carried'
    ? History
    : ListChecks;

  return (
    <div
      className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed px-4 text-center"
      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
    >
      <div
        className="flex h-9 w-9 items-center justify-center rounded-xl"
        style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
      >
        <Icon size={16} />
      </div>
      <p className="mt-3 text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>
        {message}
      </p>
    </div>
  );
}
