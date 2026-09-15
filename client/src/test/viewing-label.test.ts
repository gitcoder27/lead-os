import { describe, expect, it } from 'vitest';
import { viewingLabel } from '@/components/assistant/viewing-label';

describe('viewingLabel', () => {
  it('maps canonical and legacy paths to friendly names', () => {
    expect(viewingLabel('/', '')).toBe('Today');
    expect(viewingLabel('/today', '')).toBe('Today');
    expect(viewingLabel('/work', '')).toBe('Work');
    expect(viewingLabel('/dashboard', '')).toBe('Work');
    expect(viewingLabel('/manager-desk', '')).toBe('Desk');
    expect(viewingLabel('/followups', '')).toBe('Follow-ups');
    expect(viewingLabel('/my-day', '')).toBe('My Day');
    expect(viewingLabel('/work/', '')).toBe('Work');
  });

  it('falls back to the raw path for unknown routes', () => {
    expect(viewingLabel('/nope', '')).toBe('/nope');
  });

  it('appends the active allowlisted params', () => {
    expect(viewingLabel('/desk', '?date=2026-09-14')).toBe('Desk · date=2026-09-14');
    expect(viewingLabel('/work', '?filter=overdue&dev=dev-3')).toBe('Work · filter=overdue · dev=dev-3');
    expect(viewingLabel('/team', '?q=alice&group=status')).toBe('Team · q=alice · group=status');
  });

  it('renders flag params without a value and skips non-allowlisted params', () => {
    expect(viewingLabel('/work', '?noTags=1&foo=bar')).toBe('Work · noTags');
  });
});
