import { format, parseISO } from 'date-fns';
import { StatusPill } from '@/components/tasks/TaskDetailFields';
import type { Developer, ManagerTask } from '@/types';

export function MeetingSavedActions({ actions, people, onOpen }: {
  actions: ManagerTask[];
  people: Developer[];
  onOpen: (key: string) => void;
}) {
  if (!actions.length) return null;
  return <section aria-label="Agreed actions">
    <h2>Agreed actions <span className="meeting-muted">{actions.length}</span></h2>
    {actions.map((action) => {
      const owner = action.ownerType === 'manager' ? 'You'
        : action.ownerType === 'developer' ? people.find((person) => person.accountId === action.ownerId)?.displayName ?? 'Developer'
        : 'Unassigned';
      return <button key={action.taskKey} className="meeting-saved-action" onClick={() => onOpen(action.taskKey)}>
        <span className="meeting-saved-action-copy"><span className="meeting-saved-action-title">{action.title}</span>
          <span className="meeting-muted">{action.taskKey} · {owner} · {action.scheduledOn ? format(parseISO(action.scheduledOn), 'MMM d, yyyy') : 'No plan date'}</span>
        </span>
        <StatusPill status={action.status} />
      </button>;
    })}
  </section>;
}
