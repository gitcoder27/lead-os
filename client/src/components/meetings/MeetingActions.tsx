import { Select } from '@/components/ui/Select';
import { Disclosure } from '@/components/ui/Disclosure';
import type { Developer, MeetingActionDraft } from '@/types';
const localTime = (iso?: string | null) => iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
const timestamp = (local: string) => local ? new Date(local).toISOString() : null;
export function MeetingActions({ actions, people, onChange }: { actions: MeetingActionDraft[]; people: Developer[]; onChange: (actions: MeetingActionDraft[]) => void }) {
  const change = (id: string, patch: Partial<MeetingActionDraft>) => onChange(actions.map((row) => row.id === id ? { ...row, ...patch } : row));
  return <section><h2>Actions <span className="meeting-muted">Private drafts until submitted</span></h2>
    {actions.map((action, index) => <div className="meeting-action" key={action.id}>
      <label>Title<input aria-label={`Action ${index + 1} title`} value={action.text} maxLength={4000} placeholder="What needs to happen?" onChange={(e) => change(action.id, { text: e.target.value })} /></label>
      <div className="meeting-action-controls"><label>Owner<Select className="w-full" aria-label={`Action ${index + 1} owner`} value={action.ownerAccountId ?? ''} onChange={(e) => change(action.id, { ownerAccountId: e.target.value || null })}><option value="">You</option>{people.filter((person) => person.isActive).map((person) => <option key={person.accountId} value={person.accountId}>{person.displayName}</option>)}{action.ownerAccountId && !people.some((person) => person.accountId === action.ownerAccountId && person.isActive) && <option value={action.ownerAccountId}>Unavailable owner</option>}</Select></label><label>Plan date · optional<input type="date" aria-label={`Action ${index + 1} plan date`} value={action.scheduledOn ?? ''} onChange={(e) => change(action.id, { scheduledOn: e.target.value || null })} /></label></div>
      {action.ownerAccountId && <p className="meeting-muted">Visible to {people.find((person) => person.accountId === action.ownerAccountId)?.displayName ?? 'selected owner'}</p>}
      <Disclosure summary="More"><div className="meeting-action-controls"><label>Deadline<input type="datetime-local" aria-label={`Action ${index + 1} deadline`} value={localTime(action.dueAt)} onChange={(e) => change(action.id, { dueAt: timestamp(e.target.value) })} /></label><label>Check by<input type="datetime-local" aria-label={`Action ${index + 1} check by`} value={localTime(action.followUpAt)} onChange={(e) => change(action.id, { followUpAt: timestamp(e.target.value) })} /></label></div><label>Waiting on<input aria-label={`Action ${index + 1} waiting on`} value={action.waitingOn?.label ?? ''} onChange={(e) => change(action.id, { waitingOn: e.target.value ? { type: 'text', label: e.target.value } : null })} /></label></Disclosure>
      <button className="ui-btn-ghost" onClick={() => onChange(actions.filter((row) => row.id !== action.id))}>Remove action {index + 1}</button>
    </div>)}
    <button className="ui-btn-ghost" disabled={actions.length >= 30} onClick={() => onChange([...actions, { id: crypto.randomUUID(), text: '' }])}>Add action</button>
  </section>;
}
