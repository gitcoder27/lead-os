import type { RefObject } from 'react';
import type { Developer } from '@/types';
import { Avatar, Kbd } from './StandupPrimitives';
import { ShortcutList, type ShortcutGroup } from '@/components/ui/ShortcutSheet';
import { Dialog } from '@/components/ui/Dialog';

// docs/54 K1: the shared grammar — e done, a assign, n new, . current;
// people move on ← →. Same format as every other sheet (ShortcutList).
export const keyHelp = (note: boolean): ShortcutGroup[] => [
  {
    group: 'Navigate',
    keys: [
      ['← / →', 'Previous / next developer (past the last → wrap-up)'],
      ['j / k', 'Next / previous task'],
      ['Enter', 'Open task drawer'],
    ],
  },
  {
    group: 'Task',
    keys: [
      ['u', 'Log a task update'],
      ['v', 'Composer shared ↔ private'],
      ['.', 'Set as current'],
      ['e', 'Done'],
      ['b', 'Blocked (rationale)'],
      ['a', 'Reassign'],
    ],
  },
  {
    group: 'Person',
    keys: [
      ['c', note ? 'Add a note' : 'General remark (check-in)'],
      // The capture layer assigns to the person on screen; `@name` is only needed to hand it to someone else.
      ['n', 'New task for this person'],
      ['y', 'Accept status suggestion'],
      ['f', 'Flag for follow-up'],
    ],
  },
  {
    group: 'Session',
    keys: [
      ['w', 'Wrap-up'],
      ['?', 'Keyboard shortcuts'],
      ['Esc', 'Close layer / exit'],
    ],
  },
];

/** Standup's capture / check-in / reassign / help layers use the app's one dialog shell (docs/54 V1). */
export function LayerShell({ children, onClose, label }: { children: React.ReactNode; onClose: () => void; label: string }) {
  return (
    <Dialog title={label} onClose={onClose} size="lg" flush>
      {children}
    </Dialog>
  );
}

export function KeyHelpGrid({ note = false }: { note?: boolean }) {
  return (
    <div className="px-3 py-3">
      <ShortcutList groups={keyHelp(note)} />
    </div>
  );
}

export function CheckInForm({
  inputRef,
  note = false,
  value,
  pending,
  onChange,
  onSubmit,
  onCancel,
}: {
  inputRef: RefObject<HTMLTextAreaElement>;
  /** docs/56 P1-04: for people who do not check in, this is a manager note. */
  note?: boolean;
  value: string;
  pending: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2 px-4 py-3">
      <textarea
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
          if (event.key === 'Escape') {
            event.stopPropagation();
            onCancel();
          }
        }}
        rows={3}
        placeholder={note ? 'Add a note — saved on today’s record…' : 'General remark — lands as a check-in on today’s record…'}
        className="w-full resize-none rounded-lg px-3 py-2 text-[13px] leading-5 outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"
        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
      />
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
          <Kbd subtle>↵</Kbd> save · <Kbd subtle>⇧↵</Kbd> newline · mention T-keys to link tasks
        </span>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!value.trim() || pending}
          className="ui-btn-solid"
        >
          {pending ? 'Saving…' : note ? 'Save note' : 'Save check-in'}
        </button>
      </div>
    </div>
  );
}

export function ReassignList({
  developers,
  pending,
  onPick,
}: {
  developers: Developer[];
  pending: boolean;
  onPick: (developer: Developer) => void;
}) {
  if (developers.length === 0) {
    return <div className="px-4 py-5 text-center text-[12.5px]" style={{ color: 'var(--text-muted)' }}>No other developers to reassign to.</div>;
  }
  return (
    <div className="max-h-[300px] overflow-y-auto px-2 py-2">
      {developers.map((dev) => (
        <button
          key={dev.accountId}
          type="button"
          onClick={() => onPick(dev)}
          disabled={pending}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
          style={{ color: 'var(--text-primary)' }}
        >
          <Avatar name={dev.displayName} seed={dev.accountId} size={24} />
          {dev.displayName}
        </button>
      ))}
    </div>
  );
}
