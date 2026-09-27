import { forwardRef, useState } from 'react';
import { CalendarClock, CheckCheck, ChevronDown, ListPlus, SquarePlus } from 'lucide-react';
import { MenuItem, TaskPopover } from '@/components/tasks/TaskPopover';
import { NOTE_ACTION_SHORTCUTS, type NoteLineAction } from './editor/note-editor-extensions';

export const NOTES_SHORTCUTS: Array<[string, string]> = [
  [NOTE_ACTION_SHORTCUTS.task.label, 'Turn line into a task'],
  [NOTE_ACTION_SHORTCUTS.update.label, 'Add line as a task update'],
  [NOTE_ACTION_SHORTCUTS['follow-up'].label, 'Turn line into a follow-up'],
  ['/', 'Commands (at line start)'],
  ['@ · T- · #', 'Mention a person · task · Jira issue'],
  ['⌘-click', 'Open a chip'],
  ['⌘⏎', 'Wrap up the day'],
  ['⌥↑ ⌥↓', 'Previous / next day'],
  ['⌥T', 'Today'],
  ['⌘⇧F', 'Search notes'],
  ['⌘S', 'Save now'],
  ['?', 'Show shortcuts'],
];

interface NotesDocFooterProps {
  saveLabel: string;
  saveTone: 'default' | 'error' | 'warning';
  onRetrySave?: () => void;
  mergeNotice: string | null;
  charCount: { value: number; max: number; over: boolean } | null;
  recoveryUnavailable: boolean;
  /** Why the line actions are unavailable, or null when they're live (U4). */
  actionsDisabledReason: string | null;
  onAction: (action: NoteLineAction) => void;
  wrapUpCount: number;
  /** Nudge the wrap-up once the working day is winding down. */
  wrapUpNudge: boolean;
  onWrapUp: () => void;
  shortcutsOpen: boolean;
  onShortcutsOpenChange: (open: boolean) => void;
}

const ACTIONS: Array<{ action: NoteLineAction; label: string; icon: typeof ListPlus }> = [
  { action: 'task', label: 'Task…', icon: SquarePlus },
  { action: 'update', label: 'Update to a task…', icon: ListPlus },
  { action: 'follow-up', label: 'Follow-up…', icon: CalendarClock },
];

export const NotesDocFooter = forwardRef<HTMLButtonElement, NotesDocFooterProps>(function NotesDocFooter(
  {
    saveLabel,
    saveTone,
    onRetrySave,
    mergeNotice,
    charCount,
    recoveryUnavailable,
    actionsDisabledReason,
    onAction,
    wrapUpCount,
    wrapUpNudge,
    onWrapUp,
    shortcutsOpen,
    onShortcutsOpenChange,
  },
  shortcutsRef,
) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const [shortcutsAnchor, setShortcutsAnchor] = useState<HTMLButtonElement | null>(null);
  const disabled = actionsDisabledReason !== null;

  return (
    <div className="notes-doc-footer">
      <span className={`notes-save-state ${saveTone}`}>
        {saveLabel}
        {onRetrySave ? (
          <button type="button" className="notes-link-button" onClick={onRetrySave}>
            Retry
          </button>
        ) : null}
      </span>
      {mergeNotice ? <span className="notes-footer-note">{mergeNotice}</span> : null}
      {recoveryUnavailable ? (
        <span className="notes-footer-note" style={{ color: 'var(--warning)' }}>
          Draft recovery unavailable in this browser — keep this page open until saved.
        </span>
      ) : null}
      <span className="notes-meta-spacer" />
      {charCount ? (
        <span className={`notes-char-count${charCount.over ? ' danger' : ''}`}>
          {charCount.value.toLocaleString()}/{charCount.max.toLocaleString()}
        </span>
      ) : null}
      {wrapUpCount > 0 ? (
        <button
          type="button"
          className={`notes-ghost-button${wrapUpNudge ? ' nudge' : ''}`}
          onClick={onWrapUp}
          title={`Wrap up the day — ${wrapUpCount} open item${wrapUpCount === 1 ? '' : 's'} (⌘⏎)`}
          disabled={disabled}
        >
          <CheckCheck size={12} aria-hidden="true" />
          Wrap up
          <span className="notes-ghost-count">{wrapUpCount}</span>
        </button>
      ) : null}
      {/* U4: a disabled control still explains itself on hover/focus. */}
      <span title={actionsDisabledReason ?? undefined} className="inline-flex">
        <button
          type="button"
          className="notes-ghost-button"
          aria-haspopup="menu"
          aria-expanded={Boolean(menuAnchor)}
          disabled={disabled}
          // Keep the editor's selection alive while the menu opens.
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => setMenuAnchor(menuAnchor ? null : event.currentTarget)}
        >
          Turn into…
          <ChevronDown size={12} aria-hidden="true" />
        </button>
      </span>
      {disabled ? <span className="sr-only">{actionsDisabledReason}</span> : null}
      <button
        ref={(node) => {
          setShortcutsAnchor(node);
          if (typeof shortcutsRef === 'function') shortcutsRef(node);
          else if (shortcutsRef) shortcutsRef.current = node;
        }}
        type="button"
        className="notes-icon-button"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        aria-expanded={shortcutsOpen}
        onClick={() => onShortcutsOpenChange(!shortcutsOpen)}
      >
        <span aria-hidden="true">?</span>
      </button>

      {menuAnchor ? (
        <TaskPopover anchor={menuAnchor} onClose={() => setMenuAnchor(null)} label="Turn line into" width={240}>
          {ACTIONS.map(({ action, label, icon: Icon }) => (
            <MenuItem
              key={action}
              icon={<Icon size={13} />}
              label={label}
              hint={NOTE_ACTION_SHORTCUTS[action].label}
              onSelect={() => {
                setMenuAnchor(null);
                onAction(action);
              }}
            />
          ))}
        </TaskPopover>
      ) : null}

      {shortcutsOpen && shortcutsAnchor ? (
        <TaskPopover anchor={shortcutsAnchor} onClose={() => onShortcutsOpenChange(false)} label="Keyboard shortcuts" width={300} role="dialog">
          <dl className="notes-shortcuts" tabIndex={-1} data-autofocus="">
            {NOTES_SHORTCUTS.map(([keys, label]) => (
              <div key={keys}>
                <dt>
                  <kbd>{keys}</kbd>
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </TaskPopover>
      ) : null}
    </div>
  );
});
