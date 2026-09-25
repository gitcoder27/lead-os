import { useEffect, useId, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import type { TrackerDeveloperStatus } from '@/types';
import { TaskPicker, taskKeysForSubmit, type TaskPickerTask } from '@/components/tasks/TaskPicker';
import { TrackerStatusPill } from './TrackerStatusPill';

interface StatusRationaleDialogProps {
  status: TrackerDeveloperStatus;
  developerName: string;
  tasks: TaskPickerTask[];
  isPending: boolean;
  error?: string | null;
  /** Pre-picked task keys (e.g. the task that triggered a status suggestion). */
  initialSelectedKeys?: string[];
  onClose: () => void;
  onSubmit: (params: { rationale: string; taskKey?: string; nextFollowUpAt?: string | null }) => void;
}

const RATIONALE_REQUIRED_STATUSES: TrackerDeveloperStatus[] = ['blocked', 'at_risk'];

export function StatusRationaleDialog({
  status,
  developerName,
  tasks,
  isPending,
  error,
  initialSelectedKeys,
  onClose,
  onSubmit,
}: StatusRationaleDialogProps) {
  const rationaleRef = useRef<HTMLTextAreaElement>(null);
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const [rationale, setRationale] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>(initialSelectedKeys ?? []);
  const [followUpAt, setFollowUpAt] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const rationaleRequired = RATIONALE_REQUIRED_STATUSES.includes(status) || (status === 'waiting' && selectedKeys.length > 0);
  const displayError = formError ?? error ?? null;

  useEffect(() => {
    const timer = window.setTimeout(() => rationaleRef.current?.focus(), 140);
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
    const trimmed = rationale.trim();
    if (rationaleRequired && !trimmed) {
      setFormError(
        status === 'waiting'
          ? 'Add a rationale — it becomes the blocker note on the picked task.'
          : 'Add a rationale for this status.',
      );
      return;
    }
    const taskKeys = taskKeysForSubmit(selectedKeys, rationale, tasks);
    if (taskKeys.length > 1) {
      setFormError('Pick a single task for this update.');
      return;
    }
    if (isPending) {
      return;
    }

    let nextFollowUpAt: string | null | undefined;
    if (followUpAt) {
      const parsed = new Date(followUpAt);
      if (Number.isNaN(parsed.getTime())) {
        setFormError('That follow-up time is not valid.');
        return;
      }
      nextFollowUpAt = parsed.toISOString();
    }

    setFormError(null);
    onSubmit({
      rationale: trimmed || `Status updated.`,
      taskKey: taskKeys[0],
      nextFollowUpAt,
    });
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[80]"
        style={{ background: 'rgba(6, 10, 15, 0.45)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />
      <div
        className="fixed inset-0 z-[81] flex items-start justify-center pt-[14vh] overflow-hidden"
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
            border: '1px solid color-mix(in srgb, var(--accent) 16%, var(--border-strong) 84%)',
            boxShadow: '0 24px 64px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.03) inset',
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={dialogTitleId}
          aria-describedby={dialogDescriptionId}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className="flex items-center gap-2.5 px-4 py-3"
            style={{
              borderBottom: '1px solid color-mix(in srgb, var(--accent) 10%, var(--border) 90%)',
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-glow) 60%, transparent) 0%, transparent 50%)',
            }}
          >
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
            >
              <AlertTriangle size={13} />
            </div>
            <div className="min-w-0 flex-1">
              <div id={dialogTitleId} className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                {developerName} → <TrackerStatusPill status={status} size="sm" />
              </div>
              <div id={dialogDescriptionId} className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {rationaleRequired
                  ? 'A rationale is required and lands on the standup record.'
                  : 'Optionally add context or link the task this status is about.'}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
              aria-label="Close status rationale dialog"
            >
              <X size={14} />
            </button>
          </div>

          <div className="space-y-3 px-4 py-3">
            <div>
              <label
                htmlFor="status-rationale"
                className="mb-1 block text-[12px] font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                Rationale {rationaleRequired ? '' : <span style={{ color: 'var(--text-muted)' }}>(optional)</span>}
              </label>
              <textarea
                id="status-rationale"
                ref={rationaleRef}
                value={rationale}
                onChange={(event) => setRationale(event.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={
                  status === 'blocked'
                    ? 'What is blocking progress?'
                    : status === 'at_risk'
                      ? 'What is at risk and why?'
                      : 'Context for this status…'
                }
                className="w-full resize-y rounded-lg px-3 py-2 text-[13px] leading-5 outline-none"
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  minHeight: '72px',
                }}
              />
            </div>
            {tasks.length > 0 && (
              <div>
                <span className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Link a task <span style={{ color: 'var(--text-muted)' }}>(optional — raises a blocker event on it)</span>
                </span>
                <TaskPicker
                  tasks={tasks}
                  text={rationale}
                  selected={selectedKeys}
                  onChange={(keys) => setSelectedKeys(keys.slice(-1))}
                />
              </div>
            )}
            <div>
              <label
                htmlFor="status-rationale-follow-up"
                className="mb-1 block text-[12px] font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                Next follow-up <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
              </label>
              <input
                id="status-rationale-follow-up"
                type="datetime-local"
                value={followUpAt}
                onChange={(event) => setFollowUpAt(event.target.value)}
                className="w-full rounded-lg px-3 py-1.5 text-[13px] outline-none"
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                }}
              />
            </div>
            {displayError ? (
              <p className="text-[12px]" style={{ color: 'var(--danger)' }} role="alert">
                {displayError}
              </p>
            ) : null}
          </div>

          <div
            className="flex items-center justify-end gap-2 px-4 py-2.5"
            style={{ borderTop: '1px solid var(--border)', background: 'color-mix(in srgb, var(--bg-tertiary) 40%, transparent)' }}
          >
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
              disabled={isPending || (rationaleRequired && !rationale.trim())}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all disabled:opacity-40"
              style={{
                background: 'var(--accent)',
                color: '#fff',
                boxShadow: '0 4px 12px color-mix(in srgb, var(--accent) 22%, transparent)',
              }}
            >
              {isPending ? 'Saving…' : 'Set status'}
            </button>
          </div>
        </motion.div>
      </div>
    </>
  );
}
