import { describe, expect, it } from 'vitest';
import { authorLabel, friendlyEventValue, plainExcerpt } from '@/components/tasks/TaskTimeline';
import type { TaskEvent } from '@/types';

describe('activity copy (docs/73 UXD-14)', () => {
  it('reads dates the manager way, never ISO', () => {
    expect(friendlyEventValue('2026-10-10')).toBe('Sat 10 Oct');
    expect(friendlyEventValue('2026-10-10T09:30:00')).toBe('Sat 10 Oct, 09:30');
    expect(friendlyEventValue('Marcus Lee')).toBe('Marcus Lee');
  });

  it('strips list, checkbox and heading syntax from stored note excerpts', () => {
    expect(plainExcerpt('turday catch-up\n\n- [ ] Ask Tom about Redis 7 (T-26)\n- **Note** here')).toBe('turday catch-up · Ask Tom about Redis 7 (T-26) · Note here');
    expect(plainExcerpt('## Heading')).toBe('Heading');
  });
});

describe('activity authors (docs/73 UXD-14)', () => {
  const event = (type: string, author: { type: string; id?: string }) => ({ type, author } as unknown as TaskEvent);
  it('never says "System (id)"', () => {
    expect(authorLabel(event('note_ref', { type: 'system', id: 'maya' }), 'maya')).toBe('From your note');
    expect(authorLabel(event('created', { type: 'system', id: 'maya' }), 'maya')).toBe('You');
    expect(authorLabel(event('created', { type: 'system', id: 'job' }), 'maya')).toBe('LeadOS');
  });
});
