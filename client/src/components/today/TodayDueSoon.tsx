import { TodayCompactRow } from './TodayCompactRow';
import type { TodayRunCommand } from './TodayActionRow';
import type { TodayPromiseItem } from '@/types';

/** docs/53 §5 midday: promises coming due in the next two hours. */
export function TodayDueSoon({ items, onRunCommand }: { items: TodayPromiseItem[]; onRunCommand: TodayRunCommand }) {
  if (items.length === 0) return null;
  return (
    <section className="today-panel" aria-labelledby="today-due-soon-heading">
      <div className="today-panel-head">
        <h2 id="today-due-soon-heading" className="today-section-title">Due in the next 2 hours</h2>
        <span className="today-section-count">{items.length}</span>
      </div>
      <div>
        {items.map((item) => {
          const snooze = item.secondaryActions.find((action) => action.kind === 'snooze');
          return (
            <TodayCompactRow
              key={item.id}
              title={item.title}
              detail={item.detail}
              severity={item.severity}
              target={item.target}
              primary={item.primaryAction}
              secondary={snooze ? { command: snooze, label: 'Tomorrow', preset: 'tomorrow' } : undefined}
              onRunCommand={onRunCommand}
            />
          );
        })}
      </div>
    </section>
  );
}
