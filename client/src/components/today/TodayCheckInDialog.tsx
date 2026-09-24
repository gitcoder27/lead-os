import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { TaskPicker, taskKeysForSubmit, type TaskPickerTask } from '@/components/tasks/TaskPicker';

interface TodayCheckInDialogProps {
  developerName: string;
  defaultSummary?: string;
  /** Tasks that can be tagged on this check-in (developer's current + planned work). */
  tasks?: TaskPickerTask[];
  isSaving: boolean;
  onClose: () => void;
  onSave: (summary: string, taskKeys: string[]) => void;
}

export function TodayCheckInDialog({
  developerName,
  defaultSummary = '',
  tasks = [],
  isSaving,
  onClose,
  onSave,
}: TodayCheckInDialogProps) {
  const [summary, setSummary] = useState(defaultSummary);
  const [taskKeys, setTaskKeys] = useState<string[]>([]);
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const canSave = summary.trim().length > 0 && !isSaving;

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    textAreaRef.current?.focus();

    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== 'Tab' || !dialogRef.current) {
      return;
    }

    const focusable = getFocusableElements(dialogRef.current);
    if (focusable.length === 0) {
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-[700] flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Close check-in dialog"
        className="absolute inset-0 cursor-default"
        style={{ background: 'rgba(0, 0, 0, 0.48)', backdropFilter: 'blur(2px)' }}
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative w-full max-w-[440px] overflow-hidden rounded-xl border"
        style={{
          background: 'linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)',
          borderColor: 'var(--border-strong)',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.36)',
        }}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                color: 'var(--accent)',
                border: '1px solid color-mix(in srgb, var(--accent) 24%, var(--border))',
              }}
            >
              <MessageSquare size={16} />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                Add check-in
              </h2>
              <p id={descriptionId} className="mt-1 text-[12px] leading-5" style={{ color: 'var(--text-muted)' }}>
                Saves to Team / {developerName} / Check-ins for today.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-tertiary)]"
            aria-label="Close"
          >
            <X size={15} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>

        <div className="px-4 py-4">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              Check-in note
            </span>
            <textarea
              ref={textAreaRef}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={4}
              className="w-full resize-none rounded-lg px-3 py-2.5 text-[13px] leading-5 outline-none transition-colors focus:ring-2 focus:ring-[var(--border-active)]"
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
              }}
              placeholder="Asked for today update, blocker detail, or current status..."
            />
          </label>
          {tasks.length > 0 && (
            <div className="mt-3">
              <TaskPicker tasks={tasks} text={summary} selected={taskKeys} onChange={setTaskKeys} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(summary, taskKeysForSubmit(taskKeys, summary, tasks))}
            disabled={!canSave}
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-opacity disabled:opacity-45"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {isSaving ? 'Saving' : 'Save check-in'}
          </button>
        </div>
      </section>
    </div>
  );
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  );
}
