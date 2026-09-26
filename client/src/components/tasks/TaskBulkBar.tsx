import type { MouseEvent, ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Ban, CalendarClock, Check, Tag, UserRound, X } from 'lucide-react';

/** docs/49 §6/§12: floating bulk toolbar for the multi-selection. */
export function TaskBulkBar({ count, onDone, onMenu, onDrop, onClear }: {
  count: number;
  onDone: () => void;
  onMenu: (kind: 'schedule' | 'assign' | 'label', anchor: HTMLElement) => void;
  onDrop: () => void;
  onClear: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      role="toolbar"
      aria-label="Bulk actions"
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
      transition={{ duration: 0.15 }}
      className="pointer-events-auto flex items-center gap-1 rounded-xl px-2 py-1.5"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--panel-shadow)' }}
    >
      <span className="px-2 text-[12.5px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }} aria-live="polite">
        {count} selected
      </span>
      <span className="h-4 w-px" style={{ background: 'var(--border)' }} />
      <BulkButton label="Done" hint="space" onClick={onDone}><Check size={13} /></BulkButton>
      <BulkButton label="Schedule" hint="s" onClick={(event) => onMenu('schedule', event.currentTarget)}><CalendarClock size={13} /></BulkButton>
      <BulkButton label="Assign" hint="a" onClick={(event) => onMenu('assign', event.currentTarget)}><UserRound size={13} /></BulkButton>
      <BulkButton label="Label" hint="l" onClick={(event) => onMenu('label', event.currentTarget)}><Tag size={13} /></BulkButton>
      <BulkButton label="Drop" hint="#" onClick={onDrop} danger><Ban size={13} /></BulkButton>
      <span className="h-4 w-px" style={{ background: 'var(--border)' }} />
      <button type="button" onClick={onClear} className="flex h-7 items-center gap-1 rounded-lg px-2 text-[12px]" style={{ color: 'var(--text-muted)' }} aria-label="Clear selection (Esc)" title="Clear selection (Esc)">
        <X size={13} />
      </button>
    </motion.div>
  );
}

function BulkButton({ label, hint, onClick, danger, children }: {
  label: string;
  hint: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} (${hint})`}
      className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)]"
      style={{ color: danger ? 'var(--danger)' : 'var(--text-secondary)' }}
    >
      {children}
      {label}
    </button>
  );
}
