import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api, ApiRequestError } from '@/lib/api';
import {
  clearDailyNoteDraft,
  readDailyNoteDraft,
  writeDailyNoteDraft,
} from '@/lib/daily-note-drafts';
import { invalidateDailyNotesViews, useDailyNote } from './useDailyNotes';
import type { DailyNote, DailyNoteFollowUp, DailyNoteResponse } from '@/types';

export const DAILY_NOTE_MAX_LENGTH = 50000;
const AUTOSAVE_DELAY_MS = 700;

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
  latest: DailyNote | null;
  conflict: DailyNote | null;
  followUps: DailyNoteFollowUp[];
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
  const dayQuery = useDailyNote(date);

  const [body, setBody] = useState('');
  const [saveState, setSaveState] = useState<DailyNoteSaveState>('loading');
  const [error, setError] = useState<string | null>(null);
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

  bodyRef.current = body;
  scopeRef.current = scope;

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
      setLatest(note);
      setConflict(null);
      queryClient.setQueryData(['daily-notes', scopeRef.current, 'day', date], res);
      if (bodyRef.current === acknowledgedBody) {
        clearDailyNoteDraft(scopeRef.current, date);
        setStatus('saved');
      } else {
        persistDraft(bodyRef.current);
        setStatus('dirty');
        scheduleSave();
      }
      invalidateDailyNotesViews(queryClient);
    },
    [date, persistDraft, queryClient, scheduleSave, setStatus],
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
      if (saveStateRef.current === 'dirty') {
        setStatus('idle');
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
            enterConflict(remote);
            return;
          } catch {
            if (!mountedRef.current || scopeRef.current !== scopeAtSend) {
              return;
            }
          }
        }
        setError(err instanceof Error ? err.message : 'Could not save');
        setStatus('error');
      }
    })();

    inFlightRef.current = flight;
    try {
      await flight;
    } finally {
      inFlightRef.current = null;
    }
  }, [acknowledge, date, enterConflict, fetchLatest, setStatus]);

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
    if (bodyRef.current === baseBodyRef.current) {
      adoptServerNote(note);
      setStatus('idle');
      return;
    }
    enterConflict(note);
  }, [adoptServerNote, date, dayQuery.data, dayQuery.isLoading, enterConflict, scheduleSave, scope, setStatus]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelPendingTimer();
    };
  }, [cancelPendingTimer]);

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
        return true;
      }
      await attemptSave();
    }
    return bodyRef.current === baseBodyRef.current;
  }, [attemptSave, cancelPendingTimer]);

  const keepBoth = useCallback(() => {
    if (saveStateRef.current !== 'conflict') {
      return;
    }
    const remote = conflict;
    const remoteBody = remote?.body ?? '';
    const localBody = bodyRef.current;
    const combined = remoteBody.length > 0 ? `${remoteBody}\n\n${localBody}` : localBody;
    if (combined.length > DAILY_NOTE_MAX_LENGTH) {
      setError('Combining both versions would exceed the 50,000 character limit. Shorten your draft or use the saved version.');
      return;
    }
    baseBodyRef.current = remoteBody;
    baseRevisionRef.current = remote?.revision ?? 0;
    setLatest(remote);
    setConflict(null);
    setError(null);
    setBody(combined);
    bodyRef.current = combined;
    persistDraft(combined);
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
    latest,
    conflict,
    followUps: dayQuery.data?.followUps ?? [],
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
