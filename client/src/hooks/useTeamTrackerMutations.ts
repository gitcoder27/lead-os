import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { taskRefFor } from '@/lib/surface-tasks';
import type {
  TrackerWorkItem,
  TrackerCheckIn,
  TrackerDeveloperStatus,
  TrackerItemState,
} from '@/types';

function invalidateIssueAssignments(queryClient: ReturnType<typeof useQueryClient>, date: string) {
  return queryClient.invalidateQueries({
    queryKey: ['team-tracker', 'issue-assignment', date],
  });
}

function invalidateIssueViews(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['issues'] });
  queryClient.invalidateQueries({ queryKey: ['issue'] });
}

export function useUpdateDay(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      accountId: string;
      status?: TrackerDeveloperStatus;
      managerNotes?: string;
    }) =>
      api.patch(`/team-tracker/${params.accountId}/day`, {
        date,
        status: params.status,
        managerNotes: params.managerNotes,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-tracker'] });
      qc.invalidateQueries({ queryKey: ['workload'] });
    },
  });
}

export function useUpdateAvailability(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      accountId: string;
      state: 'active' | 'inactive';
      note?: string;
    }) =>
      api.patch(`/team-tracker/${params.accountId}/availability`, {
        effectiveDate: date,
        state: params.state,
        note: params.note,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-tracker'] });
      qc.invalidateQueries({ queryKey: ['workload'] });
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['today'] });
      qc.invalidateQueries({ queryKey: ['developers'] });
      qc.invalidateQueries({ queryKey: ['manager-desk'] });
      qc.invalidateQueries({ queryKey: ['manager-desk', 'lookup-developers'] });
      qc.invalidateQueries({ queryKey: ['my-day', date] });
    },
  });
}

export function useAddTrackerItem(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      accountId: string;
      jiraKey?: string;
      relatedIssueKeys?: string[];
      title: string;
      note?: string;
    }) =>
      api.post<TrackerWorkItem>(`/team-tracker/${params.accountId}/items`, {
        date,
        jiraKey: params.jiraKey,
        relatedIssueKeys: params.relatedIssueKeys,
        title: params.title,
        note: params.note,
      }),
    onSuccess: (_data, params) => {
      qc.invalidateQueries({ queryKey: ['team-tracker'] });
      qc.invalidateQueries({ queryKey: ['workload'] });
      invalidateIssueAssignments(qc, date);
      invalidateIssueViews(qc);
      if (params.jiraKey) {
        qc.invalidateQueries({
          queryKey: ['team-tracker', 'issue-assignment', date, params.jiraKey],
        });
      }
    },
  });
}

export function useUpdateTrackerItem(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      itemId: number;
      taskKey?: string;
      title?: string;
      state?: TrackerItemState;
      note?: string | null;
      position?: number;
    }) => {
      const { itemId, taskKey, ...body } = params;
      return api.patch<TrackerWorkItem>(`/team-tracker/items/${taskRefFor('tracker', itemId, taskKey)}`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-tracker'] });
      qc.invalidateQueries({ queryKey: ['manager-desk', 'task-detail'] });
      qc.invalidateQueries({ queryKey: ['manager-desk'] });
      qc.invalidateQueries({ queryKey: ['workload'] });
      invalidateIssueAssignments(qc, date);
      invalidateIssueViews(qc);
    },
  });
}

export function useDeleteTrackerItem(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: number) =>
      api.delete(`/team-tracker/items/${taskRefFor('tracker', itemId)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-tracker'] });
      qc.invalidateQueries({ queryKey: ['manager-desk', 'task-detail'] });
      qc.invalidateQueries({ queryKey: ['workload'] });
      invalidateIssueAssignments(qc, date);
      invalidateIssueViews(qc);
    },
  });
}

export function useSetCurrentItem(date: string) {
  const qc = useQueryClient();
  return useMutation({
    // A string ref is an explicit task key (`T-<n>`); numeric ids resolve
    // through the surface-task registry populated by the board normalizer.
    mutationFn: (itemRef: number | string) =>
      api.post<TrackerWorkItem>(`/team-tracker/items/${typeof itemRef === 'string' ? encodeURIComponent(itemRef) : taskRefFor('tracker', itemRef)}/set-current`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-tracker'] });
      qc.invalidateQueries({ queryKey: ['manager-desk'] });
      qc.invalidateQueries({ queryKey: ['workload'] });
      invalidateIssueAssignments(qc, date);
      invalidateIssueViews(qc);
    },
  });
}

export function useReassignTrackerItem(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { itemId: number | string; toAccountId: string }) =>
      api.post<TrackerWorkItem>(`/team-tracker/items/${typeof params.itemId === 'string' ? encodeURIComponent(params.itemId) : taskRefFor('tracker', params.itemId)}/reassign`, {
        toAccountId: params.toAccountId,
        date,
        requestId: crypto.randomUUID(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-tracker'] });
      qc.invalidateQueries({ queryKey: ['task-events'] });
      qc.invalidateQueries({ queryKey: ['my-day'] });
      qc.invalidateQueries({ queryKey: ['today'] });
      qc.invalidateQueries({ queryKey: ['manager-desk'] });
      qc.invalidateQueries({ queryKey: ['workload'] });
      invalidateIssueAssignments(qc, date);
      invalidateIssueViews(qc);
    },
  });
}

export function useAddCheckIn(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      accountId: string;
      summary: string;
      status?: TrackerDeveloperStatus;
      taskKeys?: string[];
    }) =>
      api.post<TrackerCheckIn>(`/team-tracker/${params.accountId}/checkins`, {
        date,
        summary: params.summary,
        status: params.status,
        taskKeys: params.taskKeys,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-tracker'] });
      qc.invalidateQueries({ queryKey: ['workload'] });
    },
  });
}

export function useStatusUpdate(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      accountId: string;
      status: TrackerDeveloperStatus;
      rationale?: string;
      summary?: string;
      nextFollowUpAt?: string | null;
      taskKey?: string;
    }) => {
      const { accountId, ...body } = params;
      return api.post(`/team-tracker/${accountId}/status-update`, {
        date,
        ...body,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-tracker'] });
      qc.invalidateQueries({ queryKey: ['workload'] });
      qc.invalidateQueries({ queryKey: ['manager-desk'] });
    },
  });
}

export function useCarryForward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { fromDate: string; toDate: string; itemIds?: number[] }) =>
      api.post<{ carried: number }>('/team-tracker/carry-forward', params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-tracker'] });
      qc.invalidateQueries({ queryKey: ['team-tracker', 'carry-forward-context'] });
      qc.invalidateQueries({ queryKey: ['workload'] });
      invalidateIssueViews(qc);
    },
  });
}
