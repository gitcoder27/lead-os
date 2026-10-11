import { CalendarClock } from 'lucide-react';
import type { ProjectFacts } from '@/types';
import { formatDayTime } from '@/lib/date-format';

export const ProjectFactsRow = ({ facts, openTask, now = new Date() }: { facts: ProjectFacts; openTask: (key: string) => void; now?: Date }) => {
  // docs/73 UXD-28: a check whose time has passed reads in the warning tone, in the app's one date style.
  const pastCheck = Boolean(facts.nextCheck && new Date(facts.nextCheck.at).getTime() < now.getTime());
  return (
    <div className="project-facts">
      <span><strong>{facts.open}</strong> open {facts.open === 1 ? 'task' : 'tasks'}</span>
      {facts.blocked > 0 && <span className="project-signal-blocked">{facts.blocked} blocked</span>}
      {facts.overdue > 0 && <span className="project-signal">{facts.overdue} overdue</span>}
      {facts.followUpDue > 0 && <span className="project-signal">{facts.followUpDue} {facts.followUpDue === 1 ? 'follow-up' : 'follow-ups'} due</span>}
      {facts.nextCheck && (
        <button
          className="ui-link"
          title={facts.nextCheck.title}
          data-past={pastCheck || undefined}
          style={pastCheck ? { color: 'var(--warning-text)' } : undefined}
          onClick={() => openTask(facts.nextCheck!.taskKey)}
        >
          <CalendarClock size={13} aria-hidden="true" />
          {pastCheck ? 'Check was due' : 'Next check'} · {formatDayTime(facts.nextCheck.at, now)} · {facts.nextCheck.taskKey}
        </button>
      )}
    </div>
  );
};
