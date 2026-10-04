import { describe, expect, it } from 'vitest';
import type { CapturePersonCandidate } from 'shared/capture-grammar';
import {
  applyTokenSuggestion,
  issueSuggestions,
  labelSuggestions,
  personSuggestions,
  readableAlias,
  tokenFragmentAt,
  wireText,
} from '@/lib/capture-typeahead';

const people: CapturePersonCandidate[] = [
  { accountId: 'acme-legal', displayName: 'Acme Legal', kind: 'contact', contactId: 7 },
  { accountId: 'dev-1', displayName: 'Alice Smith', kind: 'developer' },
  { accountId: '557058:ab-12', displayName: 'Jira Person', kind: 'developer' },
  { accountId: 'dev-2', displayName: 'Bob Jones', kind: 'developer' },
];

describe('tokenFragmentAt (docs/57 P3-05)', () => {
  it.each([
    ['Ask @al', 7, { trigger: '@', start: 4, fragment: 'al' }],
    ['@', 1, { trigger: '@', start: 0, fragment: '' }],
    ['See #LEAD-4', 11, { trigger: '#', start: 4, fragment: 'LEAD-4' }],
    ['Tag +urg', 8, { trigger: '+', start: 4, fragment: 'urg' }],
    ['Ping @557058:ab', 15, { trigger: '@', start: 5, fragment: '557058:ab' }],
    ['Ping @a.b_c-d', 13, { trigger: '@', start: 5, fragment: 'a.b_c-d' }],
  ])('%s', (text, caret, expected) => {
    expect(tokenFragmentAt(text, caret)).toEqual(expected);
  });

  it.each([
    ['mail bob@al', 11],
    ['no trigger here', 15],
    ['Ask @al then more', 17],
    ['C# is fine', 10],
  ])('is null for %s', (text, caret) => {
    expect(tokenFragmentAt(text, caret)).toBeNull();
  });

  it('only looks left of the caret', () => {
    expect(tokenFragmentAt('Ask @alice today', 7)).toEqual({ trigger: '@', start: 4, fragment: 'al' });
  });
});

describe('personSuggestions', () => {
  it('lists developers before contacts when nothing is typed', () => {
    expect(personSuggestions('', people).map((s) => s.insert)).toEqual(['Alice', 'Jira', 'Bob', 'acme-legal']);
    expect(personSuggestions('', people).map((s) => s.ref)).toEqual(['dev-1', '557058:ab-12', 'dev-2', 'acme-legal']);
  });

  it('matches names and ids, and marks contacts', () => {
    expect(personSuggestions('ac', people)).toEqual([expect.objectContaining({ insert: 'acme-legal', detail: 'Contact' })]);
    expect(personSuggestions('bo', people).map((s) => s.label)).toEqual(['Bob Jones']);
  });

  it('inserts a readable name and keeps a colon id as the ref, never in the text (UX-05)', () => {
    expect(personSuggestions('jir', people)[0]).toMatchObject({ insert: 'Jira', ref: '557058:ab-12', label: 'Jira Person' });
  });

  it('drops a fully typed alias so Enter can submit (UX-05)', () => {
    expect(personSuggestions('Bob', people)).toEqual([]);
  });

  it('drops a fully typed handle so Enter can submit', () => {
    expect(personSuggestions('dev-2', people)).toEqual([]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ accountId: `u-${index}`, displayName: `User ${index}`, kind: 'developer' as const }));
    expect(personSuggestions('', many)).toHaveLength(6);
  });
});

describe('labelSuggestions / issueSuggestions', () => {
  const names = ['urgent', 'escalation', 'category:follow_up', 'not-urgent'];

  it('ranks prefix matches before substring matches and skips an exact one', () => {
    expect(labelSuggestions('ur', names).map((s) => s.insert)).toEqual(['urgent', 'not-urgent']);
    expect(labelSuggestions('urgent', names).map((s) => s.insert)).toEqual(['not-urgent']);
  });

  it('turns issues into #KEY rows with the summary', () => {
    const rows = issueSuggestions([{ jiraKey: 'LEAD-1', summary: 'One' }, { jiraKey: 'LEAD-2', summary: 'Two' }], 'lead-2');
    expect(rows).toEqual([expect.objectContaining({ insert: 'LEAD-1', detail: 'One', trigger: '#' })]);
  });
});

describe('applyTokenSuggestion', () => {
  const suggestion = personSuggestions('al', people)[0]!;

  it('replaces the fragment, adds a space and puts the caret after it', () => {
    const text = 'Ask @al';
    expect(applyTokenSuggestion(text, 7, tokenFragmentAt(text, 7)!, suggestion)).toEqual({ text: 'Ask @Alice ', caret: 11 });
  });

  it('reuses a space that is already there', () => {
    const text = 'Ask @al about it';
    expect(applyTokenSuggestion(text, 7, tokenFragmentAt(text, 7)!, suggestion)).toEqual({ text: 'Ask @Alice about it', caret: 11 });
  });
});

describe('readableAlias / wireText (UX-05)', () => {
  const crowd: CapturePersonCandidate[] = [
    { accountId: 'manual:marcus-lee-ec28abd3', displayName: 'Marcus Lee', kind: 'developer' },
    { accountId: 'manual:marcus-chen-1', displayName: 'Marcus Chen', kind: 'developer' },
    { accountId: 'manual:tom-becker-81b9d6a0', displayName: 'Tom Becker', kind: 'developer' },
    { accountId: 'tom', displayName: 'Tom from Legal', kind: 'contact', contactId: 3 },
    { accountId: 'x:1', displayName: 'Sam Lee', kind: 'developer' },
    { accountId: 'x:2', displayName: 'Sam Lee', kind: 'developer' },
  ];

  it('uses the first name when it is unique, else the whole name, else the id', () => {
    expect(readableAlias(crowd[0]!, crowd)).toBe('MarcusLee');
    expect(readableAlias({ accountId: 'p', displayName: 'Priya Raman', kind: 'developer' }, [...crowd, { accountId: 'p', displayName: 'Priya Raman', kind: 'developer' }])).toBe('Priya');
    // "tom" is a contact handle, so the developer needs the full name.
    expect(readableAlias(crowd[2]!, crowd)).toBe('TomBecker');
    expect(readableAlias(crowd[3]!, crowd)).toBe('tom');
    expect(readableAlias(crowd[4]!, crowd)).toBe('x:1');
  });

  it('swaps remembered aliases for ids on the wire and leaves everything else alone', () => {
    const aliases = new Map([['marcuslee', 'manual:marcus-lee-ec28abd3'], ['tombecker', 'manual:tom-becker-81b9d6a0']]);
    expect(wireText('Ask @MarcusLee for ETA /w @TomBecker !fri', aliases)).toBe('Ask @manual:marcus-lee-ec28abd3 for ETA /w @manual:tom-becker-81b9d6a0 !fri');
    expect(wireText('mail me@MarcusLee and @MarcusLeeX', aliases)).toBe('mail me@MarcusLee and @MarcusLeeX');
    expect(wireText('@marcuslee', aliases)).toBe('@manual:marcus-lee-ec28abd3');
  });
});
