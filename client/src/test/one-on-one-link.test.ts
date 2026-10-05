import { describe, expect, it } from 'vitest';
import { oneOnOneHref, oneOnOnePerson } from '@/lib/one-on-one-link';

const roster = [
  { accountId: 'manual:priya-1', displayName: 'Priya Raman' },
  { accountId: 'manual:marcus-1', displayName: 'Marcus Lee' },
  { accountId: 'manual:marcus-2', displayName: 'Marcus Chen' },
];
const meeting = (title: string, links: { kind: string; ref: string }[] = []) => ({ kind: 'meeting' as const, title, links: links as never });

describe('1:1 meeting tasks bridge to the 1:1 workspace (UX-35)', () => {
  it('finds the person from the title or a person link', () => {
    expect(oneOnOnePerson(meeting('1:1 with Priya'), roster)?.accountId).toBe('manual:priya-1');
    expect(oneOnOnePerson(meeting('One-on-one: Priya Raman'), roster)?.accountId).toBe('manual:priya-1');
    expect(oneOnOnePerson(meeting('1-1 sync', [{ kind: 'person', ref: 'manual:marcus-2' }]), roster)?.accountId).toBe('manual:marcus-2');
  });

  it('stays out of the way when it cannot be sure', () => {
    expect(oneOnOnePerson(meeting('1:1 with Marcus'), roster)).toBeNull();
    expect(oneOnOnePerson(meeting('Architecture sync with Priya'), roster)).toBeNull();
    expect(oneOnOnePerson({ kind: 'task', title: '1:1 with Priya', links: [] }, roster)).toBeNull();
    expect(oneOnOnePerson(meeting('Q1:11 review with Priya'), roster)).toBeNull();
  });

  it('links to the person\'s 1:1 workspace', () => {
    expect(oneOnOneHref('manual:priya-1')).toBe('/team?dev=manual%3Apriya-1&panel=one-on-one');
  });
});
