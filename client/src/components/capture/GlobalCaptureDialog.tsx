import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Briefcase, CalendarDays, NotebookPen, Users, X, Zap } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { getLocalIsoDate } from '@/lib/utils';
import { useScopedStorageKey } from '@/lib/scoped-storage';
import { DeskCaptureForm } from './DeskCaptureForm';
import { NoteCaptureForm } from './NoteCaptureForm';
import { TrackerCaptureForm } from './TrackerCaptureForm';

export type CaptureTarget = 'manager-desk' | 'team-tracker' | 'notes';

const STORAGE_KEY = 'dcc-capture-target';

export interface GlobalCaptureContext {
  defaultTarget?: CaptureTarget;
  issue?: {
    jiraKey: string;
    summary?: string;
  };
  developer?: {
    accountId: string;
    displayName?: string;
  };
}

const TARGETS: { id: CaptureTarget; label: string; Icon: typeof Briefcase }[] = [
  { id: 'manager-desk', label: 'Desk', Icon: Briefcase },
  { id: 'team-tracker', label: 'Team', Icon: Users },
  { id: 'notes', label: 'Notes', Icon: NotebookPen },
];

function loadTarget(storageKey: string): CaptureTarget {
  try {
    const v = localStorage.getItem(storageKey);
    if (v === 'team-tracker' || v === 'notes') return v;
  } catch {
    /* ignore */
  }
  return 'manager-desk';
}

interface GlobalCaptureDialogProps {
  onClose: () => void;
  onOpenManagerDesk?: () => void;
  onOpenTeamTracker?: () => void;
  onOpenNotes?: (date?: string) => void;
  context?: GlobalCaptureContext;
}

