import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Briefcase,
  Bug,
  CalendarDays,
  FileText,
  UserRound,
  X,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useToast } from '@/context/ToastContext';
import { useCreateManagerDeskItem } from '@/hooks/useManagerDesk';
import { JiraIssueLink } from '@/components/JiraIssueLink';
import { getLocalIsoDate } from '@/lib/utils';
import type {
  ManagerDeskCategory,
  ManagerDeskCreateItemPayload,
  ManagerDeskItemKind,
} from '@/types/manager-desk';
import { CATEGORY_LABELS, KIND_LABELS } from '@/types/manager-desk';
import { useTasksPhase3 } from '@/hooks/useTasksPhase3';

type CaptureLink = NonNullable<ManagerDeskCreateItemPayload['links']>[number];

interface ContextChip {
  label: string;
  value: string;
  tone?: 'issue' | 'developer' | 'generic';
}

interface ManagerDeskCaptureDialogProps {
  onClose: () => void;
  onOpenManagerDesk?: () => void;
  heading?: string;
  description?: string;
  initialTitle?: string;
  initialKind?: ManagerDeskItemKind;
  initialCategory?: ManagerDeskCategory;
  initialContextNote?: string;
  initialLinks?: CaptureLink[];
  contextChips?: ContextChip[];
  date?: string;
}

const kindOptions: ManagerDeskItemKind[] = ['action', 'meeting', 'decision'];
const categoryOptions: ManagerDeskCategory[] = [
  'analysis',
  'design',
  'team_management',
  'cross_team',
  'follow_up',
  'escalation',
  'admin',
  'planning',
  'other',
];

function chipAccent(tone: ContextChip['tone']) {
  if (tone === 'issue') {
    return {
      background: 'color-mix(in srgb, var(--accent-glow) 72%, var(--bg-secondary) 28%)',
      border: 'color-mix(in srgb, var(--accent) 24%, transparent)',
      color: 'var(--accent)',
      Icon: Bug,
    };
  }

  if (tone === 'developer') {
    return {
      background: 'rgba(16,185,129,0.12)',
      border: 'rgba(16,185,129,0.24)',
      color: 'var(--success)',
      Icon: UserRound,
    };
  }

  return {
    background: 'var(--bg-tertiary)',
    border: 'var(--border)',
    color: 'var(--text-secondary)',
    Icon: Briefcase,
  };
}

