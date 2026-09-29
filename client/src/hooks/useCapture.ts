import { useMutation, useQueryClient } from '@tanstack/react-query';
import { parseCapture, type CaptureDefaults, type CaptureDiagnostic, type CaptureRequestBody, type CaptureResponseBody } from 'shared/capture-grammar';
import type { ManagerTask } from '@/types';
import { getLocalIsoDate } from '@/lib/utils';
import { api } from '@/lib/api';

/**
 * Phase 3 (P3-D8, §4.3): POST /api/capture — the single capture endpoint.
 * The server re-parses authoritatively; the client preview is advisory.
 */
export const postCapture = (body: CaptureRequestBody) => api.post<CaptureResponseBody>('/capture', body);

export function useCapture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postCapture,
    onSuccess: () => {
      for (const key of ['tasks', 'task-detail', 'task-events', 'task-resolution', 'today', 'manager-desk', 'team-tracker', 'my-day', 'daily-notes', 'workload']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

/** The server refused a capture (an error diagnostic such as an unknown `@person`); nothing was created. */
export class CaptureRejectedError extends Error {
  constructor(readonly diagnostics: CaptureDiagnostic[]) {
    super(diagnostics.find((entry) => entry.severity === 'error')?.message ?? 'Capture was rejected');
    this.name = 'CaptureRejectedError';
  }
}

export interface CreateViaCapture {
  text: string;
  defaults?: CaptureDefaults;
  /** Reuse across retries so a transport retry replays to the same task. */
  requestId?: string;
}

export interface CreatedViaCapture {
  task: ManagerTask;
  /** Non-blocking diagnostics (an unsynced `#KEY` kept as text, a past date). */
  warnings: CaptureDiagnostic[];
}

/**
 * docs/57 §3 (P3-05): one-shot task creation for UI paths that are not the
 * capture box (inline add, dialogs, child tasks). The text goes through the
 * shared grammar and `defaults` carry the structured context. A past date is
 * accepted (these paths have no confirm step); an error diagnostic rejects with
 * `CaptureRejectedError`. `post` is injected so a caller can own its own cache
 * invalidation (the notes hooks guard against an auth-scope change).
 */
export async function createTaskViaCapture(
  post: (body: CaptureRequestBody) => Promise<CaptureResponseBody>,
  { text, defaults, requestId = crypto.randomUUID() }: CreateViaCapture,
): Promise<CreatedViaCapture> {
  const today = getLocalIsoDate();
  // These paths only make tasks: `T-n: …` and `/note …` belong to the capture box,
  // and must not be posted as an update or a note.
  if (parseCapture(text, today).intent !== 'create') {
    throw new Error('Start with a task title — "T-n:" updates and "/note" belong in Capture.');
  }
  const body: CaptureRequestBody = { text, clientToday: today, requestId, ...(defaults ? { defaults } : {}) };
  let res = await post(body);
  if (res.confirmRequired) res = await post({ ...body, confirm: true });
  if (res.blocked) throw new CaptureRejectedError(res.diagnostics);
  if (!res.task) throw new Error('The task was not created.');
  return { task: res.task, warnings: res.diagnostics.filter((entry) => entry.severity !== 'error') };
}

export function useCaptureTask() {
  const capture = useCapture();
  const create = (input: CreateViaCapture) => createTaskViaCapture(capture.mutateAsync, input);
  return { create, isPending: capture.isPending };
}
