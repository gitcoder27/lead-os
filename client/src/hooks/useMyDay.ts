import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { registerSurfaceTaskIds, surfaceTaskToWorkItem, taskRefFor } from '@/lib/surface-tasks';
import type {
  MyDayResponse,
  TrackerWorkItem,
  TrackerCheckIn,
  TrackerDeveloperStatus,
  TrackerItemState,
} from '@/types';

export function useMyDay(date: string, enabled = true) {
  const authScopeKey = useAuthScopeKey();

  return useQuery<MyDayResponse>({
    queryKey: ['my-day', date, authScopeKey],
    queryFn: () => api.get<MyDayResponse>(`/my-day?date=${date}`),
    refetchInterval: 30_000,
    enabled,
    // Phase 2c: canonical transport carries `tasks`; rebuild the item-shaped
    // presentation arrays so My Day components stay agnostic.
    select: (data) => {
      if (data.taskModel !== 'canonical' || !data.tasks) return data;
      const items = data.tasks.map((task) => surfaceTaskToWorkItem(task, data.developer.accountId));
      registerSurfaceTaskIds('tracker', items);
      return {
        ...data,
        currentItem: items.find((item) => item.state === 'in_progress'),
        plannedItems: items.filter((item) => item.state === 'planned'),
        completedItems: items.filter((item) => item.state === 'done'),
        droppedItems: items.filter((item) => item.state === 'dropped'),
      };
    },
  });
}

export function useUpdateMyDayStatus(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: TrackerDeveloperStatus) =>
      api.patch('/my-day', { date, status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-day', date] });
      qc.invalidateQueries({ queryKey: ['team-tracker', date] });
    },
  });
}

export function useAddMyDayItem(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      jiraKey?: string;
      relatedIssueKeys?: string[];
      title: string;
      note?: string;
    }) =>
      api.post<TrackerWorkItem>('/my-day/items', { date, ...params }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-day', date] });
      qc.invalidateQueries({ queryKey: ['team-tracker', date] });
    },
  });
}

export function useUpdateMyDayItem(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      itemId: number;
      title?: string;
      note?: string | null;
      state?: TrackerItemState;
      position?: number;
    }) => {
      const { itemId, ...body } = params;
      return api.patch<TrackerWorkItem>(`/my-day/items/${taskRefFor('tracker', itemId)}`, { date, ...body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-day', date] });
      qc.invalidateQueries({ queryKey: ['team-tracker', date] });
      qc.invalidateQueries({ queryKey: ['manager-desk'] });
    },
  });
}

export function useSetMyDayCurrent(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: number) =>
      api.post<TrackerWorkItem>(`/my-day/items/${taskRefFor('tracker', itemId)}/set-current`, { date }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-day', date] });
      qc.invalidateQueries({ queryKey: ['team-tracker', date] });
      qc.invalidateQueries({ queryKey: ['manager-desk'] });
    },
  });
}

export function useAddMyDayCheckIn(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      summary: string;
      status?: TrackerDeveloperStatus;
      taskKeys?: string[];
    }) =>
      api.post<TrackerCheckIn>('/my-day/checkins', { date, ...params }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-day', date] });
      qc.invalidateQueries({ queryKey: ['team-tracker', date] });
    },
  });
}
