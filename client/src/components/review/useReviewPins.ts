import { useCallback, useRef, useState } from 'react';
import { useTodayTop3 } from '@/hooks/useTodayTop3';
import { TODAY_TOP_LIMIT } from '@/types';
import type { WeeklyReviewPin, WeeklyReviewResponse } from '@/types';

/**
 * docs/59 §5.3 step 5: the next workday's top 3. Held for the whole session (the step unmounts when
 * the manager moves on, but the pins are theirs); every change writes the full list through
 * `PUT /api/today/top3` with that day's date, and a failed write puts the list back.
 */
export function useReviewPins(review: WeeklyReviewResponse, announce: (message: string) => void) {
  const write = useTodayTop3();
  const [pins, setPins] = useState<WeeklyReviewPin[]>(() => review.nextWorkdayTop3 ?? []);
  const current = useRef(pins);
  current.current = pins;

  const commit = useCallback((next: WeeklyReviewPin[], message: string) => {
    const previous = current.current;
    current.current = next;
    setPins(next);
    announce(message);
    void write
      .mutateAsync({ date: review.nextWorkday, taskKeys: next.map((pin) => pin.taskKey) })
      .catch(() => {
        // The write hook already raised the persistent error toast.
        current.current = previous;
        setPins(previous);
        announce("Couldn't save that. Your top 3 is unchanged.");
      });
  }, [announce, review.nextWorkday, write]);

  const pin = useCallback((taskKey: string, title: string): boolean => {
    const list = current.current;
    if (list.some((entry) => entry.taskKey === taskKey)) return true;
    if (list.length >= TODAY_TOP_LIMIT) {
      announce(`Your top ${TODAY_TOP_LIMIT} is full. Remove one first.`);
      return false;
    }
    commit([...list, { taskKey, title }], `Picked. ${list.length + 1} of ${TODAY_TOP_LIMIT}.`);
    return true;
  }, [announce, commit]);

  const unpin = useCallback((taskKey: string) => {
    const list = current.current;
    if (!list.some((entry) => entry.taskKey === taskKey)) return;
    commit(list.filter((entry) => entry.taskKey !== taskKey), `Removed. ${list.length - 1} of ${TODAY_TOP_LIMIT}.`);
  }, [commit]);

  return { pins, pin, unpin };
}
