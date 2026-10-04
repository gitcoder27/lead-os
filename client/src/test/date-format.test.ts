import { describe, expect, it } from 'vitest';
import { formatDay, formatDayTime, formatDayWithRelative } from '@/lib/date-format';

describe('shared date format (UX-17)', () => {
  it('formats a moment as "Sat 3 Oct, 10:00", adding the year only when it differs', () => {
    const now = new Date('2026-10-04T12:00:00');
    expect(formatDayTime(new Date('2026-10-03T10:00:00').toISOString(), now)).toBe('Sat 3 Oct, 10:00');
    expect(formatDayTime(new Date('2027-01-01T09:30:00').toISOString(), now)).toBe('Fri 1 Jan 2027, 09:30');
    expect(formatDayTime(null, now)).toBe('');
  });

  it('formats a plan date as "Mon 5 Oct", with today/tomorrow/yesterday when near', () => {
    expect(formatDay('2026-10-05', '2026-10-04')).toBe('Mon 5 Oct');
    expect(formatDayWithRelative('2026-10-05', '2026-10-04')).toBe('Mon 5 Oct · tomorrow');
    expect(formatDayWithRelative('2026-10-04', '2026-10-04')).toBe('Sun 4 Oct · today');
    expect(formatDayWithRelative('2026-10-03', '2026-10-04')).toBe('Sat 3 Oct · yesterday');
    expect(formatDayWithRelative('2026-10-08', '2026-10-04')).toBe('Thu 8 Oct');
    expect(formatDay('2027-01-01', '2026-10-04')).toBe('Fri 1 Jan 2027');
  });
});
