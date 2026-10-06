import { vi, describe, expect, it } from 'vitest';
import {
  appendProvenance,
  carryText,
  dropLine,
  hasProvenance,
  inferFromText,
  lineContent,
  mentionPattern,
  mentionsIn,
  parseListPrefix,
  searchTerms,
  snippetSegments,
  splitTitleAndContext,
  taskKeysIn,
  toggleCheckbox,
  wrapUpCandidates,
} from '@/lib/note-markdown';

const devs = [
  { accountId: 'a', displayName: 'Deepak Singh Bhainsora' },
  { accountId: 'b', displayName: 'Rohit Sharma' },
  { accountId: 'c', displayName: 'Rohan Mehta' },
];

describe('note-markdown', () => {
  it('parses list prefixes, including checkboxes and ordered items', () => {
    expect(parseListPrefix('- [ ] call')).toMatchObject({ checkbox: 'open', ordered: false, prefix: '- [ ] ' });
    expect(parseListPrefix('  * [x] done')).toMatchObject({ checkbox: 'done', indent: '  ' });
    expect(parseListPrefix('3. third')).toMatchObject({ ordered: true, checkbox: null });
    expect(parseListPrefix('plain text')).toBeNull();
  });

  it('toggles checkboxes in place', () => {
    expect(toggleCheckbox('- [ ] a')).toBe('- [x] a');
    expect(toggleCheckbox('  - [X] a')).toBe('  - [ ] a');
    expect(toggleCheckbox('- a')).toBeNull();
  });

  it('strips list syntax and markers from line content', () => {
    expect(lineContent('- [ ] chase vendor → T-84 ↩ from 2026-09-26')).toBe('chase vendor');
    expect(lineContent('## Risks')).toBe('Risks');
  });

  it('appends provenance idempotently and recognizes both marker kinds', () => {
    expect(appendProvenance('- call vendor  ', 'T-9')).toBe('- call vendor → T-9');
    expect(appendProvenance('- call vendor → T-9', 'T-9')).toBe('- call vendor → T-9');
    expect(hasProvenance('- a → T-9')).toBe(true);
    expect(hasProvenance('- a → 2026-09-28')).toBe(true);
    expect(hasProvenance('- a → later')).toBe(false);
  });

  it('splits captured text into a first-line title and remaining context', () => {
    expect(splitTitleAndContext('- [ ] Ship it → T-2\n  details here\n\nmore')).toEqual({
      title: 'Ship it',
      context: 'details here\nmore',
    });
    expect(splitTitleAndContext('')).toEqual({ title: '', context: '' });
  });

  it('matches @mentions by full name and by unique first name only', () => {
    const pattern = mentionPattern(devs)!;
    expect('ping @Deepak about it'.match(pattern)?.[0]).toBe('@Deepak');
    expect('ask @Deepak Singh Bhainsora'.match(pattern)?.[0]).toBe('@Deepak Singh Bhainsora');
    expect(mentionsIn('@Rohit and @Rohan', devs).map((dev) => dev.accountId)).toEqual(['b', 'c']);
    expect(mentionPattern([])).toBeNull();
  });

  it('infers one task, one person, one Jira key — and nothing when ambiguous', () => {
    expect(inferFromText('- tell @Rohit about T-12 and AM-44', devs)).toEqual({
      taskKey: 'T-12',
      developer: devs[1],
      jiraKey: 'AM-44',
    });
    expect(inferFromText('T-1 vs T-2 with @Rohit and @Rohan', devs)).toEqual({ taskKey: null, developer: null, jiraKey: null });
    // A provenance marker is not intent.
    expect(inferFromText('- chase vendor → T-84', devs).taskKey).toBeNull();
  });

  it('treats T-n as a task key, never a Jira key', () => {
    expect(taskKeysIn('t-3 and T-3 and AB-3')).toEqual(['T-3']);
    expect(inferFromText('T-3', devs).jiraKey).toBeNull();
  });

  it('collects wrap-up candidates: open checkboxes and action-like bullets only', () => {
    const body = [
      '# Today',
      '- [ ] call vendor',
      '- [x] done already',
      '- write RFC → T-9',
      '- review hiring loop',
      '- ask @Rohit about the rollout',
      '- T-12 slipped again',
      '- ~~dropped idea~~',
      'Prose about @Rohit is not an action.',
      '  - [ ] nested follow-up ↩ from 2026-09-26',
      '1. numbered thought',
      '- ',
    ].join('\n');
    expect(wrapUpCandidates(body, devs)).toEqual([
      { line: 1, raw: '- [ ] call vendor', text: 'call vendor', kind: 'checkbox' },
      { line: 5, raw: '- ask @Rohit about the rollout', text: 'ask @Rohit about the rollout', kind: 'item' },
      { line: 6, raw: '- T-12 slipped again', text: 'T-12 slipped again', kind: 'item' },
      { line: 9, raw: '  - [ ] nested follow-up ↩ from 2026-09-26', text: 'nested follow-up', kind: 'checkbox' },
    ]);
  });

  it('drops a line by striking its content and builds carried lines', () => {
    expect(dropLine('- [ ] call vendor')).toBe('- ~~call vendor~~');
    expect(dropLine('  * idea')).toBe('  * ~~idea~~');
    expect(carryText(['a', 'b'], '2026-09-27')).toBe('- [ ] a ↩ from 2026-09-27\n- [ ] b ↩ from 2026-09-27');
  });

  it('splits FTS snippets into highlighted segments', () => {
    expect(snippetSegments('…the ⟦vendor⟧ said ⟦late⟧')).toEqual([
      { text: '…the ', match: false },
      { text: 'vendor', match: true },
      { text: ' said ', match: false },
      { text: 'late', match: true },
    ]);
    expect(searchTerms('vendor, late!')).toEqual(['vendor', 'late']);
  });
});

it('P06 compiles one mention regex for a whole wrap-up analysis', () => {
  const original = RegExp;
  const constructor = vi.spyOn(globalThis, 'RegExp').mockImplementation(function (pattern, flags) { return new original(pattern, flags); } as typeof RegExp);
  const roster = [{ accountId: 'd1', displayName: 'Alice Smith' }];
  expect(wrapUpCandidates(Array.from({ length: 1000 }, () => '- Ask @Alice').join('\n'), roster)).toHaveLength(1000);
  expect(constructor.mock.calls.filter(([pattern]) => typeof pattern === 'string' && pattern.startsWith('@('))).toHaveLength(1);
  constructor.mockRestore();
});
