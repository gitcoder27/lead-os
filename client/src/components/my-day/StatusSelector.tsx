import { motion } from 'framer-motion';
import type { TrackerDeveloperStatus } from '@/types';
import { FOCUS_RING } from '@/components/tasks/TaskDetailPrimitives';
import { STATUS_ORDER, getStatusInfo } from './status-config';

export { getStatusInfo } from './status-config';

interface StatusSelectorProps {
  current: TrackerDeveloperStatus;
  onUpdate: (status: TrackerDeveloperStatus) => void;
  isPending?: boolean;
  disabled?: boolean;
}

/**
 * Five-way segmented control. The active pill slides between segments and
 * takes the status tone; everything else stays neutral so the one colour on
 * the control is the answer to "how's it going?".
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
            title={cfg.label}
            className={`relative flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-[9px] px-1.5 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed ${
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
                  boxShadow: `0 1px 2px rgba(0,0,0,0.12), 0 0 18px color-mix(in srgb, ${cfg.color} 14%, transparent)`,
                }}
                transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.8 }}
              />
            )}
            <Icon size={14} className="relative hidden shrink-0 sm:block" aria-hidden="true" />
            <span className="relative truncate">
              <span className="hidden md:inline">{cfg.label}</span>
              <span className="md:hidden">{cfg.shortLabel}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
