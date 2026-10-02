import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Lock, MessageSquarePlus, Send } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAddMyDayTaskEvent, useAddTaskEvent } from '@/hooks/useTasks';
import { useAuthScopeKey } from '@/context/AuthContext';
import { completeTaskUpdateDraft, readTaskUpdateDraft as readDraft, taskDraftGeneration, taskUpdateDraftPrefix, writeTaskUpdateDraft, type TaskUpdateDraft as UpdateDraft } from '@/lib/task-update-drafts';
export { taskUpdateDrafts } from '@/lib/task-update-drafts';

type ComposerMode = 'manager' | 'developer';
type ManagerEventType = 'update' | 'instruction' | 'decision' | 'blocker';
type DeveloperEventType = 'update' | 'blocker';

const MANAGER_TYPES: Array<{ value: ManagerEventType; label: string }> = [
  { value: 'update', label: 'Update' },
  { value: 'instruction', label: 'Told them' },
  { value: 'decision', label: 'Decision' },
  { value: 'blocker', label: 'Blocker' },
];

const DEVELOPER_TYPES: Array<{ value: DeveloperEventType; label: string }> = [
  { value: 'update', label: 'Update' },
  { value: 'blocker', label: 'Blocker' },
];

interface TaskUpdateComposerProps {
  taskKey: string;
  person?: { accountId: string; name: string };
  mode: ComposerMode;
  /** Manager events only — recorded in event meta. */
  via?: 'standup' | 'task_drawer';
  /** Required for developer (My Day) posts. */
  date?: string;
  /** Render as a one-line affordance that expands on focus. */
  collapsed?: boolean;
  /** Collapsed affordance as ghost text rather than a filled pill (dense lists). */
  quiet?: boolean;
  placeholder?: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** Arrow-key navigation between stacked composers (standup rows). */
  onArrowNav?: (direction: 'up' | 'down') => void;
  /** Registers expand/focus/privacy handles so a parent can drive this composer. */
  registerComposer?: (api: { expand: () => void; focus: () => void; togglePrivate: () => void } | null) => void;
  autoFocus?: boolean;
  /** Fires after an event posts successfully (standup session log, docs/50). */
  onPosted?: (event: { type: ManagerEventType | DeveloperEventType; private: boolean; accountId?: string }) => void;
  onEscape?: () => void;
}

export function TaskUpdateComposer(props: TaskUpdateComposerProps) {
  const scope = useAuthScopeKey();
  const storageKey = `${taskUpdateDraftPrefix(scope, props.mode, props.via, props.date)}${props.taskKey}`;
  return <OwnedTaskUpdateComposer key={storageKey} {...props} scope={scope} storageKey={storageKey} />;
}

