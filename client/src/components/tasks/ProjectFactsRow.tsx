import type { ProjectFacts } from '@/types';
export const ProjectFactsRow = ({ facts, openTask }: { facts: ProjectFacts; openTask: (key: string) => void }) => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs" style={{ color: 'var(--text-muted)' }}>
    <span>{facts.open} open</span>
    <span>{facts.blocked} blocked</span>
    <span>{facts.overdue} overdue</span>
    <span>{facts.followUpDue} follow-ups due</span>
    {facts.nextCheck ? (
      <button className="underline" onClick={() => openTask(facts.nextCheck!.taskKey)}>
        Check {new Date(facts.nextCheck.at).toLocaleDateString()} · {facts.nextCheck.taskKey}
      </button>
    ) : (
      <span>No check scheduled</span>
    )}
  </div>
);
