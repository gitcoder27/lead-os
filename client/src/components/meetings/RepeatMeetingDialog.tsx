import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
export function RepeatMeetingDialog({ busy, onClose, onRepeat }: { busy: boolean; onClose: () => void; onRepeat: (options: { scheduledOn: string; startsAt: string | null; endsAt: string | null }) => void }) {
  const [date, setDate] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const submit = () => {
    if (!date || busy || (end && (!start || end <= start))) return;
    onRepeat({ scheduledOn: date, startsAt: start ? new Date(`${date}T${start}`).toISOString() : null, endsAt: end ? new Date(`${date}T${end}`).toISOString() : null });
  };
  return <Dialog title="Meet again" subtitle="Reuse the agenda, participants and links" onClose={onClose} onSubmit={submit} footer={<><button className="ui-btn-ghost meeting-touch" disabled={busy} onClick={onClose}>Cancel</button><button className="ui-btn-solid meeting-touch" disabled={!date || busy || Boolean(end && !start) || Boolean(end && start && end <= start)} onClick={submit}>{busy ? 'Creating…' : 'Create next meeting'}</button></>}>
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="meeting-repeat-form"><label>Next date<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label><div className="meeting-action-controls"><label>Start · optional<input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></label><label>End · optional<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></label></div><p className="text-ui" style={{ color: 'var(--text-secondary)' }}>Notes and outcome start empty. Open actions stay linked to their original meeting.</p></form>
  </Dialog>;
}
