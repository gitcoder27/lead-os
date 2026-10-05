import { TaskPlacementLabel } from '@/components/tasks/TaskPlacementLabel';
import type { TaskPlacementContext } from '@/types';
import { Bell, CalendarClock, Rows3, type LucideIcon } from 'lucide-react';
import type { TodayRunCommand } from './TodayActionRow';
import type { TodayActionCommand, TodayActionSeverity, TodayActionTarget } from '@/types';

interface TodayCompactRowProps {
  title: string;
  placement?: TaskPlacementContext;
  detail?: string;
  severity: TodayActionSeverity;
  target: TodayActionTarget;
  primary: TodayActionCommand;
  /** A second one-tap action (e.g. snooze → tomorrow). */
  secondary?: { command: TodayActionCommand; label: string; preset?: 'tomorrow' };
  icon?: LucideIcon;
  onRunCommand: TodayRunCommand;
}

const iconByTarget: Partial<Record<TodayActionTarget['type'], LucideIcon>> = {
  meeting: CalendarClock,
  manager_desk_item: Rows3,
};

/** One-link rows for promises, meetings, due-soon and wrap-up lists. */
export function TodayCompactRow({ title, placement, detail, severity, target, primary, secondary, icon, onRunCommand }: TodayCompactRowProps) {
  const Icon = icon ?? iconByTarget[target.type] ?? Bell;
  return (
    <div className={`today-row today-tone-${severity}`} data-testid="today-compact-row">
      <span className="today-row-icon" aria-hidden="true">
        <Icon size={14} />
      </span>
      <button type="button" className="today-row-link" onClick={() => onRunCommand({ kind: 'open', label: 'Open', target })}>
        <span className="today-row-title-line">
          <span className="today-row-title">{title}</span>
        </span>
        <TaskPlacementLabel placement={placement} />
        {detail ? <span className="today-row-meta">{detail}</span> : null}
      </button>
      <span className="today-row-actions">
        {secondary ? (
          <button type="button" className="ui-btn-ghost" onClick={() => onRunCommand(secondary.command, secondary.preset)}>
            {secondary.label}
          </button>
        ) : null}
        <button type="button" className="ui-btn" onClick={() => onRunCommand(primary)}>
          {primary.label}
        </button>
      </span>
    </div>
  );
}
