import { useState, type Ref } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { CalendarDays, Plus, UserRound, X } from 'lucide-react';
import { parseCapture, resolveCapture } from 'shared/capture-grammar';
import { getLocalIsoDate } from '@/lib/utils';
import { Select } from '@/components/ui/Select';
import { Disclosure } from '@/components/ui/Disclosure';
import { DatePickerPopover } from '@/components/tasks/TaskDetailPrimitives';
import type { Developer, MeetingActionDraft } from '@/types';

const localTime = (iso?: string | null) => iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
const timestamp = (local: string) => local ? new Date(local).toISOString() : null;
const available = (person: Developer) => person.isActive && person.availability?.state !== 'inactive';

export function MeetingActionRow({ action, index, people, isNew, titleRef, onChange, onNext, onRemove }: {
  action: MeetingActionDraft;
  index: number;
  people: Developer[];
  isNew: boolean;
  titleRef?: Ref<HTMLInputElement>;
  onChange: (action: MeetingActionDraft) => void;
  onNext: () => void;
  onRemove: () => void;
}) {
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null);
  const preview = resolveCapture(parseCapture(action.text, getLocalIsoDate()), { people: people.filter(available).map((person) => ({ accountId: person.accountId, displayName: person.displayName, kind: 'developer' as const })) });
  const owner = preview.owner?.accountId ?? action.ownerAccountId;
  const change = (patch: Partial<MeetingActionDraft>) => onChange({ ...action, ...patch });
  const planDate = (value: string | null) => { change({ scheduledOn: value }); setDateAnchor(null); };
  const extras = [action.dueAt, action.followUpAt, action.waitingOn].filter(Boolean).length;
  return <div className={`meeting-action${isNew ? ' meeting-action-empty' : ''}`}>
    <div className="meeting-action-titleline">
      {isNew && <span className="meeting-action-plus"><Plus size={16} aria-hidden="true" /></span>}
      <input ref={titleRef} aria-label={isNew ? 'New action' : `Action ${index + 1} title`} value={action.text} maxLength={4000}
        placeholder="Add an action…" onChange={(e) => change({ text: e.target.value })} onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && action.text.trim()) { e.preventDefault(); onNext(); }
        }} />
      {!isNew && <button type="button" className="meeting-action-remove" aria-label={`Discard action ${index + 1} draft`} title="Discard draft" onClick={onRemove}><X size={16} aria-hidden="true" /></button>}
    </div>
    {!isNew && <>
      <div className="meeting-action-properties">
        <label className="meeting-action-owner"><UserRound size={15} aria-hidden="true" /><Select variant="quiet" size="sm" aria-label={`Action ${index + 1} owner`} value={action.ownerAccountId ?? ''} onChange={(e) => change({ ownerAccountId: e.target.value || null })}>
          <option value="">You</option>{people.filter(available).map((person) => <option key={person.accountId} value={person.accountId}>{person.displayName}</option>)}
          {action.ownerAccountId && !people.some((person) => person.accountId === action.ownerAccountId && available(person)) && <option value={action.ownerAccountId}>Unavailable owner</option>}
        </Select></label>
        <button type="button" className="meeting-action-date" aria-label={`Action ${index + 1} plan date`} aria-haspopup="dialog" aria-expanded={Boolean(dateAnchor)} onClick={(e) => setDateAnchor(e.currentTarget)}>
          <CalendarDays size={15} aria-hidden="true" />{action.scheduledOn ? format(parseISO(action.scheduledOn), 'MMM d') : 'No plan date'}
        </button>
        <Disclosure className="meeting-action-more" summary={extras ? `More · ${extras}` : 'More'} panelClassName="meeting-action-extra">
          <div className="meeting-action-controls"><label>Deadline<input type="datetime-local" aria-label={`Action ${index + 1} deadline`} value={localTime(action.dueAt)} onChange={(e) => change({ dueAt: timestamp(e.target.value) })} /></label><label>Check by<input type="datetime-local" aria-label={`Action ${index + 1} check by`} value={localTime(action.followUpAt)} onChange={(e) => change({ followUpAt: timestamp(e.target.value) })} /></label></div>
          <label>Waiting on<input aria-label={`Action ${index + 1} waiting on`} value={action.waitingOn?.label ?? ''} onChange={(e) => change({ waitingOn: e.target.value ? { type: 'text', label: e.target.value } : null })} /></label>
        </Disclosure>
      </div>
      {owner && <p className="meeting-muted meeting-action-audience">Visible to {people.find((person) => person.accountId === owner)?.displayName ?? 'selected owner'}{preview.owner ? ' · owner set in title' : ''}</p>}
      {dateAnchor && <DatePickerPopover className="meeting-date-picker" anchor={dateAnchor} label={`Action ${index + 1} plan date`} kind="date" value={action.scheduledOn ?? ''}
        presets={[{ key: 'today', label: 'Today', icon: <CalendarDays size={14} />, onSelect: () => planDate(getLocalIsoDate()) }, { key: 'tomorrow', label: 'Tomorrow', icon: <CalendarDays size={14} />, onSelect: () => planDate(format(addDays(new Date(), 1), 'yyyy-MM-dd')) }]}
        clearLabel="No plan date" onCommit={planDate} onClose={() => setDateAnchor(null)} />}
    </>}
  </div>;
}
