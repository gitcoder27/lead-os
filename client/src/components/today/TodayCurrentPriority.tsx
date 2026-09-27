import { ArrowRight, CheckCircle2, Target } from 'lucide-react';
import { todayToneStyles } from './today-design';
import type { TodayActionItem, TodayActionTarget } from '@/types';

interface TodayCurrentPriorityProps {
  item?: TodayActionItem;
  onRunAction: (item: TodayActionItem) => void;
  onOpenTarget: (target: TodayActionTarget) => void;
}

export function TodayCurrentPriority({ item, onRunAction, onOpenTarget }: TodayCurrentPriorityProps) {
  if (!item) {
    return null;
  }

  const style = todayToneStyles[item.severity];
  const Icon = item.type === 'calm' ? CheckCircle2 : Target;

  return (
    <section className="border-b px-5 py-3 xl:px-8" style={{ borderColor: 'var(--today-line)' }}>
      <div
        className="grid w-full grid-cols-[92px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3.5 py-3"
        style={{
          background: `linear-gradient(90deg, color-mix(in srgb, ${style.color} 5%, transparent), color-mix(in srgb, var(--bg-secondary) 8%, transparent))`,
          boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${style.color} 13%, var(--today-line))`,
        }}
      >
        {/* docs/53 F10: the band body only navigates to the target; the
            right-side button is the sole write trigger. */}
        <button
          type="button"
          onClick={() => onOpenTarget(item.target)}
          className="flex items-center gap-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] transition-opacity hover:opacity-80"
          style={{ color: style.color }}
          aria-label={`Open ${item.title}`}
        >
          <Icon size={13} />
          Start
        </button>
        <button
          type="button"
          onClick={() => onOpenTarget(item.target)}
          className="min-w-0 text-left transition-colors"
        >
          <span className="block truncate text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>{item.title}</span>
          <span className="mt-0.5 block truncate text-[12px]" style={{ color: 'var(--text-secondary)' }}>{item.context}</span>
        </button>
        <button
          type="button"
          onClick={() => onRunAction(item)}
          className="hidden items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--today-hover)] active:scale-[0.98] md:flex"
          style={{ borderColor: style.border, background: style.bg, color: style.color }}
        >
          {item.primaryAction.label}
          <ArrowRight size={12} />
        </button>
      </div>
    </section>
  );
}
