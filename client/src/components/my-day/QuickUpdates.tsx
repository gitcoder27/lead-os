import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, Check } from 'lucide-react';
import type { TrackerDeveloperStatus } from '@/types';
import { FOCUS_RING } from '@/components/tasks/TaskDetailPrimitives';
import { parseTaskKeys, taskKeysForSubmit, type TaskPickerTask } from '@/components/tasks/TaskPicker';
import { getStatusInfo } from './status-config';
import { HAIRLINE, Kbd } from './MyDayUI';

interface QuickUpdatesProps {
  onAddCheckIn: (
    summary: string,
    status?: TrackerDeveloperStatus,
    taskKeys?: string[],
    options?: { onSuccess?: () => void }
  ) => void;
  /** Tasks that can be tagged on the check-in (current + planned work). */
  tasks?: TaskPickerTask[];
  /** Current day status — the prompt asks the question that status raises. */
  status?: TrackerDeveloperStatus;
  isPending?: boolean;
  disabled?: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}

const MAX_HEIGHT = 168;

export function QuickUpdates({ onAddCheckIn, tasks = [], status = 'on_track', isPending, disabled, inputRef }: QuickUpdatesProps) {
  const [draft, setDraft] = useState('');
  const [taskKeys, setTaskKeys] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const localRef = useRef<HTMLTextAreaElement | null>(null);

  const setRefs = (el: HTMLTextAreaElement | null) => {
    localRef.current = el;
    if (inputRef) (inputRef as { current: HTMLTextAreaElement | null }).current = el;
  };

  // Grow with the text, one line at rest.
  useLayoutEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [draft]);

  useEffect(() => {
    if (!justSent) return;
    const timer = window.setTimeout(() => setJustSent(false), 2600);
    return () => window.clearTimeout(timer);
  }, [justSent]);

  const text = draft.trim();
  const canSend = Boolean(text) && !isPending && !disabled;
  const engaged = focused || Boolean(draft) || taskKeys.length > 0;

  const handleSubmit = () => {
    if (!canSend) return;
    onAddCheckIn(text, undefined, taskKeysForSubmit(taskKeys, text, tasks), {
      onSuccess: () => {
        setDraft('');
        setTaskKeys([]);
        setJustSent(true);
      },
    });
  };

  return (
    <div className="px-3.5 pb-3 pt-3">
      <textarea
        ref={setRefs}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
          if (e.key === 'Escape' && !draft) {
            e.currentTarget.blur();
          }
        }}
        placeholder={disabled ? 'Updates are closed for this day' : getStatusInfo(status).prompt}
        aria-label="Quick update"
        disabled={disabled}
        rows={1}
        className="block w-full resize-none bg-transparent text-[14.5px] leading-6 outline-none placeholder:text-[var(--text-placeholder)] disabled:cursor-not-allowed"
        style={{ color: 'var(--text-primary)', maxHeight: MAX_HEIGHT }}
      />

      <AnimatePresence initial={false}>
        {engaged && !disabled && tasks.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <MentionChips tasks={tasks} text={draft} selected={taskKeys} onChange={setTaskKeys} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-2.5 flex items-center justify-between gap-3 pt-2.5" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
        <div className="min-w-0 text-[11.5px]" style={{ color: 'var(--text-muted)' }} aria-live="polite">
          {justSent ? (
            <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: 'var(--success)' }}>
              <Check size={13} aria-hidden="true" />
              Sent — it’s on your lead’s board
            </span>
          ) : disabled ? null : (
            <span className="hidden items-center gap-1.5 sm:inline-flex">
              <Kbd>↵</Kbd> send
              <span className="opacity-50">·</span>
              <Kbd>⇧↵</Kbd> new line
              {!engaged && (
                <>
                  <span className="opacity-50">·</span>
                  <Kbd>U</Kbd> to jump here
                </>
              )}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSend}
          className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-all disabled:cursor-not-allowed ${FOCUS_RING}`}
          style={
            canSend
              ? { background: 'var(--accent)', color: 'var(--bg-primary)', boxShadow: '0 4px 14px color-mix(in srgb, var(--accent) 28%, transparent)' }
              : { background: 'color-mix(in srgb, var(--bg-tertiary) 70%, transparent)', color: 'var(--text-disabled)' }
          }
        >
          <ArrowUp size={14} aria-hidden="true" />
          {isPending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

/**
 * Tag the update to specific tasks. Typed T-n tokens light up the matching
 * chip; unknown tokens show dashed (they link only if the task exists).
 */
function MentionChips({
  tasks,
  text,
  selected,
  onChange,
}: {
  tasks: TaskPickerTask[];
  text: string;
  selected: string[];
  onChange: (keys: string[]) => void;
}) {
  const parsed = parseTaskKeys(text);
  const known = new Set(tasks.map((task) => task.taskKey));
  const unknownTokens = parsed.filter((token) => !known.has(token));
  const selectedSet = new Set(selected);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Tag tasks">
      <span className="text-[11.5px] font-medium" style={{ color: 'var(--text-muted)' }}>
        About
      </span>
      {tasks.map((task) => {
        const mentioned = parsed.includes(task.taskKey);
        const active = selectedSet.has(task.taskKey) || mentioned;
        return (
          <button
            key={task.taskKey}
            type="button"
            // Keep focus in the textarea so the chip row doesn't collapse mid-click.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              onChange(selectedSet.has(task.taskKey) ? selected.filter((key) => key !== task.taskKey) : [...selected, task.taskKey])
            }
            aria-pressed={active}
            title={`${task.taskKey} · ${task.title}${mentioned ? ' — mentioned in text' : ''}`}
            className={`inline-flex max-w-[200px] items-center gap-1.5 rounded-full py-0.5 pl-1.5 pr-2 text-[11.5px] transition-colors ${FOCUS_RING}`}
            style={{
              background: active ? 'color-mix(in srgb, var(--accent) 13%, transparent)' : 'color-mix(in srgb, var(--bg-tertiary) 60%, transparent)',
              color: active ? 'var(--accent)' : 'var(--text-secondary)',
              border: `1px solid ${active ? 'color-mix(in srgb, var(--accent) 32%, transparent)' : HAIRLINE}`,
            }}
          >
            <span className="font-mono text-[10.5px] font-bold">{task.taskKey}</span>
            <span className="truncate" aria-hidden="true">{task.title}</span>
          </button>
        );
      })}
      {unknownTokens.map((token) => (
        <span
          key={token}
          className="rounded-full px-2 py-0.5 font-mono text-[10.5px] font-bold"
          style={{ color: 'var(--text-muted)', border: '1px dashed var(--border-strong)' }}
          title="Typed in the update — links if this task exists"
        >
          {token}
        </span>
      ))}
    </div>
  );
}
