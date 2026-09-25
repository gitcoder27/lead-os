import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  MessageSquare,
  Rows3,
  Target,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { TodayActionMenu } from './TodayActionMenu';
import { todayToneStyles } from './today-design';
import type { TodayActionCommand, TodayActionItem, TodayActionItemType } from '@/types';

const iconByType: Record<TodayActionItemType, LucideIcon> = {
  developer_attention: Users,
  overdue_issue: AlertTriangle,
  due_issue: CalendarClock,
  unassigned_issue: Users,
  stale_check_in: MessageSquare,
  follow_up_due: Bell,
  meeting_outcome: CalendarClock,
  desk_carry_forward: Rows3,
  manual_work: Target,
  sync_attention: AlertTriangle,
  jira_drift: AlertTriangle,
  calm: CheckCircle2,
};

interface TodayActionRowProps {
  item: TodayActionItem;
  featured?: boolean;
  isPending?: boolean;
  onRunCommand: (command: TodayActionCommand, preset?: 'later_today' | 'tomorrow' | 'next_week') => void;
}

export function TodayActionRow({ item, featured = false, isPending = false, onRunCommand }: TodayActionRowProps) {
  const Icon = iconByType[item.type] ?? Target;
  const style = todayToneStyles[item.severity];
  const displaySignal = getCompactSignal(item.signal);

  return (
    <div
      className="grid w-full grid-cols-[32px_minmax(0,1fr)] gap-4 rounded-lg px-3.5 py-3.5 text-left transition-colors hover:bg-[var(--today-hover)] md:grid-cols-[32px_minmax(0,1.15fr)_minmax(130px,0.65fr)_112px_154px_34px]"
      style={{
        background: featured ? `linear-gradient(90deg, color-mix(in srgb, ${style.color} 4%, transparent), transparent)` : 'transparent',
        boxShadow: featured ? `inset 0 0 0 1px color-mix(in srgb, ${style.color} 12%, var(--today-line))` : 'inset 0 -1px 0 var(--today-line)',
      }}
      data-testid="today-action-row"
    >
      <button
        type="button"
        onClick={() => onRunCommand({ kind: 'open', label: 'Open', target: item.target })}
        className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-tertiary)]"
        style={{ color: style.color }}
        aria-label={`Open ${item.title}`}
      >
        <Icon size={16} />
      </button>

      <button
        type="button"
        onClick={() => onRunCommand({ kind: 'open', label: 'Open', target: item.target })}
        className="min-w-0 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>{item.title}</span>
          <span
            className="rounded-md border px-1.5 py-0.5 text-[11px] font-medium md:hidden"
            style={{ background: style.bg, borderColor: style.border, color: style.color }}
            title={item.signal}
          >
            {displaySignal}
          </span>
        </span>
        <span className="mt-1 block truncate text-[12px] leading-5 md:hidden" style={{ color: 'var(--text-secondary)' }}>{item.context}</span>
        {item.actionPreview ? (
          <span className="block truncate text-[12px] leading-5 md:hidden" style={{ color: 'var(--text-muted)' }} title={`Will set: ${item.actionPreview}`}>
            <span style={{ color: 'var(--accent)' }}>Will set:</span> {item.actionPreview}
          </span>
        ) : null}
      </button>

      <button
        type="button"
        onClick={() => onRunCommand({ kind: 'open', label: 'Open', target: item.target })}
        className="hidden min-w-0 text-left md:block"
      >
        <span className="block truncate text-[13px] leading-5" style={{ color: 'var(--text-secondary)' }}>{item.context}</span>
        {item.actionPreview ? (
          <span className="mt-0.5 block truncate text-[12px] leading-5" style={{ color: 'var(--text-muted)' }} title={`Will set: ${item.actionPreview}`}>
            <span style={{ color: 'var(--accent)' }}>Will set:</span> {item.actionPreview}
          </span>
        ) : null}
      </button>

      <span className="hidden md:block">
        <span
          className="inline-flex max-w-full items-center truncate rounded-md border px-2 py-1 text-[11px] font-medium"
          style={{ background: style.bg, borderColor: style.border, color: style.color }}
          title={item.signal}
        >
          {displaySignal}
        </span>
      </span>

      <button
        type="button"
        onClick={() => onRunCommand(item.primaryAction)}
        disabled={isPending}
        className="hidden items-center justify-end gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-50 md:flex"
        style={{ color: 'var(--accent)' }}
      >
        {isPending ? 'Working' : item.primaryAction.label}
      </button>

      <TodayActionMenu actions={item.secondaryActions} onRunAction={onRunCommand} />
    </div>
  );
}

function getCompactSignal(signal: string): string {
  if (signal.includes('Stale without current work')) {
    return 'Stale';
  }

  return signal
    .split(' / ')[0] ?? signal;
}
