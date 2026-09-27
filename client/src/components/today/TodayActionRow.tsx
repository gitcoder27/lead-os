import { memo } from 'react';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  GitCompareArrows,
  Loader2,
  MessageSquare,
  PlayCircle,
  RefreshCcw,
  Rows3,
  Target,
  UserRoundX,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { formatClock, rowContext, signalChips, type TodayQueueGroup } from '@/lib/today-layout';
import { TodayActionMenu } from './TodayActionMenu';
import type { TodayActionCommand, TodayActionItem, TodayActionItemType } from '@/types';

const iconByType: Record<TodayActionItemType, LucideIcon> = {
  developer_attention: Users,
  overdue_issue: AlertTriangle,
  due_issue: CalendarClock,
  unassigned_issue: UserRoundX,
  high_priority_issue: AlertTriangle,
  stale_check_in: MessageSquare,
  follow_up_due: Bell,
  meeting_outcome: CalendarClock,
  desk_carry_forward: Rows3,
  manual_work: Target,
  sync_attention: RefreshCcw,
  jira_drift: GitCompareArrows,
  one_on_one: CalendarDays,
  standup: PlayCircle,
  calm: CheckCircle2,
};

export type TodayRunCommand = (command: TodayActionCommand, preset?: 'later_today' | 'tomorrow' | 'next_week') => void;

interface TodayActionRowProps {
  item: TodayActionItem;
  /** docs/53 U1: the first row is "Start here" — the only tinted row. */
  featured?: boolean;
  isPending?: boolean;
  /** docs/53 U4: the keyboard-triage cursor is on this row. */
  isActive?: boolean;
  /** The day being viewed — rows from earlier days say where they came from. */
  today?: string;
  onRunCommand: TodayRunCommand;
}

/**
 * docs/53 D4/A2: two lines (title + reasons, then context), three stops —
 * one link that opens the target, the compact primary action, the menu.
 */
export const TodayActionRow = memo(function TodayActionRow({
  item,
  featured = false,
  isPending = false,
  isActive = false,
  today,
  onRunCommand,
}: TodayActionRowProps) {
  const Icon = iconByType[item.type] ?? Target;
  const chips = signalChips(item.signal);
  const openCommand: TodayActionCommand = { kind: 'open', label: 'Open', target: item.target };
  const primaryIsOpen = item.primaryAction.kind === 'open';
  const asked = formatClock(item.askedAt);
  const meta = [rowContext(item, today), item.freshness].filter(Boolean).join(' · ');

  return (
    <div
      className={`today-row today-tone-${item.severity}`}
      data-testid="today-action-row"
      data-row-id={item.id}
      data-featured={featured ? 'true' : undefined}
      data-keyboard-active={isActive ? 'true' : undefined}
      aria-current={isActive ? 'true' : undefined}
    >
      <span className="today-row-icon" aria-hidden="true">
        <Icon size={15} />
      </span>

      <button
        type="button"
        className="today-row-link"
        data-row-link=""
        onClick={() => onRunCommand(openCommand)}
      >
        {featured ? <span className="sr-only">Start here: </span> : null}
        <span className="today-row-title-line">
          <span className="today-row-title">{item.title}</span>
          {chips.map((chip, index) => (
            <span key={chip} className="today-chip" data-quiet={index > 0 ? 'true' : undefined}>
              {chip}
            </span>
          ))}
        </span>
        {asked || item.actionPreview || meta ? (
          <span className="today-row-meta">
            {asked ? <span className="today-row-meta-muted">Asked {asked}{meta || item.actionPreview ? ' · ' : ''}</span> : null}
            {item.actionPreview ? (
              <>
                <span className="today-row-preview">Will set</span> {item.actionPreview}
              </>
            ) : meta}
          </span>
        ) : null}
      </button>

      <span className="today-row-actions">
        {/* Every row ends in its next step; plain "Open …" steps read quieter. */}
        <button
          type="button"
          className={primaryIsOpen && item.type !== 'standup' ? 'today-ghost' : 'today-primary'}
          onClick={() => onRunCommand(item.primaryAction)}
          disabled={isPending}
        >
          {isPending ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : null}
          {item.primaryAction.label}
        </button>
        <TodayActionMenu
          label={item.title}
          actions={item.secondaryActions}
          primary={primaryIsOpen ? undefined : item.primaryAction}
          open={primaryIsOpen ? item.primaryAction : openCommand}
          onRunAction={onRunCommand}
        />
      </span>
    </div>
  );
});

interface TodayGroupRowProps {
  item: TodayActionItem;
  group: TodayQueueGroup;
  expanded: boolean;
  featured?: boolean;
  isActive?: boolean;
  today?: string;
  pendingKey?: (member: TodayActionItem) => boolean;
  onToggle: () => void;
  onRunCommand: TodayRunCommand;
}

/**
 * "5 people · Stale by time · Ask all" — one row for one fact. The row link
 * expands the members in place; each member keeps its own actions.
 */
export function TodayGroupRow({ item, group, expanded, featured = false, isActive = false, today, pendingKey, onToggle, onRunCommand }: TodayGroupRowProps) {
  const Icon = iconByType[item.type] ?? Users;
  return (
    <div role="group" aria-label={`${item.title} · ${group.reason}`} data-testid="today-group">
      <div
        className={`today-row today-tone-${item.severity}`}
        data-testid="today-action-row"
        data-row-id={item.id}
        data-featured={featured ? 'true' : undefined}
        data-keyboard-active={isActive ? 'true' : undefined}
        aria-current={isActive ? 'true' : undefined}
      >
        <span className="today-row-icon" aria-hidden="true">
          <Icon size={15} />
        </span>
        <button type="button" className="today-row-link" data-row-link="" aria-expanded={expanded} onClick={onToggle}>
          {featured ? <span className="sr-only">Start here: </span> : null}
          <span className="today-row-title-line">
            <ChevronRight size={13} aria-hidden="true" className="today-group-chevron" data-open={expanded ? 'true' : undefined} />
            <span className="today-row-title">{item.title}</span>
            <span className="today-chip">{group.reason}</span>
          </span>
          <span className="today-row-meta">{[item.context, item.freshness].filter(Boolean).join(' · ')}</span>
        </button>
        <span className="today-row-actions">
          <button
            type="button"
            className={item.primaryAction.kind === 'open' ? 'today-ghost' : 'today-primary'}
            onClick={() => onRunCommand(item.primaryAction)}
          >
            {item.primaryAction.label}
          </button>
        </span>
      </div>
      {expanded ? (
        <div className="today-group-members">
          {group.members.map((member) => (
            <TodayActionRow
              key={member.id}
              item={member}
              today={today}
              isPending={pendingKey?.(member)}
              onRunCommand={onRunCommand}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
