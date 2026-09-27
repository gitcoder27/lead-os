import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { GLOBAL_SEARCH_MIN_LENGTH } from './useGlobalSearch';
import type { GlobalSearchResponse, TaskResolution } from '@/types';

export interface NoteEntityLookups {
  previewTask: (taskKey: string) => Promise<{ title: string; meta?: string } | null>;
  previewIssue: (issueKey: string) => Promise<{ title: string; meta?: string } | null>;
  searchTasks: (query: string) => Promise<Array<{ taskKey: string; title: string }>>;
  searchIssues: (query: string) => Promise<Array<{ key: string; summary: string }>>;
}

const LOOKUP_STALE_MS = 30_000;

const TASK_STATE_LABELS: Record<string, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  dropped: 'Dropped',
  inbox: 'Inbox',
  waiting: 'Waiting',
  backlog: 'Backlog',
  cancelled: 'Dropped',
};

/**
 * Imperative lookups for the note editor's hover previews and autocomplete
 * (docs/52 F1). They share cache keys with `useGlobalSearch` and
 * `useTaskResolution`, so a preview seen once is instant the next time.
 */
export function useNoteEntityLookups(): NoteEntityLookups {
  const queryClient = useQueryClient();
  const scope = useAuthScopeKey();

  return useMemo(() => {
    const globalSearch = (query: string) =>
      queryClient.fetchQuery({
        queryKey: ['global-search', scope, query],
        queryFn: () => api.get<GlobalSearchResponse>(`/search?q=${encodeURIComponent(query)}`),
        staleTime: LOOKUP_STALE_MS,
      });

    return {
      previewTask: async (taskKey) => {
        const task = await queryClient.fetchQuery({
          queryKey: ['task-resolution', scope, 'manager', taskKey],
          queryFn: () => api.get<TaskResolution>(`/tasks/${encodeURIComponent(taskKey)}`),
          staleTime: LOOKUP_STALE_MS,
          retry: false,
        });
        if (!task || task.deleted) return task ? { title: task.title, meta: 'Deleted' } : null;
        const state = task.state ?? task.status;
        const meta = [state ? TASK_STATE_LABELS[state] ?? state : null, task.developer?.displayName].filter(Boolean).join(' · ');
        return { title: task.title, meta: meta || undefined };
      },
      previewIssue: async (issueKey) => {
        const result = await globalSearch(issueKey);
        const issue = result.issues.find((entry) => entry.jiraKey === issueKey);
        return issue ? { title: issue.summary, meta: [issue.statusName, issue.assigneeName].filter(Boolean).join(' · ') } : null;
      },
      searchTasks: async (query) => {
        if (query.trim().length < GLOBAL_SEARCH_MIN_LENGTH) return [];
        const result = await globalSearch(query.trim());
        return result.tasks.filter((task) => task.taskKey).map((task) => ({ taskKey: task.taskKey, title: task.title }));
      },
      searchIssues: async (query) => {
        if (query.trim().length < GLOBAL_SEARCH_MIN_LENGTH) return [];
        const result = await globalSearch(query.trim());
        return result.issues.map((issue) => ({ key: issue.jiraKey, summary: issue.summary }));
      },
    };
  }, [queryClient, scope]);
}
