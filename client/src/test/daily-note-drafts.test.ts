import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDailyNoteCaptureDraft,
  clearDailyNoteDraft,
  clearDailyNoteDraftsForScope,
  readDailyNoteCaptureDraft,
  readDailyNoteDraft,
  writeDailyNoteCaptureDraft,
  writeDailyNoteDraft,
} from '@/lib/daily-note-drafts';

const SCOPE = 'ws-1:manager-a:manager:';
const OTHER_SCOPE = 'ws-1:manager-b:manager:';
const DATE = '2026-04-28';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID_2 = '22222222-2222-4222-8222-222222222222';

describe('daily-note drafts', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('round-trips a scoped draft', () => {
    const draft = { body: 'draft body', baseBody: 'saved body', revision: 3 };
    expect(writeDailyNoteDraft(SCOPE, DATE, draft)).toBe(true);
    expect(readDailyNoteDraft(SCOPE, DATE)).toEqual(draft);
  });

  it('returns null when no draft exists', () => {
    expect(readDailyNoteDraft(SCOPE, DATE)).toBeNull();
  });

  it('keeps drafts isolated by scope and date', () => {
    writeDailyNoteDraft(SCOPE, DATE, { body: 'a', baseBody: '', revision: 0 });
    writeDailyNoteDraft(OTHER_SCOPE, DATE, { body: 'b', baseBody: '', revision: 0 });
    writeDailyNoteDraft(SCOPE, '2026-04-29', { body: 'c', baseBody: '', revision: 0 });

    expect(readDailyNoteDraft(SCOPE, DATE)?.body).toBe('a');
    expect(readDailyNoteDraft(OTHER_SCOPE, DATE)?.body).toBe('b');
    expect(readDailyNoteDraft(SCOPE, '2026-04-29')?.body).toBe('c');
  });

  it('discards malformed stored values', () => {
    const key = `lead-os:daily-note-draft:${encodeURIComponent(SCOPE)}:${DATE}`;
    window.sessionStorage.setItem(key, '{"body":123}');
    expect(readDailyNoteDraft(SCOPE, DATE)).toBeNull();
    expect(window.sessionStorage.getItem(key)).toBeNull();

    window.sessionStorage.setItem(key, 'not json');
    expect(readDailyNoteDraft(SCOPE, DATE)).toBeNull();
  });

  it('clears a single draft', () => {
    writeDailyNoteDraft(SCOPE, DATE, { body: 'a', baseBody: '', revision: 0 });
    clearDailyNoteDraft(SCOPE, DATE);
    expect(readDailyNoteDraft(SCOPE, DATE)).toBeNull();
  });

  it('clears all drafts and the capture draft for a scope only', () => {
    writeDailyNoteDraft(SCOPE, DATE, { body: 'a', baseBody: '', revision: 0 });
    writeDailyNoteDraft(SCOPE, '2026-04-29', { body: 'b', baseBody: '', revision: 0 });
    writeDailyNoteCaptureDraft(SCOPE, { date: DATE, text: 'capture', requestId: REQUEST_ID });
    writeDailyNoteDraft(OTHER_SCOPE, DATE, { body: 'other', baseBody: '', revision: 0 });

    clearDailyNoteDraftsForScope(SCOPE);

    expect(readDailyNoteDraft(SCOPE, DATE)).toBeNull();
    expect(readDailyNoteDraft(SCOPE, '2026-04-29')).toBeNull();
    expect(readDailyNoteCaptureDraft(SCOPE)).toBeNull();
    expect(readDailyNoteDraft(OTHER_SCOPE, DATE)?.body).toBe('other');
  });

  it('round-trips a quick capture draft', () => {
    const draft = { date: DATE, text: 'remember this', requestId: REQUEST_ID_2 };
    expect(writeDailyNoteCaptureDraft(SCOPE, draft)).toBe(true);
    expect(readDailyNoteCaptureDraft(SCOPE)).toEqual(draft);
    clearDailyNoteCaptureDraft(SCOPE);
    expect(readDailyNoteCaptureDraft(SCOPE)).toBeNull();
  });

  it('rejects capture drafts with an invalid date or request id', () => {
    const key = `lead-os:daily-note-draft:${encodeURIComponent(SCOPE)}:quick-capture`;

    window.sessionStorage.setItem(key, JSON.stringify({ date: 'yesterday', text: 'x', requestId: REQUEST_ID }));
    expect(readDailyNoteCaptureDraft(SCOPE)).toBeNull();
    expect(window.sessionStorage.getItem(key)).toBeNull();

    window.sessionStorage.setItem(key, JSON.stringify({ date: DATE, text: 'x', requestId: 'r-1' }));
    expect(readDailyNoteCaptureDraft(SCOPE)).toBeNull();
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });

  it('expires drafts older than 14 days', () => {
    const key = `lead-os:daily-note-draft:${encodeURIComponent(SCOPE)}:${DATE}`;
    const stale = {
      body: 'old draft',
      baseBody: 'base',
      revision: 2,
      savedAt: Date.now() - 15 * 24 * 60 * 60 * 1000,
    };
    window.localStorage.setItem(key, JSON.stringify(stale));
    expect(readDailyNoteDraft(SCOPE, DATE)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('keeps fresh drafts and updates their timestamp on write', () => {
    const key = `lead-os:daily-note-draft:${encodeURIComponent(SCOPE)}:${DATE}`;
    const recent = {
      body: 'fresh draft',
      baseBody: 'base',
      revision: 2,
      savedAt: Date.now() - 13 * 24 * 60 * 60 * 1000,
    };
    window.localStorage.setItem(key, JSON.stringify(recent));
    expect(readDailyNoteDraft(SCOPE, DATE)?.body).toBe('fresh draft');
  });

  it('caps stored daily-note drafts per scope, evicting oldest first', () => {
    const prefix = `lead-os:daily-note-draft:${encodeURIComponent(SCOPE)}:`;
    const now = Date.now();
    for (let i = 0; i < 55; i += 1) {
      window.localStorage.setItem(
        `${prefix}2026-03-${String(i + 1).padStart(2, '0')}`,
        // fresh entries, oldest first by a minute
        JSON.stringify({ body: `d${i}`, baseBody: '', revision: 0, savedAt: now - (55 - i) * 60_000 }),
      );
    }
    expect(writeDailyNoteDraft(SCOPE, DATE, { body: 'newest', baseBody: '', revision: 0 })).toBe(true);

    let surviving = 0;
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix) && !key.endsWith('quick-capture')) {
        surviving += 1;
      }
    }
    expect(surviving).toBe(50);
    // oldest entries evicted; the freshly written draft survives
    expect(readDailyNoteDraft(SCOPE, '2026-03-01')).toBeNull();
    expect(readDailyNoteDraft(SCOPE, '2026-03-02')).toBeNull();
    expect(readDailyNoteDraft(SCOPE, DATE)?.body).toBe('newest');
    expect(readDailyNoteDraft(SCOPE, '2026-03-55')?.body).toBe('d54');
  });

  it('migrates a legacy sessionStorage draft into localStorage', () => {
    const key = `lead-os:daily-note-draft:${encodeURIComponent(SCOPE)}:${DATE}`;
    const legacy = { body: 'session draft', baseBody: 'base', revision: 4 };
    window.sessionStorage.setItem(key, JSON.stringify(legacy));

    expect(readDailyNoteDraft(SCOPE, DATE)).toEqual(legacy);
    expect(window.sessionStorage.getItem(key)).toBeNull();
    const migrated = JSON.parse(window.localStorage.getItem(key)!);
    expect(migrated.body).toBe('session draft');
    expect(typeof migrated.savedAt).toBe('number');
  });

  it('migrates a legacy sessionStorage capture draft', () => {
    const key = `lead-os:daily-note-draft:${encodeURIComponent(SCOPE)}:quick-capture`;
    const legacy = { date: DATE, text: 'remember', requestId: REQUEST_ID };
    window.sessionStorage.setItem(key, JSON.stringify(legacy));

    expect(readDailyNoteCaptureDraft(SCOPE)).toEqual(legacy);
    expect(window.sessionStorage.getItem(key)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(key)!).text).toBe('remember');
  });

  it('reports failure when storage is unavailable', () => {
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(writeDailyNoteDraft(SCOPE, DATE, { body: 'a', baseBody: '', revision: 0 })).toBe(false);
    expect(writeDailyNoteCaptureDraft(SCOPE, { date: DATE, text: 'x', requestId: REQUEST_ID })).toBe(false);
    setSpy.mockRestore();

    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readDailyNoteDraft(SCOPE, DATE)).toBeNull();
    getSpy.mockRestore();
  });
});