export function ManagerDeskCaptureDialog({
  onClose,
  onOpenManagerDesk,
  heading = 'Capture For Desk',
  description = 'Save a follow-up for today without losing the screen context you are already in.',
  initialTitle = '',
  initialKind = 'action',
  initialCategory = 'other',
  initialContextNote = '',
  initialLinks = [],
  contextChips = [],
  date,
}: ManagerDeskCaptureDialogProps) {
  const captureDate = date ?? getLocalIsoDate();
  const createItem = useCreateManagerDeskItem(captureDate);
  const { addToast } = useToast();
  const titleRef = useRef<HTMLInputElement>(null);
  // Phase 3 (P3-D13): kind/category pickers retire; initial values still apply
  // semantically (e.g. follow_up → category:follow_up label).
  const phase3 = useTasksPhase3();
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const [title, setTitle] = useState(initialTitle);
  const [kind, setKind] = useState<ManagerDeskItemKind>(initialKind);
  const [category, setCategory] = useState<ManagerDeskCategory>(initialCategory);
  const [contextNote, setContextNote] = useState(initialContextNote);
  const [detailsOpen, setDetailsOpen] = useState(Boolean(initialContextNote));

  const formattedDate = useMemo(() => format(parseISO(captureDate), 'EEEE, MMM d'), [captureDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => titleRef.current?.focus(), 140);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || createItem.isPending) {
      return;
    }

    createItem.mutate(
      {
        date: captureDate,
        title: trimmedTitle,
        kind,
        category,
        contextNote: contextNote.trim() || undefined,
        links: initialLinks.length > 0 ? initialLinks : undefined,
      },
      {
        onSuccess: () => {
          addToast({
            type: 'success',
            title: 'Saved to Desk',
            message: `Scheduled for ${formattedDate}.`,
            action: onOpenManagerDesk
              ? {
                  label: 'Open Desk',
                  onClick: onOpenManagerDesk,
                }
              : undefined,
          });
          onClose();
        },
        onError: (error) => {
          addToast({
            type: 'error',
            title: 'Could not save to Desk',
            message: error.message,
          });
        },
      },
    );
  };

  return (
    <>
      {/* Scrim */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[80]"
        style={{ background: 'rgba(6, 10, 15, 0.45)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />

      {/* Centering wrapper */}
      <div
        className="fixed inset-0 z-[81] flex items-start justify-center pt-[12vh] overflow-hidden"
        style={{ pointerEvents: 'none' }}
      >
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="w-[calc(100%-2rem)] max-w-[440px] overflow-hidden rounded-2xl"
          style={{
            pointerEvents: 'auto',
            background: 'var(--bg-secondary)',
            border: '1px solid color-mix(in srgb, var(--md-accent) 16%, var(--border-strong) 84%)',
            boxShadow: '0 24px 64px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.03) inset',
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={dialogTitleId}
          aria-describedby={dialogDescriptionId}
          onClick={(event) => event.stopPropagation()}
        >
        {/* Header — compact row with title, chips, and close */}
        <div
          className="flex items-center gap-2.5 px-4 py-3"
          style={{
            borderBottom: '1px solid color-mix(in srgb, var(--md-accent) 10%, var(--border) 90%)',
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--md-accent-glow) 60%, transparent) 0%, transparent 50%)',
          }}
        >
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'var(--md-accent-glow)', color: 'var(--md-accent)' }}
          >
            <Briefcase size={13} />
          </div>
          <div className="min-w-0 flex-1">
            <div id={dialogTitleId} className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {heading}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ background: 'rgba(217,169,78,0.1)', color: 'var(--md-accent)', border: '1px solid rgba(217,169,78,0.18)' }}
              >
                <CalendarDays size={10} />
                {formattedDate}
              </span>
              {contextChips.map((chip) => {
                const accent = chipAccent(chip.tone);
                const Icon = accent.Icon;
                const chipEl = (
                  <>
                    <Icon size={10} />
                    <span>{chip.value}</span>
                  </>
                );
                if (chip.tone === 'issue') {
                  return (
                    <JiraIssueLink
                      key={`${chip.label}-${chip.value}`}
                      issueKey={chip.value}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{ background: accent.background, color: accent.color, border: `1px solid ${accent.border}` }}
                    >
                      {chipEl}
                    </JiraIssueLink>
                  );
                }
                return (
                  <span
                    key={`${chip.label}-${chip.value}`}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{ background: accent.background, color: accent.color, border: `1px solid ${accent.border}` }}
                  >
                    {chipEl}
                  </span>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
            aria-label="Close manager desk capture"
          >
            <X size={14} />
          </button>
        </div>

        {/* Form body */}
        <div className="px-4 py-3 space-y-3">
          {/* Task title */}
          <input
            id="manager-desk-capture-title"
            ref={titleRef}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="What needs to land on your desk?"
            className="w-full rounded-xl px-3 py-2 text-[13px] outline-none"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            }}
            maxLength={200}
          />

          {/* Kind + Category — single compact row (hidden under Phase 3) */}
          {!phase3 && (
          <div className="flex items-center gap-2 flex-wrap">
            {kindOptions.map((option) => {
              const isActive = kind === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setKind(option)}
                  className="rounded-lg px-2.5 py-1 text-[12px] font-medium transition-all"
                  style={{
                    background: isActive ? 'var(--md-accent-glow)' : 'var(--bg-tertiary)',
                    color: isActive ? 'var(--md-accent)' : 'var(--text-muted)',
                    border: `1px solid ${isActive ? 'rgba(217,169,78,0.28)' : 'var(--border)'}`,
                  }}
                >
                  {KIND_LABELS[option]}
                </button>
              );
            })}
            <div className="ml-auto">
              <select
                id="manager-desk-capture-category"
                value={category}
                onChange={(event) => setCategory(event.target.value as ManagerDeskCategory)}
                className="rounded-lg px-2 py-1 text-[12px] outline-none"
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                }}
              >
                {categoryOptions.map((option) => (
                  <option key={option} value={option}>
                    {CATEGORY_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          )}

          {/* Context note — collapsible */}
          <div
            className="overflow-hidden rounded-xl border"
            style={{ borderColor: 'var(--border)' }}
          >
            <button
              type="button"
              onClick={() => setDetailsOpen((current) => !current)}
              className="flex w-full items-center justify-between px-3 py-2 text-left"
              style={{
                background: detailsOpen ? 'color-mix(in srgb, var(--bg-tertiary) 80%, transparent)' : 'transparent',
              }}
            >
              <span className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                <FileText size={11} style={{ color: 'var(--text-muted)' }} />
                Context note
              </span>
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {detailsOpen ? 'Hide' : 'Optional'}
              </span>
            </button>
            {detailsOpen && (
              <div className="border-t px-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
                <textarea
                  value={contextNote}
                  onChange={(event) => setContextNote(event.target.value)}
                  rows={2}
                  placeholder="Quick context so future-you remembers why..."
                  className="w-full rounded-lg px-2.5 py-2 text-[13px] outline-none resize-y"
                  style={{
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border)',
                    minHeight: '52px',
                  }}
                  maxLength={1500}
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer — tight inline */}
        <div
          className="flex items-center justify-between gap-2 px-4 py-2.5"
          style={{ borderTop: '1px solid var(--border)', background: 'color-mix(in srgb, var(--bg-tertiary) 40%, transparent)' }}
        >
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }} id={dialogDescriptionId}>
            Lands on desk for <span style={{ color: 'var(--text-secondary)' }}>{formattedDate}</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors"
              style={{ color: 'var(--text-muted)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!title.trim() || createItem.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all disabled:opacity-40"
              style={{
                background: 'var(--md-accent)',
                color: '#111',
                boxShadow: '0 4px 12px rgba(217,169,78,0.2)',
              }}
            >
              <Briefcase size={11} />
              {createItem.isPending ? 'Saving...' : 'Add to Desk'}
            </button>
          </div>
        </div>
        </motion.div>
      </div>
    </>
  );
}
