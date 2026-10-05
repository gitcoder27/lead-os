import { useState } from 'react';
import { CalendarDays, Rows3, type LucideIcon } from 'lucide-react';
import { rowContext } from '@/lib/today-layout';
import { TodayCompactRow } from './TodayCompactRow';
import type { TodayRunCommand } from './TodayActionRow';
import type { TodayActionItem } from '@/types';

interface TodayPanelListProps {
  title: string;
  items: TodayActionItem[];
  today: string;
  icon: 'calendar' | 'desk';
  /** One move for the whole list (e.g. "Carry all 7"). */
  bulk?: { label: string; onRun: () => void };
  onRunCommand: TodayRunCommand;
}

const PREVIEW = 3;
const icons: Record<TodayPanelListProps['icon'], LucideIcon> = { calendar: CalendarDays, desk: Rows3 };

/** Stage-panel list of queue-type rows the panel owns (1:1s, carry-forward). */
export function TodayPanelList({ title, items, today, icon, bulk, onRunCommand }: TodayPanelListProps) {
  const [showAll, setShowAll] = useState(false);
  if (items.length === 0) return null;
  const visible = showAll ? items : items.slice(0, PREVIEW);

  return (
    <section className="today-panel" aria-label={title}>
      <div className="today-panel-head">
        <h2 className="today-section-title">{title}</h2>
        <span className="today-section-count">{items.length}</span>
        {bulk ? (
          <span className="today-section-actions">
            <button type="button" className="ui-btn ui-btn-sm" onClick={bulk.onRun}>{bulk.label}</button>
          </span>
        ) : null}
      </div>
      {visible.map((item) => {
        const secondary = item.secondaryActions.find((action) => action.kind === 'mark_done');
        return (
          <TodayCompactRow
            key={item.id}
            icon={icons[icon]}
            title={item.title}
              placement={item.placement}
            detail={rowContext(item, today)}
            severity={item.severity}
            target={item.target}
            primary={item.primaryAction.kind === 'carry_forward' ? { ...item.primaryAction, label: 'Carry' } : item.primaryAction}
            secondary={secondary ? { command: secondary, label: 'Done' } : undefined}
            onRunCommand={onRunCommand}
          />
        );
      })}
      {items.length > PREVIEW ? (
        <button type="button" className="today-panel-more" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Show fewer' : `+${items.length - PREVIEW} more`}
        </button>
      ) : null}
    </section>
  );
}
