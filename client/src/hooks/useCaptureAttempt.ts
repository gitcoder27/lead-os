import { useEffect, useRef, useState } from 'react';
import { useAuthScopeKey } from '@/context/AuthContext';
import { getLocalIsoDate, getLocalTimeZone } from '@/lib/utils';
import type { CreateViaCapture } from './useCapture';

/** One form's uncertain submission, including its original relative-date context. */
export function useCaptureAttempt(input: Pick<CreateViaCapture, 'text' | 'defaults'>) {
  const scope = useAuthScopeKey();
  const fingerprint = JSON.stringify([scope, input]);
  const current = useRef(fingerprint);
  const attempt = useRef<CreateViaCapture | null>(null);
  const generation = useRef(0);
  const flight = useRef<object | null>(null);
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);
  if (current.current !== fingerprint) {
    const prior = attempt.current;
    // A Today form's derived date can advance while its failed draft stays open.
    // Keep that uncertain attempt; intentional context changes still renew it.
    const clockAdvanced = prior && prior.clientToday !== getLocalIsoDate()
      && prior.defaults?.scheduledOn === prior.clientToday
      && input.defaults?.scheduledOn === getLocalIsoDate()
      && JSON.stringify([scope, { ...input, defaults: { ...input.defaults, scheduledOn: prior.defaults?.scheduledOn } }]) === current.current;
    generation.current += 1;
    current.current = fingerprint;
    if (!clockAdvanced) attempt.current = null;
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = async <T,>(submit: (body: CreateViaCapture) => Promise<T>): Promise<T | undefined> => {
    // A ref also guards two submissions before React can render the pending state.
    if (flight.current) return undefined;
    const token = {};
    flight.current = token;
    setPending(true);
    const submittedGeneration = generation.current;
    try {
      attempt.current ??= { ...structuredClone(input), requestId: crypto.randomUUID(), clientToday: getLocalIsoDate(), tz: getLocalTimeZone() };
      const body = attempt.current;
      const result = await submit(body);
      if (!mounted.current || generation.current !== submittedGeneration) return undefined;
      if (result !== false) attempt.current = null;
      return result;
    } finally {
      if (flight.current === token) {
        flight.current = null;
        if (mounted.current) setPending(false);
      }
    }
  };
  return { run, isPending: pending };
}
