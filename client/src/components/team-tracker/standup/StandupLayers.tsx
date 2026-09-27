import { useEffect, type RefObject } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { Developer } from '@/types';
import { useModalFocus } from '@/hooks/useModalFocus';
import { Avatar, Kbd } from './StandupPrimitives';

export const KEY_HELP: Array<{ group: string; keys: Array<[string, string]> }> = [
  {
    group: 'Navigate',
    keys: [
      ['→ / n', 'Next developer (past the last → wrap-up)'],
      ['← / p', 'Previous developer'],
      ['j / k', 'Next / previous task'],
      ['Enter', 'Open task drawer'],
    ],
  },
  {
    group: 'Task',
    keys: [
      ['u', 'Log a task update'],
      ['v', 'Composer shared ↔ private'],
      ['s', 'Set as current'],
      ['d', 'Done'],
      ['b', 'Blocked (rationale)'],
      ['r', 'Reassign'],
    ],
  },
  {
    group: 'Person',
    keys: [
      ['c', 'General remark (check-in)'],
      ['a', 'Add a task (@dev)'],
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

/** Small modal shell for capture / check-in / reassign / help layers. */
export function LayerShell({ children, onClose, label }: { children: React.ReactNode; onClose: () => void; label: string }) {
  // §6.2: Tab/Shift+Tab stay inside the top layer; focus returns to the
  // standup surface when it unmounts.
  const panelRef = useModalFocus<HTMLDivElement>();
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[70]"
        style={{ background: 'rgba(6, 10, 15, 0.45)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />
      <div className="pointer-events-none fixed inset-0 z-[71] flex items-start justify-center pt-[14vh]">
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-auto w-[calc(100%-2rem)] max-w-[560px] overflow-hidden rounded-2xl"
          role="dialog"
          aria-modal="true"
          aria-label={label}
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid color-mix(in srgb, var(--accent) 16%, var(--border-strong) 84%)',
            boxShadow: '0 24px 64px rgba(0, 0, 0, 0.4)',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className="flex items-center justify-between px-4 py-2.5 text-[12px] font-semibold"
            style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-primary)' }}
          >
            {label}
            <button
              type="button"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded-md"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Close"
            >
              <X size={13} />
            </button>
          </div>
          {children}
        </motion.div>
      </div>
    </>
  );
}

export function KeyHelpGrid() {
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-4 px-4 py-4 sm:grid-cols-2">
      {KEY_HELP.map(({ group, keys }) => (
        <div key={group}>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.09em]" style={{ color: 'var(--text-muted)' }}>
            {group}
          </div>
          <dl className="space-y-1.5">
            {keys.map(([key, description]) => (
              <div key={key} className="flex items-center gap-2.5">
                <dt className="min-w-[48px]"><Kbd>{key}</Kbd></dt>
                <dd className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{description}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
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
        <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          <Kbd subtle>↵</Kbd> save · <Kbd subtle>⇧↵</Kbd> newline · mention T-keys to link tasks
        </span>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!value.trim() || pending}
          className="rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#fff' }}
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
          <Avatar name={dev.displayName} size={24} />
          {dev.displayName}
        </button>
      ))}
    </div>
  );
}
