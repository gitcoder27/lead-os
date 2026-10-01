import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_STANDUP_SESSION, loadStandupSession, saveStandupSession, standupSessionReducer, type StandupSessionAction } from '@/lib/standup';

export function useStandupRound(storageKey: string, order: string[]) {
  const [session, setSession] = useState(() => {
    const stored = loadStandupSession(storageKey);
    return { ...stored, roundId: stored.roundId ?? crypto.randomUUID(), startedAt: stored.startedAt ?? new Date().toISOString(), order: stored.order ?? order };
  });
  const current = useRef(session);
  const initialOrder = useRef(order);
  const mounted = useRef(true);
  const [storageFailed, setStorageFailed] = useState(false);
  const [ownsRound, setOwnsRound] = useState(!navigator.locks);
  const generation = session.roundId;
  const dispatch = useCallback((action: StandupSessionAction) => {
    if (current.current.roundId !== generation) return;
    const stored = loadStandupSession(storageKey);
    if (stored.roundId && stored.roundId !== generation) return;
    if (!mounted.current && !stored.roundId) return;
    const next = standupSessionReducer(!mounted.current && stored.roundId ? stored : current.current, action);
    const normalized = { ...next, roundId: next.roundId ?? crypto.randomUUID(), startedAt: next.startedAt ?? new Date().toISOString(), order: next.order ?? order };
    current.current = normalized;
    setStorageFailed(!saveStandupSession(storageKey, normalized));
    setSession(normalized);
  }, [storageKey, generation, order]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (ownsRound) setStorageFailed(!saveStandupSession(storageKey, current.current));
  }, [ownsRound, storageKey]);

  useEffect(() => {
    if (!navigator.locks) return;
    const controller = new AbortController();
    let release: (() => void) | undefined;
    // The browser can grant the lock after this effect was cleaned up (React re-runs effects in development, and a
    // standup can be closed the moment it opens). An abort does nothing once the lock is granted, so the callback
    // must let go of it at once — otherwise the lock is held until the tab is refreshed and standup reports
    // "open in another tab" every time it is opened again.
    let cancelled = false;
    void navigator.locks.request(storageKey, { signal: controller.signal }, async () => {
      if (cancelled) return;
      try {
        const finished = JSON.parse(localStorage.getItem(`${storageKey}:finished`) ?? '[]') as string[];
        if (finished.includes(current.current.roundId)) {
          const fresh = { ...EMPTY_STANDUP_SESSION, roundId: crypto.randomUUID(), startedAt: new Date().toISOString(), order: initialOrder.current };
          current.current = fresh;
          setSession(fresh);
          saveStandupSession(storageKey, fresh);
        }
      } catch { setStorageFailed(true); }
      setOwnsRound(true);
      await new Promise<void>((resolve) => { release = resolve; });
    }).catch(() => undefined);
    return () => { cancelled = true; controller.abort(); release?.(); };
  }, [storageKey]);

  const clear = useCallback(() => {
    try {
      const key = `${storageKey}:finished`;
      const finished = JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
      localStorage.setItem(key, JSON.stringify([...finished, current.current.roundId].slice(-20)));
    } catch { setStorageFailed(true); }
    saveStandupSession(storageKey, EMPTY_STANDUP_SESSION);
    current.current = { ...EMPTY_STANDUP_SESSION, roundId: crypto.randomUUID(), startedAt: new Date().toISOString(), order };
  }, [storageKey, order]);

  return { session, dispatch, storageFailed, ownsRound, clear };
}