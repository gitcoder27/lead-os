/**
 * docs/53 U2: a session-local "N cleared" count. A row that was seen and is
 * now gone counts as cleared; if it comes back (failed write, un-snooze) it
 * stops counting. Keyed per day so tomorrow starts at zero.
 */
export interface TodayProgressState {
  seen: string[];
  cleared: string[];
}

export const EMPTY_TODAY_PROGRESS: TodayProgressState = { seen: [], cleared: [] };

export function nextTodayProgress(state: TodayProgressState, currentIds: string[]): TodayProgressState {
  const current = new Set(currentIds);
  const cleared = new Set(state.cleared);
  for (const id of state.seen) {
    if (!current.has(id)) cleared.add(id);
  }
  for (const id of current) cleared.delete(id);
  const seen = new Set([...state.seen, ...currentIds]);
  return { seen: [...seen], cleared: [...cleared] };
}

const storageKey = (scope: string, date: string) => `leados:today-progress:${scope}:${date}`;

export function readTodayProgress(scope: string, date: string): TodayProgressState {
  try {
    const raw = window.sessionStorage.getItem(storageKey(scope, date));
    const parsed = raw ? (JSON.parse(raw) as Partial<TodayProgressState>) : undefined;
    if (parsed && Array.isArray(parsed.seen) && Array.isArray(parsed.cleared)) {
      return { seen: parsed.seen.filter(isString), cleared: parsed.cleared.filter(isString) };
    }
  } catch {
    // Storage blocked or corrupt — progress is a convenience.
  }
  return EMPTY_TODAY_PROGRESS;
}

export function writeTodayProgress(scope: string, date: string, state: TodayProgressState): void {
  try {
    window.sessionStorage.setItem(storageKey(scope, date), JSON.stringify(state));
  } catch {
    // Ignore — see readTodayProgress.
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
