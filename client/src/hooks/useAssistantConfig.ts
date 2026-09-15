import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type {
  AiAssistantConfig,
  TestAiAssistantConfigRequest,
  TestAiAssistantConfigResponse,
  UpdateAiAssistantConfigRequest,
} from '@/types';

interface UseAssistantConfigOptions {
  enabled?: boolean;
}

export function useAssistantConfig(options?: UseAssistantConfigOptions) {
  const authScopeKey = useAuthScopeKey();

  return useQuery<AiAssistantConfig>({
    queryKey: ['assistant-config', authScopeKey],
    queryFn: () => api.get('/config/ai'),
    enabled: options?.enabled ?? true,
  });
}

export function useUpdateAssistantConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: UpdateAiAssistantConfigRequest) => api.put<AiAssistantConfig>('/config/ai', patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assistant-config'] });
    },
  });
}

export function useTestAssistantConfig() {
  return useMutation({
    mutationFn: (payload: TestAiAssistantConfigRequest) =>
      api.post<TestAiAssistantConfigResponse>('/config/ai/test', payload),
  });
}
