import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type { CreateTaskRequest, ManagerTask, UpdateTaskRequest } from '@/types';
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

export function useCanonicalMemoryTasks(view: 'follow-ups' | 'meetings', date: string, closedFrom: string, enabled: boolean) {
  const scope = useAuthScopeKey();
  return useQuery({
    queryKey: ['tasks', scope, view, date, closedFrom], enabled,
    queryFn: async () => {
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