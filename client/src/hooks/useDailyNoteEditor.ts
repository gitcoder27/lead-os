import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api, ApiRequestError } from '@/lib/api';
import {
  clearDailyNoteDraft,
  readDailyNoteDraft,
  writeDailyNoteDraft,
} from '@/lib/daily-note-drafts';
import { mergeNoteBodies } from '@/lib/daily-note-merge';
import {
  invalidateDailyNoteListViews,
  patchDailyNoteInLists,
  useDailyNote,
} from './useDailyNotes';
import type { DailyNote, DailyNoteFollowUp, DailyNoteRef, DailyNoteResponse } from '@/types';

export const DAILY_NOTE_MAX_LENGTH = 50000;
const AUTOSAVE_DELAY_MS = 700;
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000] as const;

export type DailyNoteSaveState =
  | 'loading'
  | 'idle'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'error'
  | 'conflict';

export interface DailyNoteEditor {
  body: string;
  changeBody: (next: string) => void;
  saveState: DailyNoteSaveState;
  error: string | null;
  /** Quiet inline note shown when saved text merged into the draft (docs/52 F3). */
  mergeNotice: string | null;
  /** True while the browser reports no connectivity; an error state means the draft is only on this device. */
  offline: boolean;
  latest: DailyNote | null;
  conflict: DailyNote | null;
  /** Last server-acknowledged body — the common ancestor for conflict hunks (U5). */
  baseBody: string;
  followUps: DailyNoteFollowUp[];
  refs: DailyNoteRef[];
  loading: boolean;
  loadError: Error | null;
  retryLoad: () => void;
  flush: () => Promise<boolean>;
  keepBoth: () => void;
  useSavedVersion: () => void;
  retrySave: () => void;
  recoveryUnavailable: boolean;
}

