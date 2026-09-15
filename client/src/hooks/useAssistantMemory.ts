import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type { AssistantMemory } from '@/types';

interface AssistantMemoryResponse {
  memories: AssistantMemory[];
}

export function useAssistantMemory(options?: { enabled?: boolean }) {
  const authScopeKey = useAuthScopeKey();

  return useQuery<AssistantMemoryResponse>({
    queryKey: ['assistant', 'memory', authScopeKey],
    queryFn: () => api.get('/assistant/memory'),
    enabled: options?.enabled ?? true,
  });
}

export function useDeleteAssistantMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.delete(`/assistant/memory/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assistant', 'memory'] });
    },
  });
}

export function useClearAssistantMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.delete('/assistant/memory'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assistant', 'memory'] });
    },
  });
}
