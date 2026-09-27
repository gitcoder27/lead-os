import { TodayCompactRow } from './TodayCompactRow';
import type { TodayRunCommand } from './TodayActionRow';
import type { TodayRailItem } from '@/lib/today-layout';

/**
 * docs/53 U1/U7: one "Promises & meetings" list — only what the queue isn't
 * already showing. No tabs; hidden when there's nothing left over.
 */
export function TodayPromisesList({ items, onRunCommand }: { items: TodayRailItem[]; onRunCommand: TodayRunCommand }) {
  if (items.length === 0) return null;
  return (
    <section className="today-panel" aria-labelledby="today-promises-heading">
      <div className="today-panel-head">
        <h2 id="today-promises-heading" className="today-section-title">Promises &amp; meetings</h2>
        <span className="today-section-count">{items.length}</span>
      </div>
      <div>
        {items.slice(0, 8).map((entry) => {
          const { item } = entry;
          const secondary = entry.kind === 'promise'
            ? item.secondaryActions.find((action) => action.kind === 'snooze')
            : undefined;
          return (
            <TodayCompactRow
              key={item.id}
              title={item.title}
              detail={item.detail}
              severity={item.severity}
              target={item.target}
              primary={item.primaryAction}
              secondary={secondary ? { command: secondary, label: 'Tomorrow', preset: 'tomorrow' } : undefined}
              onRunCommand={onRunCommand}
            />
          );
        })}
      </div>
    </section>
  );
}
