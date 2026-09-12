import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearNavPreferencesCacheForScope,
  readNavPreferencesCache,
  writeNavPreferencesCache,
} from '@/lib/nav-preferences-cache';
import type { NavPreferences } from '@/types';

const SCOPE = 'ws-1:manager-a:manager:';
const OTHER_SCOPE = 'ws-1:manager-b:manager:';

const CUSTOM: NavPreferences = {
  topNav: ['notes', 'desk', 'work', 'team'],
  moreNav: ['follow-ups', 'meetings'],
};

function key(scope: string): string {
  return `lead-os:nav-preferences:${encodeURIComponent(scope)}`;
}

describe('nav preferences cache', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns null when nothing is cached', () => {
    expect(readNavPreferencesCache(SCOPE)).toBeNull();
  });

  it('round-trips a scoped preference', () => {
    expect(writeNavPreferencesCache(SCOPE, CUSTOM)).toBe(true);
    expect(readNavPreferencesCache(SCOPE)).toEqual(CUSTOM);
  });

  it('keeps preferences isolated by scope', () => {
    writeNavPreferencesCache(SCOPE, CUSTOM);
    expect(readNavPreferencesCache(OTHER_SCOPE)).toBeNull();
  });

  it('clears only the requested scope', () => {
    writeNavPreferencesCache(SCOPE, CUSTOM);
    writeNavPreferencesCache(OTHER_SCOPE, CUSTOM);
    clearNavPreferencesCacheForScope(SCOPE);
    expect(readNavPreferencesCache(SCOPE)).toBeNull();
    expect(readNavPreferencesCache(OTHER_SCOPE)).toEqual(CUSTOM);
  });

  it('sanitizes stored values instead of trusting them', () => {
    window.localStorage.setItem(
      key(SCOPE),
      JSON.stringify({ topNav: ['notes', 'bogus-page'], moreNav: ['meetings'] })
    );
    const prefs = readNavPreferencesCache(SCOPE);
    expect(prefs?.topNav).toEqual(['notes']);
    expect(prefs?.moreNav).toEqual(['meetings', 'work', 'team', 'desk', 'follow-ups']);
  });

  it('discards malformed JSON', () => {
    window.localStorage.setItem(key(SCOPE), 'not json');
    expect(readNavPreferencesCache(SCOPE)).toBeNull();
    expect(window.localStorage.getItem(key(SCOPE))).toBeNull();
  });

  it('rejects empty or non-object writes without throwing', () => {
    expect(writeNavPreferencesCache('', CUSTOM)).toBe(false);
    expect(readNavPreferencesCache('')).toBeNull();
  });
});
