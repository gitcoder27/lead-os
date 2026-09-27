import { Target } from 'lucide-react';
import { TodayActionRow } from './TodayActionRow';
import type { TodayActionCommand, TodayActionItem } from '@/types';

interface TodayActionQueueProps {
  items: TodayActionItem[];
  pendingTargetKey?: string;
  onRunCommand: (command: TodayActionCommand, preset?: 'later_today' | 'tomorrow' | 'next_week') => void;
}

export function TodayActionQueue({ items, pendingTargetKey, onRunCommand }: TodayActionQueueProps) {
  const visibleItems = items.slice(0, 8);
  const hiddenCount = Math.max(items.length - visibleItems.length, 0);

  return (
    <section className="min-h-0 overflow-auto border-b px-5 py-5 lg:border-b-0 lg:border-r xl:px-8" style={{ borderColor: 'var(--today-line-strong)' }}>
      <div className="flex items-start gap-3">
        <Target size={18} className="mt-0.5" style={{ color: 'var(--accent)' }} />
        <div>
          <h1 className="text-[17px] font-semibold leading-6" style={{ color: 'var(--text-primary)' }}>Action queue</h1>
          <p className="mt-1 text-[13px] leading-5" style={{ color: 'var(--text-secondary)' }}>Exact targets, ranked for today</p>
        </div>
      </div>

      <div className="mt-5">
        <div className="space-y-1.5">
          {visibleItems.map((item, index) => (
            <TodayActionRow
              key={item.id}
              item={item}
              featured={index === 0 && item.type !== 'calm'}
              isPending={pendingTargetKey === targetKey(item)}
              onRunCommand={onRunCommand}
            />
          ))}
          {hiddenCount > 0 ? (
            <div className="px-3.5 py-3 text-[12px]" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--today-line)' }}>
              +{hiddenCount} more in the source workflows
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function targetKey(item: TodayActionItem): string {
  return [
    item.target.type,
    item.target.issueKey,
    item.target.developerAccountId,
    item.target.managerDeskItemId,
    item.target.trackerItemId,
  ].filter(Boolean).join(':');
}
