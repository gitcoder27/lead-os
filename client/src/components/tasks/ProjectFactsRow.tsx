import { CalendarClock } from 'lucide-react';
import type { ProjectFacts } from '@/types';

export const ProjectFactsRow = ({ facts, openTask }: { facts: ProjectFacts; openTask: (key: string) => void }) => (
  <div className="project-facts">
    <span><strong>{facts.open}</strong> open {facts.open === 1 ? 'task' : 'tasks'}</span>
    {facts.blocked > 0 && <span className="project-signal-blocked">{facts.blocked} blocked</span>}
    {facts.overdue > 0 && <span className="project-signal">{facts.overdue} overdue</span>}
    {facts.followUpDue > 0 && <span className="project-signal">{facts.followUpDue} {facts.followUpDue === 1 ? 'follow-up' : 'follow-ups'} due</span>}
    {facts.nextCheck && (
      <button className="ui-link" title={facts.nextCheck.title} onClick={() => openTask(facts.nextCheck!.taskKey)}>
        <CalendarClock size={13} aria-hidden="true" />
        Next check · {new Date(facts.nextCheck.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {facts.nextCheck.taskKey}
      </button>
    )}
  </div>
);
