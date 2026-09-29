import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAV_PREFERENCES,
  NAV_PAGE_IDS,
  NAV_PAGE_IDS_TASKS,
  isCompleteNavPreferences,
  sanitizeNavPreferences,
} from 'shared/types';

/** docs/56 P2-04 / docs/57 P3-06: the shared partition rules the server and the client both run. */
describe('nav preference defaults', () => {
  it('put every page in the top navigation as Tasks | Team | Work | Notes, nothing hidden', () => {
    expect(DEFAULT_NAV_PREFERENCES).toEqual({ topNav: ['desk', 'team', 'work', 'notes'], moreNav: [], hidden: [] });
    expect([...DEFAULT_NAV_PREFERENCES.topNav].sort()).toEqual([...NAV_PAGE_IDS].sort());
  });

  it('read under the Phase 3 name for Desk', () => {
    expect(sanitizeNavPreferences(DEFAULT_NAV_PREFERENCES.topNav, DEFAULT_NAV_PREFERENCES.moreNav, { tasksNav: true, hidden: [] }))
      .toEqual({ topNav: ['tasks', 'team', 'work', 'notes'], moreNav: [], hidden: [] });
    expect([...NAV_PAGE_IDS_TASKS].sort()).toEqual(['notes', 'tasks', 'team', 'work']);
  });
});

describe('sanitizeNavPreferences', () => {
  it('keeps the three zones and their order', () => {
    expect(sanitizeNavPreferences(['notes', 'desk'], ['work'], { hidden: ['team'] })).toEqual({ topNav: ['notes', 'desk'], moreNav: ['work'], hidden: ['team'] });
  });

  it('the first zone wins when a page is listed twice', () => {
    expect(sanitizeNavPreferences(['desk'], ['desk', 'team'], { hidden: ['team', 'desk', 'work'] })).toEqual({ topNav: ['desk'], moreNav: ['team', 'notes'], hidden: ['work'] });
  });

  it('appends never-seen pages to More, so nothing is lost and nothing is silently hidden', () => {
    expect(sanitizeNavPreferences([], [], { hidden: [] })).toEqual({ topNav: [], moreNav: [...NAV_PAGE_IDS], hidden: [] });
  });

  it.each([undefined, null, 'desk', 7, { a: 1 }])('treats %j as an empty list', (value) => {
    expect(sanitizeNavPreferences(['desk', 'team', 'work', 'notes'], value, { hidden: value })).toEqual({ topNav: ['desk', 'team', 'work', 'notes'], moreNav: [], hidden: [] });
  });

  it('drops unknown and retired ids, including from Hidden', () => {
    expect(sanitizeNavPreferences(['follow-ups', 'desk', 42, 'settings'], ['meetings', 'team'], { hidden: ['bogus', 'work'] }))
      .toEqual({ topNav: ['desk'], moreNav: ['team', 'notes'], hidden: ['work'] });
  });
});

describe('isCompleteNavPreferences', () => {
  it('accepts a full partition with or without hidden', () => {
    expect(isCompleteNavPreferences({ topNav: ['desk', 'team'], moreNav: ['work'], hidden: ['notes'] })).toBe(true);
    expect(isCompleteNavPreferences({ topNav: ['desk', 'team', 'work', 'notes'], moreNav: [] })).toBe(true);
  });

  it('counts a page in Hidden as placed, and rejects a duplicate or a gap', () => {
    expect(isCompleteNavPreferences({ topNav: ['desk', 'team', 'work'], moreNav: [], hidden: ['notes', 'work'] })).toBe(false);
    expect(isCompleteNavPreferences({ topNav: ['desk', 'team'], moreNav: [], hidden: ['notes'] })).toBe(false);
  });

  it('ignores retired pages instead of counting them', () => {
    expect(isCompleteNavPreferences({ topNav: ['desk', 'follow-ups', 'team'], moreNav: ['work', 'notes', 'meetings'], hidden: [] })).toBe(true);
    expect(isCompleteNavPreferences({ topNav: ['desk', 'follow-ups'], moreNav: ['meetings'], hidden: ['notes'] })).toBe(false);
  });

  it('accepts either name for Desk, per the flag', () => {
    expect(isCompleteNavPreferences({ topNav: ['desk', 'team', 'work', 'notes'], moreNav: [] }, { tasksNav: true })).toBe(true);
    expect(isCompleteNavPreferences({ topNav: ['tasks', 'team', 'work', 'notes'], moreNav: [] }, { tasksNav: false })).toBe(true);
  });

  it.each([null, undefined, 'x', [], { topNav: 'desk', moreNav: [] }, { topNav: [], moreNav: [], hidden: 'work' }])('rejects %j', (value) => {
    expect(isCompleteNavPreferences(value)).toBe(false);
  });
});