function OwnedTaskUpdateComposer({
  taskKey,
  person,
  mode,
  via,
  date,
  collapsed = false,
  quiet = false,
  placeholder,
  inputRef,
  onArrowNav,
  registerComposer,
  autoFocus,
  onPosted,
  onEscape,
  storageKey,
  scope,
}: TaskUpdateComposerProps & { storageKey: string; scope: string }) {
  const { addToast } = useToast();
  const [value, setValue] = useState<UpdateDraft>(() => {
    const stored = readDraft(storageKey);
    return { ...stored, person: stored.person ?? person, date: stored.date ?? date };
  });
  const valueRef = useRef(value);
  const { body: draft, type, blockerAction, private: isPrivate } = value;
  const [expanded, setExpanded] = useState(!collapsed || !!value.body);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(value.submitted);
  const submitting = useRef(false);
  const [generation] = useState(() => taskDraftGeneration(scope, storageKey));
  const change = useCallback((updates: Partial<UpdateDraft>) => {
    const previous = valueRef.current;
    const edited = !('submitted' in updates);
    const next = { ...previous, ...updates, ...(edited ? { revision: previous.revision + 1, submitted: false, requestId: previous.submitted ? crypto.randomUUID() : previous.requestId } : {}) };
    valueRef.current = next;
    setValue(next);
    writeTaskUpdateDraft(scope, storageKey, next, generation);
    if (edited) setFailed(false);
  }, [scope, storageKey, generation]);
  const setDraft = (body: string) => change({ body });
  const setType = (next: UpdateDraft['type']) => change({ type: next });
  const setBlockerAction = (next: UpdateDraft['blockerAction']) => change({ blockerAction: next });
  const togglePrivate = useCallback(() => change({ private: !valueRef.current.private }), [change]);
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const addManagerEvent = useAddTaskEvent(taskKey);
  const addMyDayEvent = useAddMyDayTaskEvent(taskKey);
  const pending = sending || addManagerEvent.isPending || addMyDayEvent.isPending;

  useEffect(() => {
    const saved = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== storageKey) return;
      const next = { ...readDraft(storageKey), person: valueRef.current.person ?? person };
      valueRef.current = next;
      setValue(next);
      setFailed(false);
      if (collapsed && !next.body) setExpanded(false);
    };
    window.addEventListener('task-update-saved', saved);
    return () => window.removeEventListener('task-update-saved', saved);
  }, [storageKey, collapsed, person]);

  const setRefs = (el: HTMLTextAreaElement | null) => {
    localRef.current = el;
    if (inputRef) {
      (inputRef as { current: HTMLTextAreaElement | null }).current = el;
    }
  };

  useEffect(() => {
    registerComposer?.({
      expand: () => {
        setExpanded(true);
        window.setTimeout(() => localRef.current?.focus(), 0);
      },
      focus: () => localRef.current?.focus(),
      togglePrivate: () => {
        setExpanded(true);
        togglePrivate();
      },
    });
    return () => registerComposer?.(null);
  }, [registerComposer, togglePrivate]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || pending || submitting.current || (mode === 'developer' && !date)) {
      return;
    }
    if (generation !== taskDraftGeneration(scope, storageKey)) return;
    const submitted = { ...valueRef.current };
    const requestId = submitted.requestId;
    submitting.current = true;
    setSending(true);
    setFailed(false);
    change({ submitted: true });
    const posted = { type, private: isPrivate, accountId: value.person?.accountId };
    try {
      if (mode === 'developer') {
        await addMyDayEvent.mutateAsync({ date: value.date ?? date!, type: type as DeveloperEventType, body, blockerAction: type === 'blocker' ? blockerAction : undefined, requestId });
      } else {
        await addManagerEvent.mutateAsync({
        type: type as ManagerEventType,
        body,
        visibility: isPrivate ? 'private' : undefined,
        blockerAction: type === 'blocker' ? blockerAction : undefined,
        via,
        requestId,
        });
      }
      if (!completeTaskUpdateDraft(scope, storageKey, submitted, generation)) return;
      const latest = readDraft(storageKey);
      const next = { ...latest, person: person ?? value.person, date };
      valueRef.current = next;
      setValue(next);
      onPosted?.(posted);
    } catch (error) {
      if (generation !== taskDraftGeneration(scope, storageKey)) return;
      if (valueRef.current.revision === submitted.revision) setFailed(true);
      addToast(error instanceof Error ? error.message : 'Update was not acknowledged. Retry to confirm it.', 'error');
    } finally {
      submitting.current = false;
      setSending(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.blur();
      if (collapsed) setExpanded(false);
      onEscape?.();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
      return;
    }
    if (onArrowNav && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const el = event.currentTarget;
      const atStart = el.selectionStart === 0;
      const atEnd = el.selectionEnd === el.value.length;
      if ((event.key === 'ArrowUp' && atStart) || (event.key === 'ArrowDown' && atEnd)) {
        event.preventDefault();
        onArrowNav(event.key === 'ArrowUp' ? 'up' : 'down');
      }
    }
  };

  if (collapsed && !expanded) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setExpanded(true);
          window.setTimeout(() => localRef.current?.focus(), 0);
        }}
        className={
          quiet
            ? '-mx-2 mt-0.5 flex w-[calc(100%+1rem)] items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] outline-none transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)] focus-visible:bg-[var(--bg-tertiary)]'
            : 'mt-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[12px] transition-colors'
        }
        style={{ color: 'var(--text-muted)', background: quiet ? undefined : 'color-mix(in srgb, var(--bg-tertiary) 40%, transparent)' }}
      >
        <MessageSquarePlus size={11} />
        {placeholder ?? 'Add an update…'}
      </button>
    );
  }

  const types = mode === 'developer' ? DEVELOPER_TYPES : MANAGER_TYPES;

  return (
    <div
      className="ui-focus-within mt-1 rounded-xl px-2 py-1.5"
      style={{
        background: 'color-mix(in srgb, var(--bg-tertiary) 45%, transparent)',
        border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {value.person && <p className="mb-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{taskKey} · {value.person.name}</p>}
      <textarea
        ref={setRefs}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onClick={(event) => event.stopPropagation()}
        rows={1}
        autoFocus={autoFocus}
        placeholder={placeholder ?? (type === 'instruction' ? 'What did you tell them?' : type === 'decision' ? 'What was decided?' : type === 'blocker' ? 'What is blocking this?' : 'Add an update…')}
        className="w-full resize-none bg-transparent text-[13px] leading-5 outline-none"
        style={{ color: 'var(--text-primary)' }}
        aria-label={`Add an update to ${taskKey}`}
      />
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ background: 'var(--bg-tertiary)' }}>
          {types.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setType(option.value)}
              className="rounded-md px-2 py-0.5 text-[12px] font-semibold transition-colors"
              style={{
                background: type === option.value ? 'var(--bg-elevated)' : 'transparent',
                color: type === option.value ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
              aria-pressed={type === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
        {type === 'blocker' && (
          <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ background: 'var(--bg-tertiary)' }}>
            {(['raised', 'cleared'] as const).map((action) => (
              <button
                key={action}
                type="button"
                  onClick={() => setBlockerAction(action)}
                className="rounded-md px-2 py-0.5 text-[12px] font-semibold capitalize transition-colors"
                style={{
                  background: blockerAction === action ? 'var(--bg-elevated)' : 'transparent',
                  color: blockerAction === action ? (action === 'raised' ? 'var(--danger)' : 'var(--success)') : 'var(--text-muted)',
                }}
                aria-pressed={blockerAction === action}
              >
                {action}
              </button>
            ))}
          </div>
        )}
        {mode === 'manager' && (
          <button
            type="button"
            onClick={togglePrivate}
            className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[12px] font-semibold transition-colors"
            style={{
              background: isPrivate ? 'color-mix(in srgb, var(--warning) 12%, transparent)' : 'var(--bg-tertiary)',
              color: isPrivate ? 'var(--warning)' : 'var(--text-muted)',
            }}
            aria-pressed={isPrivate}
            title={isPrivate ? 'Only you can see this update' : 'Visible to the assignee'}
          >
            <Lock size={10} />
            Private
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim() || pending}
          className="ml-auto flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-colors disabled:opacity-40"
          style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
        >
          <Send size={11} />
          {pending ? 'Saving…' : failed ? 'Retry post' : 'Post'}
        </button>
      </div>
      {failed && <p role="alert" className="mt-1 text-xs">Not acknowledged. Retry to confirm it was saved, or edit this update.</p>}
    </div>
  );
}
