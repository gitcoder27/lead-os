import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Issue } from '@/types';

export function useExcludeIssue() {
  const queryClient = useQueryClient();

  const exclude = useMutation({
    mutationFn: (key: string) => api.post<{ success: boolean }>(`/issues/${key}/exclude`),

    onMutate: async (key) => {
      await queryClient.cancelQueries({ queryKey: ['issues'] });
      const previousIssues = queryClient.getQueriesData<Issue[]>({ queryKey: ['issues'] });

      queryClient.setQueriesData<Issue[]>(
        { queryKey: ['issues'] },
        (old) => old?.filter((issue) => issue.jiraKey !== key) ?? []
      );

      return { previousIssues };
    },

    onError: (_error, _key, context) => {
      if (context?.previousIssues) {
        for (const [queryKey, data] of context.previousIssues) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      for (const family of ['overview', 'today', 'alerts', 'workload', 'weekly-review'])
        void
      queryClient.invalidateQueries({ queryKey: [family] });
    },
  });

  const restore = useMutation({
    mutationFn: (key: string) => api.post<{ success: boolean }>(`/issues/${key}/restore`),

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      for (const family of ['overview', 'today', 'alerts', 'workload', 'weekly-review'])
        void
      queryClient.invalidateQueries({ queryKey: [family] });
    },
  });

  return { exclude, restore };
}
