import { useState } from 'react';
import { Bell, Plus } from 'lucide-react';
import type { ManagerTask } from '@/types';
import { usePersonCommitments } from '@/hooks/usePersonCommitments';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';
import { QueryReadError } from '@/components/ui/QueryReadError';
import { FOCUS_RING } from '@/components/ui/focus';
import { formatCompactRelative } from './trackerItemFormat';
import { DrawerSection, EmptyLine } from './DeveloperDrawerSections';

export function PersonCommitments({ accountId, onCapture, isSelf = false }: { accountId: string; onCapture: () => void; isSelf?: boolean }) {
  const query = usePersonCommitments(accountId);
  const [taskKey, setTaskKey] = useState<string | null>(null);
  const rows = query.data?.tasks ?? [];
  const waiting = (task: ManagerTask) => !isSelf && (task.waitingOn?.type === 'developer' && task.waitingOn.ref === accountId || task.ownerType === 'developer' && task.ownerId === accountId);
  const groups = [
    { title: isSelf ? 'My open commitments' : 'I owe them', tasks: rows.filter((task) => !waiting(task)) },
    { title: 'Waiting on them', tasks: rows.filter(waiting) },
  ].filter((group) => !isSelf || group.title !== 'Waiting on them');
  return (
    <DrawerSection icon={<Bell size={14} />} title="Open commitments" hint="All dates">
      {query.isError && <QueryReadError message="Could not load commitments." onRetry={query.refetch} retrying={query.isFetching} />}
      {query.isLoading ? <EmptyLine>Loading commitments…</EmptyLine> : query.data && groups.map((group) => (
        <section key={group.title} aria-label={group.title} className="mb-3">
          <h4 className="mb-1 text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{group.title} ({group.tasks.length})</h4>
          {group.tasks.length === 0 ? <EmptyLine>No open commitments.</EmptyLine> : (
            <ul className="space-y-1">
              {group.tasks.map((task) => (
                <li key={task.taskKey}>
                  <button type="button" onClick={() => setTaskKey(task.taskKey)} className={`min-h-11 w-full rounded-lg px-2 py-2 text-left hover:bg-[var(--bg-secondary)] ${FOCUS_RING}`}>
                    <span className="block text-[13px]" style={{ color: 'var(--text-primary)' }}>{task.taskKey} · {task.title}</span>
                    <span className="block text-[12px]" style={{ color: 'var(--text-muted)' }}>
                      {task.status} · Updated {formatCompactRelative(task.updatedAt)} · {task.later ? 'Later' : task.scheduledOn ?? 'Undated'}
                      {task.followUpAt ? ` · Next check ${new Date(task.followUpAt).toLocaleString()}` : ' · Next check not scheduled'}
                    </span>
                    {task.nextAction && <span className="block text-[12px]" style={{ color: 'var(--text-secondary)' }}>Next: {task.nextAction}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <button type="button" onClick={onCapture} className={`flex min-h-11 items-center gap-2 text-[12px] ${FOCUS_RING}`} style={{ color: 'var(--accent)' }}><Plus size={14} />Capture follow-up</button>
      <TaskDrawer key={accountId} taskKey={taskKey} onClose={() => setTaskKey(null)} onNavigateTask={setTaskKey} stacked />
    </DrawerSection>
  );
}
