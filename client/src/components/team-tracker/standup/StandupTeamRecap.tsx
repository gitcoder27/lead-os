import { Check, ClipboardCopy } from 'lucide-react';
import { openTasksFor, type StandupSession, type StandupTask } from '@/lib/standup';
import { publicDay, recapChanges, recapChangeText, RECAP_STATUS } from '@/lib/standup-wrapup';
import type { TrackerDeveloperDay } from '@/types';
import { Avatar, ToneChip } from './StandupPrimitives';

function WorkLine({ label, task, onOpenTask }: { label: string; task?: StandupTask; onOpenTask?: (key: string) => void }) {
  return <div className="standup-recap-work"><span>{label}</span>{task ? <button type="button" disabled={!onOpenTask} onClick={() => onOpenTask?.(task.taskKey)}><span className="standup-task-key">{task.taskKey}</span> {task.title}</button> : <p>None set</p>}</div>;
}

export function StandupTeamRecap({ days, session, disabled, onJump, onCopy, onOpenTask }: {
  days: TrackerDeveloperDay[]; session: StandupSession; disabled: boolean;
  onJump: (id: string) => void; onCopy?: () => void; onOpenTask?: (key: string) => void;
}) {
  return <section className="standup-recap" aria-labelledby="standup-recap-title">
    <div className="standup-section-heading"><div><span className="standup-eyebrow">For the team</span><h3 id="standup-recap-title">Team recap</h3></div>
      <button type="button" className="ui-btn-quiet" onClick={onCopy}><ClipboardCopy size={15} />Copy team recap</button>
    </div>
    <p className="standup-section-description">Current and next work, with changes saved this round. Ready to share.</p>
    {days.length === 0 && <p className="standup-empty">No people in this round.</p>}
    {days.map((day) => {
      const id = day.developer.accountId;
      const visited = session.reviewed.includes(id);
      const tasks = openTasksFor(publicDay(day));
      const current = tasks.find((task) => task.status === 'active');
      const next = tasks.find((task) => task.taskKey !== current?.taskKey && task.status !== 'blocked');
      const changes = recapChanges(day, session);
      return <article key={id} className="standup-recap-person">
        <div className="standup-recap-person-heading"><Avatar name={day.developer.displayName} seed={id} size={30} muted /><div className="min-w-0 flex-1"><button type="button" className="standup-person-link" disabled={disabled} onClick={() => onJump(id)} aria-label={`Review ${day.developer.displayName}`}>{day.developer.displayName}</button><span className="standup-visit-state">{visited ? <><Check size={12} />Visited</> : 'Not visited'}</span></div>
          <ToneChip tone={day.status === 'blocked' ? 'danger' : day.status === 'at_risk' || day.status === 'waiting' ? 'warning' : day.status === 'done_for_today' ? 'success' : 'muted'}>{RECAP_STATUS[day.status]}</ToneChip>
        </div>
        <WorkLine label="Current" task={current} onOpenTask={onOpenTask} />
        <WorkLine label="Next" task={next} onOpenTask={onOpenTask} />
        {tasks.filter((task) => task.status === 'blocked').map((task) => <WorkLine key={task.taskKey} label="Blocked" task={task} onOpenTask={onOpenTask} />)}
        {changes.length > 0 ? <div className="standup-recap-changes"><span className="standup-eyebrow">This round</span><ul>{changes.map((entry, index) => <li key={`${entry.at}:${index}`}><Check size={12} /><span>{recapChangeText(entry)}</span></li>)}</ul></div> : <p className="standup-no-changes">{visited ? 'No task changes recorded this round.' : 'Work shown from the board; review still needed.'}</p>}
      </article>;
    })}
    <p className="standup-field-hint mt-4">Team copy excludes private notes, follow-up reasons and unsent drafts.</p>
  </section>;
}