export function GlobalCaptureDialog({
  onClose,
  onOpenManagerDesk,
  onOpenTeamTracker,
  onOpenNotes,
  context,
}: GlobalCaptureDialogProps) {
  const storageKey = useScopedStorageKey(STORAGE_KEY);
  const [target, setTarget] = useState<CaptureTarget>(() => context?.defaultTarget ?? loadTarget(storageKey));
  const storageKeyRef = useRef(storageKey);
  const date = useMemo(() => getLocalIsoDate(), []);
  const formattedDate = useMemo(() => format(parseISO(date), 'EEEE, MMM d'), [date]);

  const isDesk = target === 'manager-desk';
  const isTracker = target === 'team-tracker';

  useEffect(() => {
    if (storageKeyRef.current !== storageKey) {
      storageKeyRef.current = storageKey;
      setTarget(context?.defaultTarget ?? loadTarget(storageKey));
      return;
    }

    try {
      localStorage.setItem(storageKey, target);
    } catch {
      /* ignore */
    }
  }, [context?.defaultTarget, storageKey, target]);

  useEffect(() => {
    if (context?.defaultTarget) {
      setTarget(context.defaultTarget);
    }
  }, [context?.defaultTarget]);

  // Escape to close + lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handle);

    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', handle);
    };
  }, [onClose]);

  const accentBorder = isDesk
    ? 'color-mix(in srgb, var(--md-accent) 16%, var(--border-strong) 84%)'
    : isTracker
      ? 'color-mix(in srgb, var(--accent) 22%, var(--border-strong) 78%)'
      : 'var(--border-strong)';

  const headerGradient = isDesk
    ? 'linear-gradient(135deg, color-mix(in srgb, var(--md-accent-glow) 60%, transparent) 0%, transparent 50%)'
    : isTracker
      ? 'linear-gradient(135deg, color-mix(in srgb, var(--accent-glow) 60%, transparent) 0%, transparent 64%)'
      : 'none';

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {/* Scrim */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[80]"
        style={{ background: 'rgba(4, 8, 14, 0.55)', backdropFilter: 'blur(6px)' }}
        onClick={onClose}
      />

      {/* Dialog */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="fixed z-[81] inset-x-4 mx-auto w-full max-w-[480px] overflow-hidden rounded-2xl"
        style={{
          top: '12vh',
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 94%, transparent) 0%, var(--bg-secondary) 100%)',
          border: `1px solid ${accentBorder}`,
          boxShadow:
            '0 0 0 1px rgba(255,255,255,0.03) inset, 0 32px 80px rgba(0,0,0,0.48)',
          transition: 'border-color 0.3s ease',
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Quick capture"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-5 py-4"
          style={{
            borderBottom: `1px solid ${
              isDesk
                ? 'color-mix(in srgb, var(--md-accent) 10%, var(--border) 90%)'
                : 'color-mix(in srgb, var(--accent) 14%, var(--border) 86%)'
            }`,
            background: headerGradient,
            transition: 'background 0.3s ease',
          }}
        >
          <div className="flex items-center justify-between gap-3 mb-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl transition-colors duration-300"
                style={{
                  background: isDesk ? 'var(--md-accent-glow)' : isTracker ? 'var(--accent-glow)' : 'var(--bg-tertiary)',
                  color: isDesk ? 'var(--md-accent)' : isTracker ? 'var(--accent)' : 'var(--text-secondary)',
                  border: `1px solid ${
                    isDesk
                      ? 'rgba(217,169,78,0.28)'
                      : isTracker
                        ? 'color-mix(in srgb, var(--accent) 28%, transparent)'
                        : 'var(--border)'
                  }`,
                }}
              >
                <Zap size={15} strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <div
                  className="text-[15px] font-semibold leading-tight"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Capture
                </div>
                <span
                  className="inline-flex items-center gap-1 mt-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors duration-300"
                  style={{
                    background: isDesk
                      ? 'rgba(217,169,78,0.1)'
                      : isTracker
                        ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
                        : 'var(--bg-tertiary)',
                    color: isDesk ? 'var(--md-accent)' : isTracker ? 'var(--accent)' : 'var(--text-secondary)',
                    border: `1px solid ${
                      isDesk
                        ? 'rgba(217,169,78,0.18)'
                        : isTracker
                          ? 'color-mix(in srgb, var(--accent) 18%, transparent)'
                          : 'var(--border)'
                    }`,
                  }}
                >
                  <CalendarDays size={10} />
                  {formattedDate}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors hover:brightness-125"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
              aria-label="Close capture"
            >
              <X size={14} />
            </button>
          </div>

          {/* Segmented control */}
          <div
            className="relative flex rounded-xl p-1 gap-0.5"
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
            }}
          >
            {TARGETS.map((t) => {
              const active = target === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTarget(t.id)}
                  className="relative z-10 flex-1 flex items-center justify-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] font-semibold transition-colors duration-200"
                  style={{
                    color: active
                      ? t.id === 'manager-desk'
                        ? 'var(--md-accent)'
                        : t.id === 'notes'
                          ? 'var(--text-primary)'
                          : 'var(--accent)'
                      : 'var(--text-muted)',
                  }}
                >
                  {active && (
                    <motion.div
                      layoutId="capture-target-bg"
                      className="absolute inset-0 rounded-[10px]"
                      style={{
                        background:
                          t.id === 'manager-desk'
                            ? 'var(--md-accent-glow)'
                            : t.id === 'notes'
                              ? 'var(--bg-elevated)'
                              : 'var(--accent-glow)',
                        border: `1px solid ${
                          t.id === 'manager-desk'
                            ? 'rgba(217,169,78,0.22)'
                            : t.id === 'notes'
                              ? 'var(--border)'
                              : 'color-mix(in srgb, var(--accent) 22%, transparent)'
                        }`,
                      }}
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                  <t.Icon size={13} className="relative z-10" />
                  <span className="relative z-10">{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Body — switches per target */}
        <AnimatePresence mode="wait">
          {isDesk ? (
            <DeskCaptureForm
              key="desk"
              date={date}
              formattedDate={formattedDate}
              onClose={onClose}
              onOpenManagerDesk={onOpenManagerDesk}
              context={context}
            />
          ) : isTracker ? (
            <TrackerCaptureForm
              key="tracker"
              date={date}
              formattedDate={formattedDate}
              onClose={onClose}
              onOpenTeamTracker={onOpenTeamTracker}
              context={context}
            />
          ) : (
            <NoteCaptureForm
              key={`${storageKey}:notes`}
              date={date}
              formattedDate={formattedDate}
              onClose={onClose}
              onOpenNotes={onOpenNotes}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </>,
    document.body,
  );
}
