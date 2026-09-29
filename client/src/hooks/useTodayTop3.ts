import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import type { SetTodayTop3Request } from '@/types';

/**
 * docs/57 §6 (P3-01): pin up to three of my tasks for a day. Replaces that day's
 * pins on the server, then refetches Today so the queue reorders.
 */
export function useTodayTop3() {
  const qc = useQueryClient();
  const { addToast } = useToast();
  return useMutation({
    mutationFn: (request: SetTodayTop3Request) => api.put<SetTodayTop3Request>('/today/top3', request),
    onError: (error: Error) => addToast(error.message, 'error'),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['today'] });
    },
  });
}
