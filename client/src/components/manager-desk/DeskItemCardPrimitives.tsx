import type { CSSProperties, ReactNode } from 'react';
import {
  ArrowRight,
  Archive,
  Ban,
  CalendarCheck,
  CircleCheck,
  Clock,
  Scale,
  Zap,
} from 'lucide-react';
import { differenceInCalendarDays, format, isPast, isToday, isTomorrow, parseISO } from 'date-fns';
import type { ManagerDeskItem, ManagerDeskStatus } from '@/types/manager-desk';

export type DeskItemVariant = 'default' | 'meeting' | 'waiting' | 'inbox' | 'backlog' | 'completed';
export type SignalTone = 'neutral' | 'accent' | 'warning' | 'danger' | 'success';

export type RowQuickAction = {
  label: string;
  status: ManagerDeskStatus;
  icon: ReactNode;
  secondary?: boolean;
  style: CSSProperties;
};

export const kindIcons = {
  action: Zap,
  meeting: CalendarCheck,
  decision: Scale,
  waiting: Clock,
};

export const priorityColors: Record<ManagerDeskItem['priority'], string> = {
  critical: 'var(--danger)',
  high: 'var(--warning)',
  medium: 'var(--md-accent)',
  low: 'var(--text-muted)',
};

export const statusTone: Record<ManagerDeskStatus, CSSProperties> = {
  inbox: { background: 'transparent', color: 'var(--text-secondary)', border: '1px solid transparent' },
  planned: { background: 'transparent', color: 'var(--md-accent)', border: '1px solid transparent' },
  in_progress: { background: 'rgba(6,182,212,0.10)', color: 'var(--accent)', border: '1px solid rgba(6,182,212,0.22)' },
  waiting: { background: 'rgba(245,158,11,0.10)', color: 'var(--warning)', border: '1px solid rgba(245,158,11,0.22)' },
  backlog: { background: 'color-mix(in srgb, var(--bg-secondary) 70%, transparent)', color: 'var(--text-secondary)', border: '1px solid color-mix(in srgb, var(--border) 70%, transparent)' },
  done: { background: 'rgba(16,185,129,0.10)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.20)' },
  cancelled: { background: 'transparent', color: 'var(--text-muted)', border: '1px solid transparent' },
};

