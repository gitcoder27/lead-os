import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Lock, MessageSquarePlus, Send } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAddMyDayTaskEvent, useAddTaskEvent } from '@/hooks/useTasks';

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
  mode: ComposerMode;
  /** Manager events only — recorded in event meta. */
  via?: 'standup' | 'task_drawer';
  /** Required for developer (My Day) posts. */
  date?: string;
  /** Render as a one-line affordance that expands on focus. */
  collapsed?: boolean;
  placeholder?: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** Arrow-key navigation between stacked composers (standup rows). */
  onArrowNav?: (direction: 'up' | 'down') => void;
  /** Registers expand/focus/privacy handles so a parent can drive this composer. */
  registerComposer?: (api: { expand: () => void; focus: () => void; togglePrivate: () => void } | null) => void;
  autoFocus?: boolean;
}

export function TaskUpdateComposer({
  taskKey,
  mode,
  via,
  date,
  collapsed = false,
  placeholder,
  inputRef,
  onArrowNav,
  registerComposer,
  autoFocus,
}: TaskUpdateComposerProps) {
  const { addToast } = useToast();
  const [draft, setDraft] = useState('');
  const [type, setType] = useState<ManagerEventType | DeveloperEventType>('update');
  const [blockerAction, setBlockerAction] = useState<'raised' | 'cleared'>('raised');
  const [isPrivate, setIsPrivate] = useState(false);
  const [expanded, setExpanded] = useState(!collapsed);
  const requestIdRef = useRef<string>(crypto.randomUUID());
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const addManagerEvent = useAddTaskEvent(taskKey);
  const addMyDayEvent = useAddMyDayTaskEvent(taskKey);
  const pending = addManagerEvent.isPending || addMyDayEvent.isPending;

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
        setIsPrivate((value) => !value);
      },
    });
    return () => registerComposer?.(null);
  }, [registerComposer]);

  const submit = () => {
    const body = draft.trim();
    if (!body || pending) {
      return;
    }
    const requestId = requestIdRef.current;
    const onError = (err: Error) => addToast(err.message, 'error');
    const onSuccess = () => {
      setDraft('');
      setType('update');
      setBlockerAction('raised');
      setIsPrivate(false);
      requestIdRef.current = crypto.randomUUID();
      if (collapsed) {
        setExpanded(false);
      }
    };
    if (mode === 'developer') {
      if (!date) {
        return;
      }
      addMyDayEvent.mutate(
        { date, type: type as DeveloperEventType, body, blockerAction: type === 'blocker' ? blockerAction : undefined, requestId },
        { onSuccess, onError },
      );
      return;
    }
    addManagerEvent.mutate(
      {
        type: type as ManagerEventType,
        body,
        visibility: isPrivate ? 'private' : undefined,
        blockerAction: type === 'blocker' ? blockerAction : undefined,
        via,
        requestId,
      },
      { onSuccess, onError },
    );
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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
        className="mt-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[12px] transition-colors"
        style={{ color: 'var(--text-muted)', background: 'color-mix(in srgb, var(--bg-tertiary) 40%, transparent)' }}
      >
        <MessageSquarePlus size={11} />
        {placeholder ?? 'Add an update…'}
      </button>
    );
  }

  const types = mode === 'developer' ? DEVELOPER_TYPES : MANAGER_TYPES;

  return (
    <div
      className="mt-1 rounded-xl px-2 py-1.5"
      style={{
        background: 'color-mix(in srgb, var(--bg-tertiary) 45%, transparent)',
        border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
      }}
      onClick={(event) => event.stopPropagation()}
    >
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
              className="rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors"
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
                className="rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize transition-colors"
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
            onClick={() => setIsPrivate((value) => !value)}
            className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold transition-colors"
            style={{
              background: isPrivate ? 'rgba(245,158,11,0.12)' : 'var(--bg-tertiary)',
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
          {pending ? 'Saving…' : 'Post'}
        </button>
      </div>
    </div>
  );
}
