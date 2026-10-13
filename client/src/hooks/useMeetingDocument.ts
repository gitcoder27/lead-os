import { invalidateTaskSurfaces } from '@/lib/task-query-invalidation';
import { mergeNoteBodies } from '@/lib/daily-note-merge';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { useScopedStorageKey } from '@/lib/scoped-storage';
import { authEpoch } from '@/lib/auth-epoch';
import { api, ApiRequestError } from '@/lib/api';
import type { MeetingDocument, MeetingDocumentBody, MeetingDocumentSave, MeetingWorkspaceResponse } from '@/types';

export const meetingBody = (doc?: MeetingDocument | null): MeetingDocumentBody => ({ agenda: doc?.agenda ?? '', notes: doc?.notes ?? '', outcome: doc?.outcome ?? '', noDecisions: doc?.noDecisions ?? false, actions: doc?.actions ?? [] });
const equal = (a: MeetingDocumentBody, b: MeetingDocumentBody) => JSON.stringify(a) === JSON.stringify(b);
export const meetingPath = (key: string) => `/meetings/${encodeURIComponent(key)}/workspace`;

/** One mounted document per task/auth scope. Disk recovery survives navigation; no unload writes. */
export function useMeetingDocument(taskKey: string) {
  const scope = useAuthScopeKey();
  const storageKey = useScopedStorageKey(`meeting-draft:${taskKey}`);
  const qc = useQueryClient();
  const [body, setBody] = useState<MeetingDocumentBody>(meetingBody());
  const [status, setStatus] = useState('Loading');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<MeetingDocument | null | undefined>();
  const [recoveryAvailable, setRecoveryAvailable] = useState(true);
  const state = useRef({ body, base: meetingBody(), document: null as MeetingDocument | null, initialized: false, blocked: false });
  const flight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const lease = useRef(authEpoch(qc));
  const current = () => mounted.current && authEpoch(qc) === lease.current;
  const query = useQuery({ queryKey: ['meeting-workspace', scope, taskKey], queryFn: ({ signal }) => api.get<MeetingWorkspaceResponse>(meetingPath(taskKey), { signal }), retry: false, refetchInterval: 30000 });
  const persist = () => {
    if (!current()) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ ...state.current.body, revision: state.current.document?.revision ?? 0, documentId: state.current.document?.id ?? null, base: state.current.base }));
      setRecoveryAvailable(true);
      return true;
    } catch { setRecoveryAvailable(false); return false; }
  };
  const clear = () => { try { localStorage.removeItem(storageKey); } catch { /* retained status reports storage failure */ } };
  const adopt = (doc: MeetingDocument | null) => {
    const next = meetingBody(doc);
    state.current = { body: next, base: next, document: doc, initialized: true, blocked: false };
    setBody(next); setConflict(undefined); setError(null); setStatus('Saved'); clear();
  };
  const reconcile = (doc: MeetingDocument | null) => {
    if (equal(state.current.body, meetingBody(doc))) { adopt(doc); return; }
    state.current.blocked = true;
    setConflict(doc); setStatus('Could not save'); setError('The saved version changed. Your draft is preserved.');
  };
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void saveRef.current(); }, 800);
  };
  const change = (next: MeetingDocumentBody) => {
    state.current.body = next; setBody(next); const stored = persist();
    if (!state.current.blocked) { setStatus(stored ? 'Saved on this device' : 'Could not save'); setError(null); schedule(); }
  };
  const save = async (): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (flight.current) { await flight.current; return current() ? saveRef.current() : false; }
    if (!current() || !state.current.initialized || state.current.blocked) return false;
    if (equal(state.current.body, state.current.base)) { clear(); setStatus('Saved'); return true; }
    const submitted = state.current.body;
    const document = state.current.document;
    setStatus('Saving');
    const pending = (async () => {
      try {
        const result = await api.put<{ document: MeetingDocument }>(meetingPath(taskKey), { ...submitted, documentId: document?.id ?? null, revision: document?.revision ?? 0 });
        if (!current()) return false;
        // Do not acknowledge over a remote conflict observed while this save was pending.
        if (state.current.blocked) return false;
        if (Boolean(document?.outcome.trim() || document?.noDecisions) !== Boolean(result.document.outcome.trim() || result.document.noDecisions)) invalidateTaskSurfaces(qc, scope, [taskKey]);
        state.current.document = result.document;
        state.current.base = meetingBody(result.document);
        if (equal(state.current.body, submitted)) { clear(); setStatus('Saved'); }
        else { setStatus(persist() ? 'Saved on this device' : 'Could not save'); schedule(); }
        setError(null);
        return true;
      } catch (err) {
        if (!current()) return false;
        if (err instanceof ApiRequestError && err.status === 409) {
          try {
            const latest = await api.get<MeetingWorkspaceResponse>(meetingPath(taskKey));
            if (current()) reconcile(latest.document);
          } catch { if (current()) { setStatus('Could not save'); setError('Could not load the saved version. Retry.'); } }
        } else {
          setStatus(recoveryAvailable ? 'Saved on this device' : 'Could not save');
          setError(err instanceof Error ? err.message : 'Could not save');
        }
        return false;
      }
    })();
    flight.current = pending;
    try { return await pending; } finally { flight.current = null; }
  };
  saveRef.current = save;
  useEffect(() => {
    const remote = query.data?.document;
    if (remote === undefined || !current()) return;
    if (!state.current.initialized) {
      let draft: (MeetingDocumentSave & { base: MeetingDocumentBody }) | null = null;
      try { draft = JSON.parse(localStorage.getItem(storageKey) ?? 'null'); } catch { setRecoveryAvailable(false); }
      adopt(remote);
      if (!draft) return;
      const recovered: MeetingDocumentBody = { agenda: draft.agenda, notes: draft.notes, outcome: draft.outcome, noDecisions: draft.noDecisions, actions: draft.actions };
      if (typeof recovered.agenda !== 'string' || typeof recovered.notes !== 'string' || !Array.isArray(recovered.actions)) return;
      state.current.body = recovered; setBody(recovered);
      if (equal(recovered, meetingBody(remote))) return;
      state.current.base = draft.base ?? meetingBody();
      persist();
      if (draft.documentId === (remote?.id ?? null) && equal(draft.base, meetingBody(remote))) { setStatus('Saved on this device'); schedule(); }
      else reconcile(remote);
      return;
    }
    const base = state.current.document;
    if ((remote?.id ?? null) === (base?.id ?? null) && (remote?.revision ?? 0) <= (base?.revision ?? 0)) return;
    if (flight.current) return; // The response reconciles or rejects against server CAS.
    if (equal(state.current.body, state.current.base)) adopt(remote);
    else reconcile(remote);
    // Helpers read refs; a query acknowledgement is the only effect trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);
  useEffect(() => {
    mounted.current = true;
    const retry = () => { if (!state.current.blocked) void saveRef.current(); };
    window.addEventListener('online', retry);
    return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); window.removeEventListener('online', retry); };
  }, []);
  const flush = async () => {
    while (current() && !state.current.blocked && !equal(state.current.body, state.current.base)) if (!await saveRef.current()) return false;
    return current() && !state.current.blocked;
  };
  return {
    query, body, change, status, error, conflict, recoveryAvailable, flush,
    retry: () => saveRef.current(), document: () => state.current.document,
    useSaved: () => adopt(conflict ?? null),
    keepBoth: () => {
      const local = state.current.body;
      const remote = meetingBody(conflict);
      const base = state.current.base;
      const merge = (field: 'agenda' | 'notes' | 'outcome') => mergeNoteBodies(base[field], local[field], remote[field]).merged;
      const actions = [...remote.actions];
      for (const action of local.actions) {
        const saved = actions.find((row) => row.id === action.id);
        if (!saved) actions.push(action);
        else if (JSON.stringify(saved) !== JSON.stringify(action)) actions.push({ ...action, id: crypto.randomUUID() });
      }
      state.current.document = conflict ?? null; state.current.base = remote; state.current.blocked = false;
      state.current.body = { agenda: merge('agenda'), notes: merge('notes'), outcome: merge('outcome'), noDecisions: local.noDecisions || remote.noDecisions, actions };
      setBody(state.current.body); setConflict(undefined); persist(); schedule();
    },
    keepDraft: () => {
      state.current.document = conflict ?? null; state.current.base = meetingBody(conflict);
      state.current.blocked = false; setConflict(undefined); persist(); schedule();
    },
    accept: adopt,
  };
}
