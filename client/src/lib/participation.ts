import type { TeamMode } from '@/types';

/**
 * docs/56 Decisions #1: a developer-participation signal (check-in freshness,
 * "Add check-in") applies only when `mode === 'collab' && participates`. For
 * everyone else the manager's own activity is the clock, so the UI says
 * "note" and "last touched". The server owns the signals; this only picks
 * the wording, so it must stay the same one-line rule.
 */
export function usesCheckIns(mode: TeamMode, participates: boolean | undefined): boolean {
  return mode === 'collab' && participates === true;
}
