import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { addDays, format, parseISO } from 'date-fns';
import { ArrowRightFromLine, CalendarDays, Clock, User, X } from 'lucide-react';
import type { ManagerDeskItem } from '@/types/manager-desk';
import { KIND_LABELS, STATUS_LABELS } from '@/types/manager-desk';

interface Props {
  item: ManagerDeskItem;
  isPending: boolean;
  onConfirm: (toDate: string) => void;
  onClose: () => void;
}

function formatShortDate(iso: string): string {
  try {
    return format(parseISO(iso), 'EEE, MMM d');
  } catch {
    return iso;
  }
}

export function RescheduleItemDialog({ item, isPending, onConfirm, onClose }: Props) {
  const minDate = useMemo(
    () => format(addDays(parseISO(item.originDate), 1), 'yyyy-MM-dd'),
    [item.originDate],
  );
  const defaultDate = useMemo(() => {
    const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
    return tomorrow > minDate ? tomorrow : minDate;
  }, [minDate]);
  const [toDate, setToDate] = useState(defaultDate);

  const isValid = toDate > item.originDate;
  const formattedFromDate = formatShortDate(item.originDate);
  const formattedToDate = isValid ? formatShortDate(toDate) : null;
  const assigneeName = item.assignee?.displayName;
  const isDelegated = Boolean(item.delegatedExecution);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0"
        style={{ background: 'rgba(6, 10, 15, 0.62)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
      />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 flex w-full max-w-[440px] flex-col overflow-hidden rounded-[24px]"
        style={{
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 95%, rgba(217,169,78,0.04)) 0%, var(--bg-secondary) 100%)',
          border: '1px solid color-mix(in srgb, var(--md-accent) 18%, var(--border-strong) 82%)',
          boxShadow: '0 32px 88px rgba(0,0,0,0.42)',
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manager-desk-reschedule-title"
        onClick={(event) => event.stopPropagation()}
      >
        {/* ── Header ────────────────────────────────────── */}
        <div
          className="shrink-0 border-b px-4 py-4"
          style={{
            borderColor: 'color-mix(in srgb, var(--md-accent) 14%, var(--border) 86%)',
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--md-accent-glow) 78%, transparent) 0%, transparent 70%)',
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-2xl shrink-0"
                style={{
                  background: 'var(--md-accent-glow)',
                  color: 'var(--md-accent)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)',
                }}
              >
                <ArrowRightFromLine size={18} />
              </div>
              <div className="min-w-0">
                <div
                  id="manager-desk-reschedule-title"
                  className="text-[16px] font-semibold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Carry Forward
                </div>
                <div className="text-[13px] truncate" style={{ color: 'var(--text-secondary)' }}>
                  Move this item to a later day.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors shrink-0"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
              aria-label="Close reschedule dialog"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Body ──────────────────────────────────────── */}
        <div className="px-4 py-4 space-y-4">
          <div
            className="rounded-2xl px-3.5 py-3"
            style={{ background: 'color-mix(in srgb, var(--bg-secondary) 88%, transparent)' }}
          >
            <div className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
              {item.title}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase"
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border)',
                }}
              >
                {KIND_LABELS[item.kind]}
              </span>
              <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                {STATUS_LABELS[item.status] ?? item.status.replace(/_/g, ' ')}
              </span>
              <span
                className="inline-flex items-center gap-1 text-[12px]"
                style={{ color: 'var(--text-muted)' }}
              >
                <CalendarDays size={11} />
                {formattedFromDate}
              </span>
            </div>
          </div>

          <div>
            <label
              className="mb-1.5 block text-[12px] font-semibold uppercase"
              style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}
            >
              Carry to date
            </label>
            <input
              type="date"
              value={toDate}
              min={minDate}
              onChange={(event) => setToDate(event.target.value)}
              className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
              }}
            />
            {!isValid && (
              <p className="mt-1.5 text-[12px]" style={{ color: 'var(--danger)' }}>
                Pick a date after {formattedFromDate}.
              </p>
            )}
          </div>

          <div
            className="flex items-start gap-2.5 rounded-xl px-3 py-2.5"
            style={{
              background: 'color-mix(in srgb, var(--md-accent) 5%, var(--bg-tertiary))',
              border: '1px solid color-mix(in srgb, var(--md-accent) 12%, var(--border))',
            }}
          >
            <Clock size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--md-accent)' }} />
            <div className="text-[12px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
              Scheduled times are rebased to the new day — the original time-of-day is preserved.
            </div>
          </div>

          {isDelegated && assigneeName && (
            <div
              className="flex items-start gap-2.5 rounded-xl px-3 py-2.5"
              style={{
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.18)',
              }}
            >
              <User size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
              <div className="text-[12px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
                Delegated to {assigneeName}. The linked team task moves to {formattedToDate ?? 'the new day'} and
                restarts as planned.
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────── */}
        <div
          className="shrink-0 border-t px-4 py-4"
          style={{
            borderColor: 'color-mix(in srgb, var(--md-accent) 14%, var(--border) 86%)',
            background: 'color-mix(in srgb, var(--bg-primary) 90%, transparent)',
          }}
        >
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-3 py-2 text-[13px] font-medium transition-colors"
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onConfirm(toDate)}
              disabled={!isValid || isPending}
              className="rounded-xl px-4 py-2 text-[13px] font-bold uppercase tracking-wide transition-all disabled:opacity-40"
              style={{ background: 'var(--md-accent)', color: '#000' }}
            >
              {isPending ? 'Moving…' : 'Carry forward'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
