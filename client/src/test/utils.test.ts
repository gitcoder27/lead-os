import { describe, it, expect, vi } from 'vitest';
import {
  formatAbsoluteDateTime,
  formatDate,
  getLocalIsoDate,
  isDueToday,
  isLaterTodayAvailable,
  isOverdue,
  shiftLocalIsoDate,
} from '@/lib/utils';
import { snoozePresets } from '@/components/today/TodayActionMenu';

describe('isOverdue', () => {
  it('returns true for past date', () => {
    expect(isOverdue('2020-01-01')).toBe(true);
  });

  it('returns false for undefined', () => {
    expect(isOverdue(undefined)).toBe(false);
  });
});

describe('isDueToday', () => {
  it('returns true for today', () => {
    const today = getLocalIsoDate();
    expect(isDueToday(today)).toBe(true);
  });

  it('returns false for undefined', () => {
    expect(isDueToday(undefined)).toBe(false);
  });
});

describe('local date helpers', () => {
  it('formats today using local calendar date', () => {
    expect(getLocalIsoDate(new Date('2026-03-10T01:30:00-05:00'))).toBe('2026-03-10');
  });

  it('shifts local iso dates without UTC rollover issues', () => {
    expect(shiftLocalIsoDate('2026-03-10', -1)).toBe('2026-03-09');
    expect(shiftLocalIsoDate('2026-03-10', 1)).toBe('2026-03-11');
  });
});

describe('formatDate', () => {
  it('formats date string', () => {
    const result = formatDate('2026-03-05');
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/5/);
  });

  it('returns dash for undefined', () => {
    expect(formatDate(undefined)).toBe('—');
  });
});

describe('formatAbsoluteDateTime', () => {
  it('formats timestamp into a readable local datetime', () => {
    const result = formatAbsoluteDateTime('2026-03-05T15:30:00.000Z');
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/2026/);
    expect(result).toMatch(/(AM|PM)/);
  });

  it('returns dash for undefined or invalid values', () => {
    expect(formatAbsoluteDateTime(undefined)).toBe('—');
    expect(formatAbsoluteDateTime('not-a-date')).toBe('—');
  });
});

describe('docs/53 F1: snooze preset availability', () => {
  it('offers Later today before 18:00 local', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 2, 8, 9, 30));
      expect(isLaterTodayAvailable()).toBe(true);
      expect(snoozePresets().map(([id]) => id)).toEqual(['later_today', 'tomorrow', 'next_week']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides Later today at 18:00 and later', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 2, 8, 18, 0));
      expect(isLaterTodayAvailable()).toBe(false);
      expect(snoozePresets().map(([id]) => id)).toEqual(['tomorrow', 'next_week']);

      vi.setSystemTime(new Date(2026, 2, 8, 22, 15));
      expect(isLaterTodayAvailable()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
