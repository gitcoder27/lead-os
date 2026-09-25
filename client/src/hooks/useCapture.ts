import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CaptureRequestBody, CaptureResponseBody } from 'shared/capture-grammar';
import { api } from '@/lib/api';

/**
 * Phase 3 (P3-D8, §4.3): POST /api/capture — the single capture endpoint.
 * The server re-parses authoritatively; the client preview is advisory.
 */
export function useCapture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CaptureRequestBody) => api.post<CaptureResponseBody>('/capture', input),
    onSuccess: () => {
      for (const key of ['tasks', 'task-detail', 'task-events', 'task-resolution', 'today', 'manager-desk', 'team-tracker', 'my-day', 'daily-notes', 'workload']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
