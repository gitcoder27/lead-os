import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { useScopedStorageKey } from '@/lib/scoped-storage';
import { authEpoch } from '@/lib/auth-epoch';
import { api, ApiRequestError } from '@/lib/api';
import { getLocalIsoDate } from '@/lib/utils';
import { invalidateTaskSurfaces } from '@/lib/task-query-invalidation';
import { useToast } from '@/context/ToastContext';
import type { MeetingCaptureRequest, MeetingCaptureResponse, MeetingDocument } from '@/types';

export function useMeetingCapture(taskKey: string, editor: { flush: () => Promise<boolean>; document: () => MeetingDocument | null; accept: (doc: MeetingDocument) => void }) {
  const qc = useQueryClient();
  const scope = useAuthScopeKey();
  const storageKey = useScopedStorageKey(`meeting-submission:${taskKey}`);
  const { addToast } = useToast();
  const [pending, setPending] = useState<MeetingCaptureRequest | null>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? 'null') as MeetingCaptureRequest | null; } catch { return null; }
  });
  const request = useRef(pending);
  const busy = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<MeetingCaptureResponse | null>(null);
  const clear = () => { request.current = null; setPending(null); try { localStorage.removeItem(storageKey); } catch { /* memory receipt remains stable */ } };
  const refresh = () => { invalidateTaskSurfaces(qc, scope); void qc.invalidateQueries({ queryKey: ['meeting-workspace', scope] }); };
  const mutation = useMutation({ mutationFn: async (options: { operation?: MeetingCaptureRequest['operation']; confirm?: boolean; scheduledOn?: string; startsAt?: string | null; endsAt?: string | null } = {}) => {
    if (busy.current) return undefined;
    busy.current = true;
    const epoch = authEpoch(qc);
    const current = () => authEpoch(qc) === epoch;
    setProblem(null);
    try {
      if (!request.current) {
        if (!await editor.flush() || !current()) return undefined;
        const doc = editor.document();
        request.current = { operation: options.operation ?? 'meeting-finish', meetingKey: taskKey, documentId: doc?.id ?? null, revision: doc?.revision ?? 0, requestId: crypto.randomUUID(), clientToday: getLocalIsoDate(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(options.scheduledOn && { scheduledOn: options.scheduledOn }), ...(options.startsAt !== undefined && { startsAt: options.startsAt }), ...(options.endsAt !== undefined && { endsAt: options.endsAt }) };
      }
      if (!current()) return undefined;
      if (options.confirm) request.current = { ...request.current, confirm: true };
      setPending(request.current);
      try { localStorage.setItem(storageKey, JSON.stringify(request.current)); } catch { setProblem('Retry recovery is unavailable on this device. Keep this page open until the submission is confirmed.'); }
      const result = await api.post<MeetingCaptureResponse>('/capture', request.current);
      if (!current()) return undefined;
      if (result.blocked || result.confirmRequired) { setDiagnostics(result); if (result.blocked) clear(); return result; }
      clear(); setDiagnostics(null);
      if (result.operation === 'meeting-finish' && result.document) editor.accept(result.document);
      refresh();
      if (result.undo) {
        const undo = result.undo;
        const expires = Date.parse(undo.expiresAt) - Date.now();
        if (expires > 0) addToast({ type: 'success', title: result.operation === 'meeting-repeat' ? 'Next meeting created' : 'Meeting saved', duration: expires, action: { label: 'Undo', onClick: () => {
          if (!current()) return;
          void api.post(`/meetings/${encodeURIComponent(taskKey)}/undo`, { requestId: undo.requestId }).then(() => { if (current()) refresh(); }).catch((err: unknown) => { if (current()) addToast({ type: 'error', title: 'Could not undo', message: err instanceof Error ? err.message : 'Please refresh' }); });
        } } });
      }
      return result;
    } catch (err) {
      if (!current()) return undefined;
      setProblem(err instanceof Error ? err.message : 'Could not submit. Retry uses the same request.');
      // A definite rejection has no committed receipt. An uncertain transport failure retains it.
      if (err instanceof ApiRequestError && err.status >= 400 && err.status < 500) clear();
      return undefined;
    } finally { busy.current = false; }
  } });
  return { submit: mutation.mutateAsync, isPending: mutation.isPending, pending, problem, diagnostics, cancelConfirmation: () => { if (diagnostics?.confirmRequired) { clear(); setDiagnostics(null); } } };
}