export function SignalChip({
  icon,
  label,
  tone = 'neutral',
  style,
  title,
}: {
  icon?: ReactNode;
  label: string;
  tone?: SignalTone;
  style?: CSSProperties;
  title?: string;
}) {
  const toneStyle: Record<SignalTone, CSSProperties> = {
    neutral: { background: 'transparent', color: 'var(--text-secondary)', border: '1px solid transparent' },
    accent: { background: 'rgba(6,182,212,0.10)', color: 'var(--accent)', border: '1px solid rgba(6,182,212,0.20)' },
    warning: { background: 'rgba(245,158,11,0.10)', color: 'var(--warning)', border: '1px solid rgba(245,158,11,0.20)' },
    danger: { background: 'rgba(239,68,68,0.10)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.22)' },
    success: { background: 'rgba(16,185,129,0.10)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.20)' },
  };

  return (
    <span
      className="inline-flex max-w-[180px] items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em]"
      style={style ?? toneStyle[tone]}
      title={title ?? label}
    >
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}

function createQuickActions(item: ManagerDeskItem) {
  const start = {
    label: item.status === 'backlog' ? 'Bring back' : item.status === 'inbox' ? 'Plan' : 'Start',
    status: item.status === 'backlog' ? 'inbox' as const : item.status === 'inbox' ? 'planned' as const : 'in_progress' as const,
    icon: <ArrowRight size={10} />,
    style: { background: 'var(--md-accent-glow)', color: 'var(--md-accent)', borderColor: 'color-mix(in srgb, var(--md-accent) 32%, transparent)' },
  };
  const done = {
    label: 'Done',
    status: 'done' as const,
    icon: <CircleCheck size={10} />,
    style: { background: 'rgba(16,185,129,0.10)', color: 'var(--success)', borderColor: 'rgba(16,185,129,0.22)' },
  };
  const drop = {
    label: 'Drop',
    status: 'cancelled' as const,
    icon: <Ban size={10} />,
    secondary: true,
    style: { background: 'var(--bg-secondary)', color: 'var(--text-muted)', borderColor: 'var(--border)' },
  };
  const moveLater = {
    label: 'Move to later',
    status: 'backlog' as const,
    icon: <Archive size={10} />,
    secondary: true,
    style: { background: 'var(--bg-secondary)', color: 'var(--text-secondary)', borderColor: 'var(--border)' },
  };
  return { start, done, drop, moveLater };
}

export function getPrimaryQuickAction(item: ManagerDeskItem): RowQuickAction | null {
  if (item.status === 'done' || item.status === 'cancelled') return null;

  const { start, done } = createQuickActions(item);
  if (item.status === 'in_progress') return done;
  return start;
}

export function getSecondaryQuickActions(item: ManagerDeskItem): RowQuickAction[] {
  if (item.status === 'done' || item.status === 'cancelled') return [];

  const { done, drop, moveLater } = createQuickActions(item);
  const laterActions = item.delegatedExecution ? [] : [moveLater];
  const terminalActions = item.delegatedExecution ? [done] : [done, drop];

  if (item.status === 'backlog') return item.delegatedExecution ? [] : [drop];
  if (item.status === 'in_progress') return [...laterActions, ...(!item.delegatedExecution ? [drop] : [])];
  if (item.status === 'waiting') return [...laterActions, ...terminalActions];
  return [...laterActions, ...terminalActions];
}

export function getKindBackground(variant: DeskItemVariant) {
  if (variant === 'meeting') return 'rgba(139,92,246,0.12)';
  if (variant === 'waiting') return 'rgba(245,158,11,0.12)';
  if (variant === 'backlog') return 'color-mix(in srgb, var(--bg-secondary) 78%, transparent)';
  if (variant === 'completed') return 'rgba(16,185,129,0.10)';
  return 'var(--bg-secondary)';
}

export function getKindColor(variant: DeskItemVariant, status: ManagerDeskStatus) {
  if (variant === 'meeting') return 'var(--info)';
  if (variant === 'waiting') return 'var(--warning)';
  if (variant === 'backlog') return 'var(--text-secondary)';
  if (variant === 'completed') return 'var(--success)';
  if (status === 'in_progress') return 'var(--accent)';
  return 'var(--text-secondary)';
}

export function getIsOverdue(item: ManagerDeskItem) {
  if (!item.followUpAt || item.status === 'backlog' || item.status === 'done' || item.status === 'cancelled') return false;
  try {
    return isPast(parseISO(item.followUpAt));
  } catch {
    return false;
  }
}

export function getDateSignal(item: ManagerDeskItem, isOverdue: boolean) {
  const dateValue = item.followUpAt ?? item.plannedStartAt ?? item.plannedEndAt;
  if (item.status === 'waiting') {
    const days = getWaitingDays(item);
    if (days > 0) return { label: `Pending ${days}d`, tone: days > 1 ? 'warning' as const : 'neutral' as const };
    return { label: 'Pending today', tone: 'neutral' as const };
  }
  if (!dateValue) return null;
  try {
    const parsed = parseISO(dateValue);
    if (isOverdue) return { label: `Overdue ${format(parsed, 'MMM d')}`, tone: 'danger' as const };
    if (isToday(parsed)) return { label: item.followUpAt ? `Due ${format(parsed, 'HH:mm')}` : format(parsed, 'HH:mm'), tone: 'accent' as const };
    if (isTomorrow(parsed)) return { label: 'Tomorrow', tone: 'neutral' as const };
    return { label: format(parsed, 'MMM d'), tone: 'neutral' as const };
  } catch {
    return null;
  }
}

function getWaitingDays(item: ManagerDeskItem) {
  try {
    return Math.max(0, differenceInCalendarDays(new Date(), parseISO(item.updatedAt)));
  } catch {
    return 0;
  }
}
