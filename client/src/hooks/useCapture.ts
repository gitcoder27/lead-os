import { useTaskCountInvalidation } from '@/lib/task-count-invalidation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { parseCapture, type CaptureDefaults, type CaptureDiagnostic, type CaptureRequestBody, type CaptureResponseBody } from 'shared/capture-grammar';
import type { ManagerTask } from '@/types';
import { getLocalIsoDate, getLocalTimeZone } from '@/lib/utils';
import { api } from '@/lib/api';

/**
 * Phase 3 (P3-D8, §4.3): POST /api/capture — the single capture endpoint.
 * The server re-parses authoritatively; the client preview is advisory.
 */
export const postCapture = (body: CaptureRequestBody) => api.post<CaptureResponseBody>('/capture', body);

export function useCapture() {
  const qc = useQueryClient();
  const counts = useTaskCountInvalidation();
  return useMutation({
    mutationFn: postCapture,
    onMutate: counts.submittedScope,
    onSuccess: (response, _variables, scope) => {
      if (response.blocked || response.confirmRequired) return;
      counts.recount(scope);
      for (const key of ['tasks', 'task-detail', 'task-events', 'task-inbox', 'task-inbox-event', 'task-resolution', 'today', 'manager-desk', 'team-tracker', 'my-day', 'daily-notes', 'workload']) {
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
  /** The original attempt day/zone must survive an uncertain transport result. */
  clientToday?: string;
  tz?: string;
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
 * accepted (these paths have no confirm step) but a malformed `@mention` is not; an error diagnostic rejects with
 * `CaptureRejectedError`. `post` is injected so a caller can own its own cache
 * invalidation (the notes hooks guard against an auth-scope change).
 */
export async function createTaskViaCapture(
  post: (body: CaptureRequestBody) => Promise<CaptureResponseBody>,
  { text, defaults, requestId = crypto.randomUUID(), clientToday, tz = getLocalTimeZone() }: CreateViaCapture,
): Promise<CreatedViaCapture> {
  const today = clientToday ?? getLocalIsoDate();
  // These paths only make tasks: `T-n: …` and `/note …` belong to the capture box,
  // and must not be posted as an update or a note.
  if (parseCapture(text, today).intent !== 'create') {
    throw new Error('Start with a task title — "T-n:" updates and "/note" belong in Capture.');
  }
  const body: CaptureRequestBody = { text, clientToday: today, ...(tz && { tz }), requestId, ...(defaults ? { defaults } : {}) };
  const submit = async (request: CaptureRequestBody) => {
    try { return await post(request); }
    catch (error) {
      if (clientToday && clientToday !== getLocalIsoDate() && error instanceof Error && error.message.includes('out of sync')) {
        throw new Error('The earlier submission is unresolved because its original day is too old to retry. Check Tasks before starting a new submission.');
      }
      throw error;
    }
  };
  let res = await submit(body);
  if (res.confirmRequired) {
    // These paths have no confirm step, so they accept a past date on the manager's behalf — but never a
    // malformed @mention, which would become an unowned literal title (docs/63 #8). It is refused as an error.
    if (res.diagnostics.some((entry) => entry.code === 'malformed-mention')) {
      throw new CaptureRejectedError(res.diagnostics.map((entry) => (entry.code === 'malformed-mention' ? { ...entry, severity: 'error' as const } : entry)));
    }
    res = await submit({ ...body, confirm: true });
  }
  if (res.blocked) throw new CaptureRejectedError(res.diagnostics);
  if (!res.task) throw new Error('The task was not created.');
  return { task: res.task, warnings: res.diagnostics.filter((entry) => entry.severity !== 'error') };
}

export function useCaptureTask() {
  const capture = useCapture();
  const create = (input: CreateViaCapture) => createTaskViaCapture(capture.mutateAsync, input);
  return { create, isPending: capture.isPending };
}
