import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { useTasksPhase3 } from '@/hooks/useTasksPhase3';
import { api } from '@/lib/api';
import { encodeTaskViewDefinition } from '@/lib/task-views';
import type { CreateTaskRequest, ManagerTask, TaskViewDefinition, UpdateTaskRequest } from '@/types';
import type { ManagerDeskItem } from '@/types/manager-desk';

export function canonicalDeskItem(task: ManagerTask): ManagerDeskItem {
  return {
    id: task.legacyDeskItemId ?? task.id, dayId: 0, taskKey: task.taskKey, canonicalTask: true, title: task.title, originDate: task.scheduledOn ?? task.createdAt.slice(0, 10),
    kind: task.kind === 'meeting' ? 'meeting' : 'action', category: (task.labels.find((label) => label.startsWith('category:'))?.slice(9) ?? 'other') as ManagerDeskItem['category'],
    status: task.status === 'active' ? 'in_progress' : task.status === 'blocked' ? 'waiting' : task.status === 'done' ? 'done' : task.status === 'dropped' ? 'cancelled' : task.later ? 'backlog' : task.ownerType ? 'planned' : 'inbox',
    priority: task.priority === 'high' ? 'high' : 'medium', nextAction: task.nextAction ?? undefined, outcome: task.outcome ?? undefined,
    participants: task.participants ?? undefined, followUpAt: task.followUpAt ?? undefined, plannedStartAt: task.startsAt ?? undefined, plannedEndAt: task.endsAt ?? undefined,
    completedAt: task.closedAt ?? undefined, createdAt: task.createdAt, updatedAt: task.updatedAt,
    assigneeDeveloperAccountId: task.ownerType === 'developer' ? task.ownerId ?? undefined : undefined,
    links: task.links.map((link) => ({ id: link.id, itemId: task.id, linkType: link.kind === 'jira' ? 'issue' : link.kind === 'person' ? 'developer' : 'external_group', displayLabel: link.ref,
      issueKey: link.kind === 'jira' ? link.ref : undefined, developerAccountId: link.kind === 'person' ? link.ref : undefined, externalLabel: link.kind === 'external' || link.kind === 'task' ? link.ref : undefined, createdAt: task.createdAt })),
  };
}

/** §5.2: /follow-ups and /meetings are fed by the canonical view definitions. */
function memoryViewDefinitions(view: 'follow-ups' | 'meetings', closedFrom: string, closedTo: string): { open: TaskViewDefinition; closed: TaskViewDefinition } {
  const filters = view === 'follow-ups' ? { followUp: true } : { kind: 'meeting' as const };
  return {
    open: { filters, sort: 'scheduled' },
    closed: { filters: { ...filters, closed: { from: closedFrom, to: closedTo } }, sort: 'updated' },
  };
}

export function useCanonicalMemoryTasks(view: 'follow-ups' | 'meetings', date: string, closedFrom: string, enabled: boolean) {
  const scope = useAuthScopeKey();
  const phase3 = useTasksPhase3();
  return useQuery({
    queryKey: ['tasks', scope, view, date, closedFrom, phase3], enabled,
    queryFn: async () => {
      if (phase3) {
        const defs = memoryViewDefinitions(view, closedFrom, date);
        const [open, closed] = await Promise.all([
          api.get<{ tasks: ManagerTask[] }>(`/tasks?viewDef=${encodeURIComponent(encodeTaskViewDefinition(defs.open))}`),
          api.get<{ tasks: ManagerTask[] }>(`/tasks?viewDef=${encodeURIComponent(encodeTaskViewDefinition(defs.closed))}`),
        ]);
        return [...new Map([...open.tasks, ...closed.tasks].map((task) => [task.id, task])).values()].map(canonicalDeskItem);
      }
      const [open, closed] = await Promise.all([
        api.get<{ tasks: ManagerTask[] }>(`/tasks?view=${view}&date=${date}`),
        api.get<{ tasks: ManagerTask[] }>(`/tasks?view=${view}&closedFrom=${closedFrom}&closedTo=${date}`),
      ]);
      return [...new Map([...open.tasks, ...closed.tasks].map((task) => [task.id, task])).values()].map(canonicalDeskItem);
    },
  });
}

export function useCanonicalTaskMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { taskKey: string; updates: UpdateTaskRequest } | { create: CreateTaskRequest }) => 'create' in input
      ? api.post<ManagerTask>('/tasks', input.create)
      : api.patch<ManagerTask>(`/tasks/${encodeURIComponent(input.taskKey)}`, input.updates),
    onSuccess: () => {
      for (const key of ['tasks', 'task-events', 'task-resolution', 'manager-desk', 'team-tracker', 'my-day', 'today', 'workload']) client.invalidateQueries({ queryKey: [key] });
    },
  });
}