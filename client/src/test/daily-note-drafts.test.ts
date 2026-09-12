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
