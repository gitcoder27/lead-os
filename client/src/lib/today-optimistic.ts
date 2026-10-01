import type { TodayActionTarget, TodayFocus, TodayFocusPerson, TodayStandupFocus } from '@/types';

/**
 * Optimistic patches for the stage `focus` block. The queue, promises and plan
 * are patched by `useTodayActions`; the wrap-up / midday / morning lists sit
 * under `focus` and used to linger until the next refetch, so a second click
 * could repeat a write that had already landed.
 */

const askedPerson = (person: TodayFocusPerson, accountId: string, askedAt: string): TodayFocusPerson => {
  if (person.accountId !== accountId) return person;
  const { primaryAction: _ask, ...rest } = person;
  return { ...rest, askedAt };
};

function mapStandup(standup: TodayStandupFocus | undefined, map: (people: TodayFocusPerson[]) => TodayFocusPerson[]) {
  return standup ? { ...standup, flagged: map(standup.flagged) } : standup;
}

/** Drop every list row aimed at `matches` from the stage block. */
export function focusWithout(focus: TodayFocus, matches: (target: TodayActionTarget) => boolean): TodayFocus {
  if ('wrapUp' in focus) {
    const { wrapUp } = focus;
    return {
      ...focus,
      wrapUp: {
        ...wrapUp,
        openPromises: wrapUp.openPromises.filter((item) => !matches(item.target)),
        carryCandidates: wrapUp.carryCandidates.filter((item) => !matches(item.target)),
      },
    };
  }
  if ('midday' in focus) {
    return {
      ...focus,
      midday: { ...focus.midday, dueSoon: focus.midday.dueSoon.filter((item) => !matches(item.target)) },
    };
  }
  return {
    ...focus,
    morning: { ...focus.morning, oneOnOnes: focus.morning.oneOnOnes.filter((item) => !matches(item.target)) },
  };
}

/** An "Ask for update" landed: the person shows as asked and loses the Ask button. */
export function focusWithAsk(focus: TodayFocus, accountId: string, askedAt: string): TodayFocus {
  const ask = (people: TodayFocusPerson[]) => people.map((person) => askedPerson(person, accountId, askedAt));
  if ('wrapUp' in focus) {
    return { ...focus, wrapUp: { ...focus.wrapUp, missingCheckIns: ask(focus.wrapUp.missingCheckIns) } };
  }
  if ('midday' in focus) {
    return {
      ...focus,
      midday: {
        ...focus.midday,
        standup: mapStandup(focus.midday.standup, ask),
        silentSinceStandup: ask(focus.midday.silentSinceStandup),
      },
    };
  }
  return { ...focus, morning: { ...focus.morning, standup: mapStandup(focus.morning.standup, ask) } };
}

/** A check-in / note landed for this person: they are no longer missing or quiet. */
export function focusWithCheckIn(focus: TodayFocus, accountId: string): TodayFocus {
  const keep = (person: TodayFocusPerson) => person.accountId !== accountId;
  if ('wrapUp' in focus) {
    return { ...focus, wrapUp: { ...focus.wrapUp, missingCheckIns: focus.wrapUp.missingCheckIns.filter(keep) } };
  }
  if ('midday' in focus) {
    return {
      ...focus,
      midday: { ...focus.midday, silentSinceStandup: focus.midday.silentSinceStandup.filter(keep) },
    };
  }
  return focus;
}
