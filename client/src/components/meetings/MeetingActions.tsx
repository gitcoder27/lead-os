import { useRef, useState } from 'react';
import type { Developer, MeetingActionDraft } from '@/types';
import { MeetingActionRow } from './MeetingActionRow';

export function MeetingActions({ actions, people, onChange }: {
  actions: MeetingActionDraft[];
  people: Developer[];
  onChange: (actions: MeetingActionDraft[]) => void;
}) {
  const [nextId, setNextId] = useState(() => crypto.randomUUID());
  const newInput = useRef<HTMLInputElement>(null);
  const rows = actions.length < 30 ? [...actions, { id: nextId, text: '' }] : actions;
  const next = () => newInput.current?.focus();
  const change = (action: MeetingActionDraft) => {
    if (action.id !== nextId) { onChange(actions.map((row) => row.id === action.id ? action : row)); return; }
    if (!action.text) return;
    // Persist the first keystroke like every other draft; Enter only moves focus.
    setNextId(crypto.randomUUID());
    onChange([...actions, action]);
  };
  return <section aria-label="New actions">
    <h2>New actions {actions.length > 0 && <span className="meeting-muted">{actions.length} {actions.length === 1 ? 'draft' : 'drafts'}</span>}</h2>
    <p className="meeting-muted meeting-action-hint">Drafts stay private until submitted. Press Enter for another action.</p>
    {rows.map((action, index) => <MeetingActionRow key={action.id} action={action} index={index} people={people}
      isNew={action.id === nextId} titleRef={action.id === nextId ? newInput : undefined}
      onChange={change} onNext={next} onRemove={() => {
        onChange(actions.filter((row) => row.id !== action.id));
        requestAnimationFrame(next);
      }} />)}
    {actions.length >= 30 && <p className="meeting-muted" role="status">Submit these drafts before adding more actions.</p>}
  </section>;
}
