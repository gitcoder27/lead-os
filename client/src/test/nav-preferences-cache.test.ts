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
  moreNav: [],
  hidden: [],
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
    // The retired Meetings page is dropped; unseen pages are appended to More.
    expect(prefs?.moreNav).toEqual(['work', 'team', 'desk']);
    expect(prefs?.hidden).toEqual([]);
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

  it('round-trips hidden pages, and drops bad ones from a cached value', () => {
    const withHidden: NavPreferences = { topNav: ['notes', 'desk'], moreNav: [], hidden: ['work', 'team'] };
    writeNavPreferencesCache(SCOPE, withHidden);
    expect(readNavPreferencesCache(SCOPE)).toEqual(withHidden);

    window.localStorage.setItem(key(SCOPE), JSON.stringify({ topNav: ['desk'], moreNav: ['notes'], hidden: ['work', 'bogus', 'meetings', 'desk'] }));
    expect(readNavPreferencesCache(SCOPE)).toEqual({ topNav: ['desk'], moreNav: ['notes', 'team'], hidden: ['work'] });
  });

  it('reads a value cached before hidden pages existed', () => {
    window.localStorage.setItem(key(SCOPE), JSON.stringify({ topNav: ['work', 'team', 'desk'], moreNav: ['notes', 'follow-ups'] }));
    expect(readNavPreferencesCache(SCOPE)).toEqual({ topNav: ['work', 'team', 'desk'], moreNav: ['notes'], hidden: [] });
  });

  it('reads the cache under the Phase 3 name for Desk', () => {
    window.localStorage.setItem(key(SCOPE), JSON.stringify({ topNav: ['desk'], moreNav: [], hidden: ['team'] }));
    expect(readNavPreferencesCache(SCOPE, { tasksNav: true })).toEqual({ topNav: ['tasks'], moreNav: ['work', 'notes'], hidden: ['team'] });
  });
});
