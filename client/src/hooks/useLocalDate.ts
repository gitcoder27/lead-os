import { useEffect, useState } from 'react';
import { getLocalIsoDate } from '@/lib/utils';

/**
 * docs/49 R6: the local calendar date, recomputed at local midnight and
 * whenever the tab regains visibility/focus (timers stall while asleep).
 */
export function useLocalDate(): string {
  const [date, setDate] = useState(() => getLocalIsoDate());

  useEffect(() => {
    const refresh = () => setDate((current) => {
      const next = getLocalIsoDate();
      return next === current ? current : next;
    });
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    const timer = window.setTimeout(refresh, midnight.getTime() - now.getTime());
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
  }, [date]);

  return date;
}