export function useDailyNoteEditor(date: string): DailyNoteEditor {
  const scope = useAuthScopeKey();
  const queryClient = useQueryClient();

  const [body, setBody] = useState('');
  const [saveState, setSaveState] = useState<DailyNoteSaveState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);
  const [offline, setOffline] = useState(() =>
    typeof navigator === 'undefined' ? false : !navigator.onLine,
  );
  const [latest, setLatest] = useState<DailyNote | null>(null);
  const [conflict, setConflict] = useState<DailyNote | null>(null);
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(false);

  const bodyRef = useRef(body);
  const baseBodyRef = useRef('');
  const baseRevisionRef = useRef(0);
  const saveStateRef = useRef<DailyNoteSaveState>('loading');
  const initializedRef = useRef(false);
  const mountedRef = useRef(true);
  const scopeRef = useRef(scope);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  // Set whenever a save commit lands so list/search/context views refresh on
  // the next commit boundary (blur, date switch) rather than per keystroke.
  const listViewsStaleRef = useRef(false);

  bodyRef.current = body;
  scopeRef.current = scope;

  // P1: pause the 60s day poll while the editor is dirty or a save is in flight.
  const pollPaused = saveState === 'dirty' || saveState === 'saving';
  const dayQuery = useDailyNote(date, { pollPaused });

  const setStatus = useCallback((next: DailyNoteSaveState) => {
    saveStateRef.current = next;
    setSaveState(next);
  }, []);

  const persistDraft = useCallback(
    (nextBody: string) => {
      const ok = writeDailyNoteDraft(scope, date, {
        body: nextBody,
        baseBody: baseBodyRef.current,
        revision: baseRevisionRef.current,
      });
      if (!ok) {
        setRecoveryUnavailable(true);
      }
    },
    [date, scope],
  );

  const adoptServerNote = useCallback(
    (note: DailyNote | null) => {
      const nextBody = note?.body ?? '';
      baseBodyRef.current = nextBody;
      baseRevisionRef.current = note?.revision ?? 0;
      setLatest(note);
      setBody(nextBody);
      bodyRef.current = nextBody;
      setConflict(null);
      setError(null);
      setMergeNotice(null);
      retryCountRef.current = 0;
    },
    [],
  );

  const enterConflict = useCallback(
    (note: DailyNote | null) => {
      setLatest(note);
      setConflict(note);
      setStatus('conflict');
    },
    [setStatus],
  );

  const fetchLatest = useCallback(async (): Promise<DailyNote | null> => {
    const res = await api.get<DailyNoteResponse>(`/notes/${encodeURIComponent(date)}`);
    return res.note;
  }, [date]);

  const attemptSaveRef = useRef<() => Promise<void>>(async () => {});

  const cancelPendingTimer = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const scheduleSave = useCallback((delay = AUTOSAVE_DELAY_MS) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void attemptSaveRef.current();
    }, delay);
  }, []);

  const acknowledge = useCallback(
    (acknowledgedBody: string, acknowledgedRevision: number, note: DailyNote | null, res: DailyNoteResponse) => {
      baseBodyRef.current = acknowledgedBody;
      baseRevisionRef.current = acknowledgedRevision;
      retryCountRef.current = 0;
      listViewsStaleRef.current = true;
      setLatest(note);
      setConflict(null);
      setOffline(false);
      queryClient.setQueryData(['daily-notes', scopeRef.current, 'day', date], res);
      // P1: patch the saved row into cached list pages instead of invalidating
      // the whole ['daily-notes'] prefix on every keystroke-save.
      patchDailyNoteInLists(queryClient, scopeRef.current, date, note);
      if (bodyRef.current === acknowledgedBody) {
        clearDailyNoteDraft(scopeRef.current, date);
        setStatus('saved');
      } else {
        persistDraft(bodyRef.current);
        setStatus('dirty');
        scheduleSave();
      }
    },
    [date, persistDraft, queryClient, scheduleSave, setStatus],
  );

  /**
   * Reconcile a newer remote note with the local draft (docs/52 F3): identical
   * body just bumps the revision, a clean three-way merge (e.g. a pure append)
   * silently rebases the draft and shows a quiet notice, genuine overlap opens
   * the conflict panel.
   */
  const reconcileRemote = useCallback(
    (note: DailyNote | null): 'merged' | 'conflict' | 'ignored' => {
      if (!note) {
        enterConflict(null);
        return 'conflict';
      }
      if (note.body === baseBodyRef.current) {
        setLatest(note);
        baseRevisionRef.current = note.revision;
        return 'ignored';
      }
      if (bodyRef.current === baseBodyRef.current) {
        adoptServerNote(note);
        setStatus('idle');
        return 'ignored';
      }
      const outcome = mergeNoteBodies(baseBodyRef.current, bodyRef.current, note.body);
      if (!outcome.clean) {
        enterConflict(note);
        return 'conflict';
      }
      baseBodyRef.current = note.body;
      baseRevisionRef.current = note.revision;
      setLatest(note);
      setConflict(null);
      setBody(outcome.merged);
      bodyRef.current = outcome.merged;
      persistDraft(outcome.merged);
      setStatus('dirty');
      setMergeNotice(
        outcome.remoteWasAppend
          ? 'New saved text was added below.'
          : 'New saved changes were merged into your draft.',
      );
      scheduleSave(0);
      return 'merged';
    },
    [adoptServerNote, enterConflict, persistDraft, scheduleSave, setStatus],
  );

  const attemptSave = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) {
      return;
    }
    if (inFlightRef.current) {
      await inFlightRef.current;
      return;
    }
    if (!initializedRef.current || saveStateRef.current === 'conflict') {
      return;
    }
    if (bodyRef.current === baseBodyRef.current) {
      if (saveStateRef.current === 'dirty' || saveStateRef.current === 'error') {
        setStatus('idle');
        setError(null);
        retryCountRef.current = 0;
      }
      return;
    }

    const submittedBody = bodyRef.current;
    const submittedRevision = baseRevisionRef.current;
    const scopeAtSend = scopeRef.current;

    if (submittedBody.length > DAILY_NOTE_MAX_LENGTH) {
      setError(
        `This note is over the ${DAILY_NOTE_MAX_LENGTH.toLocaleString()} character limit. Shorten it before saving.`,
      );
      setStatus('error');
      return;
    }

    setStatus('saving');
    setError(null);

    const flight = (async () => {
      try {
        const res = await api.put<DailyNoteResponse>(`/notes/${encodeURIComponent(date)}`, {
          body: submittedBody,
          revision: submittedRevision,
        });
        if (!mountedRef.current || scopeRef.current !== scopeAtSend) {
          return;
        }

        const note = res.note;
        if (!note) {
          if (submittedBody.trim().length === 0) {
            acknowledge(submittedBody, 0, null, res);
            return;
          }
          setError('The note could not be saved. Try again.');
          setStatus('error');
          return;
        }
        if (note.body !== submittedBody) {
          enterConflict(note);
          return;
        }
        acknowledge(note.body, note.revision, note, res);
      } catch (err) {
        if (!mountedRef.current || scopeRef.current !== scopeAtSend) {
          return;
        }
        if (err instanceof ApiRequestError && err.status === 409) {
          try {
            const remote = await fetchLatest();
            if (!mountedRef.current || scopeRef.current !== scopeAtSend) {
              return;
            }
            const outcome = reconcileRemote(remote);
            if (outcome === 'conflict') {
              return;
            }
            // A clean rebase moved the draft onto the new base — persist it
            // immediately rather than waiting for the next keystroke.
            if (bodyRef.current !== baseBodyRef.current) {
              scheduleSave(0);
            }
            return;
          } catch {
            if (!mountedRef.current || scopeRef.current !== scopeAtSend) {
              return;
            }
          }
        }
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setOffline(true);
        }
        retryCountRef.current += 1;
        setError(err instanceof Error ? err.message : 'Could not save your note.');
        setStatus('error');
        // F5: keep retrying with backoff while the draft stays on this device.
        scheduleSave(
          RETRY_DELAYS_MS[Math.min(retryCountRef.current - 1, RETRY_DELAYS_MS.length - 1)] ??
            30_000,
        );
      }
    })();

    inFlightRef.current = flight;
    try {
      await flight;
    } finally {
      inFlightRef.current = null;
    }
  }, [acknowledge, date, enterConflict, fetchLatest, reconcileRemote, scheduleSave, setStatus]);

  useEffect(() => {
    attemptSaveRef.current = attemptSave;
  }, [attemptSave]);

  useEffect(() => {
    const data = dayQuery.data;
    if (data === undefined || dayQuery.isLoading) {
      return;
    }

    const note = data.note ?? null;

    if (!initializedRef.current) {
      initializedRef.current = true;
      const serverBody = note?.body ?? '';
      const draft = readDailyNoteDraft(scope, date);

      if (!draft || draft.body === serverBody) {
        if (draft) {
          clearDailyNoteDraft(scope, date);
        }
        adoptServerNote(note);
        setStatus('idle');
        return;
      }

      setLatest(note);
      if (draft.baseBody === serverBody) {
        baseBodyRef.current = draft.baseBody;
        baseRevisionRef.current = Math.max(note?.revision ?? 0, draft.revision);
        setBody(draft.body);
        bodyRef.current = draft.body;
        setStatus('dirty');
        scheduleSave(0);
      } else {
        // The draft's base diverged from the server — restore it behind the
        // conflict panel so the user decides (keep-both merges against the
        // draft's real base, not a blind concat).
        baseBodyRef.current = draft.baseBody;
        baseRevisionRef.current = draft.revision;
        setBody(draft.body);
        bodyRef.current = draft.body;
        setConflict(note);
        setStatus('conflict');
      }
      return;
    }

    if (!note || note.revision <= baseRevisionRef.current) {
      return;
    }
    if (note.body === baseBodyRef.current) {
      setLatest(note);
      baseRevisionRef.current = note.revision;
      return;
    }
    if (saveStateRef.current === 'conflict') {
      enterConflict(note);
      return;
    }
    if (bodyRef.current === baseBodyRef.current) {
      adoptServerNote(note);
      setStatus('idle');
      return;
    }
    reconcileRemote(note);
  }, [adoptServerNote, date, dayQuery.data, dayQuery.isLoading, enterConflict, reconcileRemote, scheduleSave, scope, setStatus]);

  useEffect(() => {
    mountedRef.current = true;
    const onOnline = () => {
      setOffline(false);
      const state = saveStateRef.current;
      if (state === 'error' || state === 'dirty') {
        scheduleSave(0);
      }
    };
    const onOffline = () => setOffline(true);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && saveStateRef.current === 'error') {
        scheduleSave(0);
      }
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mountedRef.current = false;
      cancelPendingTimer();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      // F6: best-effort flush for a dirty draft on unmount (route leave, or a
      // reload that slips past beforeunload). keepalive lets the PUT outlive
      // the page; a stale-revision duplicate is a harmless no-op.
      if (
        initializedRef.current &&
        saveStateRef.current !== 'conflict' &&
        bodyRef.current !== baseBodyRef.current &&
        typeof fetch === 'function'
      ) {
        try {
          void fetch(`/api/notes/${encodeURIComponent(date)}`, {
            method: 'PUT',
            keepalive: true,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: bodyRef.current, revision: baseRevisionRef.current }),
          }).catch(() => undefined);
        } catch {
          // best-effort only — the local draft remains as the fallback
        }
      }
    };
  }, [cancelPendingTimer, date, scheduleSave]);

  useEffect(() => {
    if (!['dirty', 'saving', 'error', 'conflict'].includes(saveState)) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveState]);

  const changeBody = useCallback(
    (next: string) => {
      setBody(next);
      bodyRef.current = next;
      setMergeNotice(null);
      persistDraft(next);
      if (saveStateRef.current === 'conflict') {
        return;
      }
      if (next === baseBodyRef.current) {
        if (inFlightRef.current) {
          setStatus('dirty');
          return;
        }
        cancelPendingTimer();
        clearDailyNoteDraft(scope, date);
        setError(null);
        setStatus('idle');
        return;
      }
      setError(null);
      setStatus('dirty');
      scheduleSave();
    },
    [cancelPendingTimer, date, persistDraft, scheduleSave, scope, setStatus],
  );

  const flush = useCallback(async (): Promise<boolean> => {
    cancelPendingTimer();
    if (!initializedRef.current) {
      return true;
    }
    while (mountedRef.current) {
      if (inFlightRef.current) {
        await inFlightRef.current;
        continue;
      }
      const settled = saveStateRef.current;
      if (settled === 'conflict' || settled === 'error') {
        return false;
      }
      if (bodyRef.current === baseBodyRef.current) {
        break;
      }
      await attemptSave();
    }
    const ok = saveStateRef.current !== 'conflict' && saveStateRef.current !== 'error';
    // P1: list/search/context refresh happens at commit boundaries (blur,
    // date switch), not per keystroke-save.
    if (ok && listViewsStaleRef.current) {
      listViewsStaleRef.current = false;
      invalidateDailyNoteListViews(queryClient);
    }
    return ok;
  }, [attemptSave, cancelPendingTimer, queryClient]);

  const keepBoth = useCallback(() => {
    if (saveStateRef.current !== 'conflict') {
      return;
    }
    const remote = conflict;
    const remoteBody = remote?.body ?? '';
    const localBody = bodyRef.current;
    // F2: three-way merge against the shared base — a pure append on one side
    // splices its tail on; overlapping hunks keep both edits in order.
    const merged = remoteBody
      ? mergeNoteBodies(baseBodyRef.current, localBody, remoteBody).merged
      : localBody;
    if (merged.length > DAILY_NOTE_MAX_LENGTH) {
      setError('Combining both versions would exceed the 50,000 character limit. Shorten your draft or use the saved version.');
      return;
    }
    baseBodyRef.current = remoteBody;
    baseRevisionRef.current = remote?.revision ?? 0;
    setLatest(remote);
    setConflict(null);
    setError(null);
    setMergeNotice(null);
    setBody(merged);
    bodyRef.current = merged;
    persistDraft(merged);
    setStatus('dirty');
    scheduleSave();
  }, [conflict, persistDraft, scheduleSave, setStatus]);

  const useSavedVersion = useCallback(() => {
    if (saveStateRef.current !== 'conflict') {
      return;
    }
    const remote = conflict;
    adoptServerNote(remote);
    clearDailyNoteDraft(scope, date);
    setStatus('idle');
    setMergeNotice(null);
    retryCountRef.current = 0;
    queryClient.setQueryData(['daily-notes', scope, 'day', date], (existing: DailyNoteResponse | undefined) =>
      existing ? { ...existing, note: remote } : existing,
    );
  }, [adoptServerNote, conflict, date, queryClient, scope, setStatus]);

  const retrySave = useCallback(() => {
    setError(null);
    setStatus('dirty');
    scheduleSave(0);
  }, [scheduleSave, setStatus]);

  const retryLoad = useCallback(() => {
    void dayQuery.refetch();
  }, [dayQuery]);

  return {
    body,
    changeBody,
    saveState,
    error,
    mergeNotice,
    offline,
    latest,
    conflict,
    baseBody: baseBodyRef.current,
    followUps: dayQuery.data?.followUps ?? [],
    refs: dayQuery.data?.refs ?? [],
    loading: !initializedRef.current && dayQuery.isLoading,
    loadError: !initializedRef.current && dayQuery.error ? (dayQuery.error as Error) : null,
    retryLoad,
    flush,
    keepBoth,
    useSavedVersion,
    retrySave,
    recoveryUnavailable,
  };
}
