import { motion } from 'framer-motion';
import type { TrackerDeveloperStatus } from '@/types';
import { FOCUS_RING } from '@/components/ui/focus';
import { STATUS_ORDER, getStatusInfo } from './status-config';

export { getStatusInfo } from './status-config';

interface StatusSelectorProps {
  current: TrackerDeveloperStatus;
  onUpdate: (status: TrackerDeveloperStatus) => void;
  isPending?: boolean;
  disabled?: boolean;
}

/**
 * Five-way segmented control, icon over label so it fits the side rail. The
 * active pill slides between segments and takes the status tone; everything
 * else stays neutral.
 */
export function StatusSelector({ current, onUpdate, isPending, disabled }: StatusSelectorProps) {
  return (
    <div
      role="group"
      aria-label="Your status"
      aria-busy={isPending || undefined}
      className="grid grid-cols-5 gap-0.5 rounded-xl p-1"
      style={{ background: 'color-mix(in srgb, var(--bg-tertiary) 55%, transparent)' }}
    >
      {STATUS_ORDER.map((key) => {
        const cfg = getStatusInfo(key);
        const isActive = current === key;
        const Icon = cfg.icon;
        return (
          <button
            key={key}
            type="button"
            onClick={() => {
              if (!isActive && !disabled) onUpdate(key);
            }}
            disabled={disabled}
            aria-pressed={isActive}
            aria-label={cfg.label}
            title={cfg.description}
            className={`relative flex h-[50px] min-w-0 flex-col items-center justify-center gap-1 rounded-[9px] px-1 text-[12px] font-medium transition-colors disabled:cursor-not-allowed ${
              isActive ? '' : 'hover:text-[var(--text-primary)]'
            } ${FOCUS_RING}`}
            style={{ color: isActive ? cfg.color : 'var(--text-muted)' }}
          >
            {isActive && (
              <motion.span
                layoutId="my-day-status-pill"
                aria-hidden="true"
                className="absolute inset-0 rounded-[9px]"
                style={{
                  background: `color-mix(in srgb, ${cfg.color} 13%, var(--bg-elevated))`,
                  border: `1px solid color-mix(in srgb, ${cfg.color} 34%, transparent)`,
                  boxShadow: 'var(--soft-shadow)',
                }}
                transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.8 }}
              />
            )}
            <Icon size={15} className="relative shrink-0" aria-hidden="true" />
            <span className="relative max-w-full truncate leading-none">{cfg.shortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
