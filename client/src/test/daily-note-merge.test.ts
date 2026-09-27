import { describe, expect, it } from 'vitest';
import { conflictHunks, mergeNoteBodies } from '@/lib/daily-note-merge';

describe('mergeNoteBodies', () => {
  it('returns the local body unchanged when remote equals base', () => {
    const outcome = mergeNoteBodies('shared', 'shared\nlocal edits', 'shared');
    expect(outcome).toEqual({ merged: 'shared\nlocal edits', clean: true, remoteWasAppend: false });
  });

  it('returns the remote body when local equals base', () => {
    const outcome = mergeNoteBodies('shared', 'shared', 'shared\nremote edits');
    expect(outcome).toEqual({ merged: 'shared\nremote edits', clean: true, remoteWasAppend: true });
  });

  it('splices a pure remote append onto the dirty draft', () => {
    const outcome = mergeNoteBodies(
      'morning notes',
      'morning notes\n\nlocal typing',
      'morning notes\n\nstandup summary',
    );
    expect(outcome).toEqual({
      merged: 'morning notes\n\nlocal typing\n\nstandup summary',
      clean: true,
      remoteWasAppend: true,
    });
  });

  it('splices a pure local append onto the remote body', () => {
    const outcome = mergeNoteBodies('base', 'base\n\nlocal tail', 'rewritten\nremote');
    expect(outcome).toEqual({ merged: 'rewritten\nremote\n\nlocal tail', clean: true, remoteWasAppend: false });
  });

  it('does not treat a shared word prefix as an append', () => {
    // remote begins with base's characters but not at a line boundary — not an append
    const outcome = mergeNoteBodies('base', 'baseball notes', 'baseball scores');
    expect(outcome.clean).toBe(false);
    expect(outcome.remoteWasAppend).toBe(false);
  });

  it('merges disjoint line edits cleanly without duplicating the shared base', () => {
    // F2 regression: both sides derive from the same base — keep-both must not
    // contain the shared lines twice.
    const outcome = mergeNoteBodies(
      'shared one\nshared two\nshared three',
      'local one\nshared two\nshared three',
      'shared one\nshared two\nremote three',
    );
    expect(outcome.clean).toBe(true);
    expect(outcome.merged).toBe('local one\nshared two\nremote three');
  });

  it('keeps identical edits on both sides clean', () => {
    const outcome = mergeNoteBodies('base', 'base\nsame addition', 'base\nsame addition');
    expect(outcome).toEqual({ merged: 'base\nsame addition', clean: true, remoteWasAppend: true });
  });

  it('reports overlapping edits as a conflict and keeps both hunks', () => {
    const outcome = mergeNoteBodies(
      'the middle line',
      'the local line',
      'the remote line',
    );
    expect(outcome.clean).toBe(false);
    expect(outcome.remoteWasAppend).toBe(false);
    expect(outcome.merged).toBe('the remote line\n\nthe local line');
  });

  it('merges mixed clean and conflicting regions while preserving shared lines once', () => {
    const outcome = mergeNoteBodies(
      'head\nmiddle\nfoot',
      'head\nmiddle local\nfoot\nlocal tail',
      'head\nmiddle remote\nfoot\nremote tail',
    );
    expect(outcome.clean).toBe(false);
    expect(outcome.merged).toBe('head\nmiddle remote\n\nmiddle local\nfoot\nremote tail\n\nlocal tail');
  });
});

describe('conflictHunks', () => {
  it('returns only the overlapping passages, not the shared text', () => {
    expect(conflictHunks('a\nshared\nz', 'a\nmine\nz', 'a\ntheirs\nz')).toEqual([{ mine: ['mine'], theirs: ['theirs'] }]);
  });

  it('is empty when the edits touch different lines', () => {
    expect(conflictHunks('a\nb\nc', 'A\nb\nc', 'a\nb\nC')).toEqual([]);
  });
});
