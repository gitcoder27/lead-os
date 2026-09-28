import type { RefObject } from 'react';
import type { Developer } from '@/types';
import { Avatar, Kbd } from './StandupPrimitives';
import { ShortcutList, type ShortcutGroup } from '@/components/ui/ShortcutSheet';
import { Dialog } from '@/components/ui/Dialog';

// docs/54 K1: the shared grammar — e done, a assign, n new, . current;
// people move on ← →. Same format as every other sheet (ShortcutList).
export const KEY_HELP: ShortcutGroup[] = [
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
      ['c', 'General remark (check-in)'],
      ['n', 'New task (@dev)'],
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

export function KeyHelpGrid() {
  return (
    <div className="px-3 py-3">
      <ShortcutList groups={KEY_HELP} />
    </div>
  );
}

export function CheckInForm({
  inputRef,
  value,
  pending,
  onChange,
  onSubmit,
  onCancel,
}: {
  inputRef: RefObject<HTMLTextAreaElement>;
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
        placeholder="General remark — lands as a check-in on today’s record…"
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
          {pending ? 'Saving…' : 'Save check-in'}
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
