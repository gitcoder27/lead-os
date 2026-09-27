import { diff3Merge } from 'node-diff3';

export interface NoteMergeOutcome {
  /** Merged body. When `clean` is false this is a keep-both proposal that
   *  includes both sides of every overlapping hunk (remote first). */
  merged: string;
  /** True when the sides touched disjoint regions and the merge needs no review. */
  clean: boolean;
  /** True when the remote side only appended to the shared base. */
  remoteWasAppend: boolean;
}

/**
 * Three-way merge of a daily note body.
 *
 * `base` is the last server-acknowledged body, `local` the editor draft, and
 * `remote` the newest server body. Pure appends on either side are spliced on
 * without a diff; everything else goes through a line-level diff3 where
 * overlapping hunks are reported as `clean: false` with both sides preserved.
 */
export function mergeNoteBodies(base: string, local: string, remote: string): NoteMergeOutcome {
  // A real append starts on a line boundary — "baseball" must not count as an
  // append of "base".
  const isAppend = (full: string) =>
    base !== '' && full.length > base.length && full.startsWith(base) && full.charAt(base.length) === '\n';
  const remoteWasAppend = isAppend(remote);

  if (remote === base || local === remote) {
    return { merged: local, clean: true, remoteWasAppend };
  }
  if (local === base) {
    return { merged: remote, clean: true, remoteWasAppend };
  }
  if (remoteWasAppend) {
    return { merged: local + remote.slice(base.length), clean: true, remoteWasAppend };
  }
  if (isAppend(local)) {
    return { merged: remote + local.slice(base.length), clean: true, remoteWasAppend };
  }

  const regions = diff3Merge<string>(local.split('\n'), base.split('\n'), remote.split('\n'), {
    excludeFalseConflicts: true,
  });
  const lines: string[] = [];
  let clean = true;
  for (const region of regions) {
    if (region.ok) {
      lines.push(...region.ok);
      continue;
    }
    clean = false;
    const conflict = region.conflict;
    if (conflict) {
      // Keep-both ordering: remote hunk first, blank line, then local hunk —
      // same paragraph separation the editor's conflict flow used before.
      lines.push(...conflict.b, '', ...conflict.a);
    }
  }
  return { merged: lines.join('\n'), clean, remoteWasAppend: false };
}

export interface NoteConflictHunk {
  /** Lines only in the editor draft. */
  mine: string[];
  /** Lines only in the saved (server) version. */
  theirs: string[];
}

/**
 * docs/52 U5: the overlapping hunks between the draft and the saved version,
 * so the conflict panel can show what actually differs instead of two full
 * documents. Empty when the bodies merge cleanly.
 */
export function conflictHunks(base: string, local: string, remote: string): NoteConflictHunk[] {
  const regions = diff3Merge<string>(local.split('\n'), base.split('\n'), remote.split('\n'), {
    excludeFalseConflicts: true,
  });
  const hunks: NoteConflictHunk[] = [];
  for (const region of regions) {
    if (!region.ok && region.conflict) {
      hunks.push({ mine: region.conflict.a, theirs: region.conflict.b });
    }
  }
  return hunks;
}
