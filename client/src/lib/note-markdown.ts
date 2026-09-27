/**
 * Plain-markdown helpers for the daily note editor (docs/52 F1/F7/F8/§5).
 *
 * The stored note body is plain markdown — these helpers only read and
 * rewrite lines of text. Nothing here knows about CodeMirror so the rules
 * (what counts as an entity, a provenance marker, a wrap-up candidate) stay
 * testable and shared between the editor, dialogs, and the wrap-up flow.
 */
import { format, parseISO } from 'date-fns';

/** Task keys: `T-84` (case-insensitive in text, normalized to upper). */
export const TASK_KEY_PATTERN = /\b[Tt]-\d{1,9}\b/g;
/** Jira keys: a project of 2+ chars so `T-84` never reads as Jira. */
export const JIRA_KEY_PATTERN = /\b[A-Z][A-Z0-9]{1,9}-\d{1,7}\b/g;
/**
 * `→ T-84` written after a converted line (F7), or `→ 2026-09-28` after a
 * line carried into that day's note (§5).
 */
export const PROVENANCE_PATTERN = /→ (?:[Tt]-\d{1,9}|\d{4}-\d{2}-\d{2})(?![\w-])/g;
/** `↩ from 2026-09-27` written on lines carried from another day (§5). */
export const CARRIED_PATTERN = /↩ from (\d{4}-\d{2}-\d{2})/g;

const LIST_PREFIX = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\]\s+)?/;
const CHECKBOX_OPEN = /^(\s*)[-*+]\s+\[ \]\s+/;
const CHECKBOX_ANY = /^(\s*)[-*+]\s+\[([ xX])\]\s+/;
const HEADING = /^\s{0,3}#{1,6}\s/;
const STRUCK = /^~~.*~~$/;

export interface NoteDeveloper {
  accountId: string;
  displayName: string;
}

export interface ListPrefix {
  indent: string;
  bullet: string;
  /** Full prefix including any checkbox, e.g. `  - [ ] `. */
  prefix: string;
  checkbox: 'open' | 'done' | null;
  ordered: boolean;
}

export function parseListPrefix(line: string): ListPrefix | null {
  const match = LIST_PREFIX.exec(line);
  if (!match) return null;
  const [prefix, indent = '', bullet = '-', , box] = match;
  return {
    indent,
    bullet,
    prefix,
    checkbox: box ? (/\[ \]/.test(box) ? 'open' : 'done') : null,
    ordered: /\d/.test(bullet),
  };
}

/** Toggle `- [ ]` ⇄ `- [x]`; returns null when the line has no checkbox. */
export function toggleCheckbox(line: string): string | null {
  const match = CHECKBOX_ANY.exec(line);
  if (!match) return null;
  const open = match[2] === ' ';
  const at = line.indexOf('[', match[1]?.length ?? 0);
  return `${line.slice(0, at)}[${open ? 'x' : ' '}]${line.slice(at + 3)}`;
}

/** Line text without list/checkbox prefix, provenance, or carried markers. */
export function lineContent(line: string): string {
  const list = parseListPrefix(line);
  const body = list ? line.slice(list.prefix.length) : line.replace(/^\s{0,3}#{1,6}\s+/, '');
  return body
    .replace(PROVENANCE_PATTERN, '')
    .replace(CARRIED_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasProvenance(line: string): boolean {
  return new RegExp(PROVENANCE_PATTERN.source).test(line);
}

/** Append ` → T-84` to a line (idempotent for the same key). */
export function appendProvenance(line: string, key: string): string {
  const marker = `→ ${key}`;
  if (line.includes(marker)) return line;
  return `${line.replace(/\s+$/, '')} ${marker}`;
}

export function firstLine(text: string, max = 500): string {
  return (text.trim().split('\n')[0] ?? '').trim().slice(0, max);
}

/**
 * F10: split captured text into a title (first line, markers stripped) and
 * the remainder as context. Used by every "turn into" dialog.
 */
export function splitTitleAndContext(text: string, titleMax = 500): { title: string; context: string } {
  const lines = text.split('\n').map(lineContent).filter((line) => line.length > 0);
  const [head = '', ...rest] = lines;
  return { title: head.slice(0, titleMax), context: rest.join('\n') };
}

export function taskKeysIn(text: string): string[] {
  const keys = new Set<string>();
  for (const match of text.matchAll(TASK_KEY_PATTERN)) keys.add(match[0].toUpperCase());
  return [...keys];
}

/** Task keys mentioned in prose — provenance markers don't count as intent. */
function proseTaskKeys(text: string): string[] {
  return taskKeysIn(text.replace(PROVENANCE_PATTERN, ''));
}

export function jiraKeysIn(text: string): string[] {
  const keys = new Set<string>();
  for (const match of text.matchAll(JIRA_KEY_PATTERN)) keys.add(match[0]);
  return [...keys];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `@Name` matcher for the roster: full display names, longest first, plus a
 * first name when it's unique on the team. Null when nobody is mentionable.
 */
export function mentionPattern(developers: NoteDeveloper[]): RegExp | null {
  const names = new Set<string>();
  const firstNames = new Map<string, number>();
  for (const dev of developers) {
    const name = dev.displayName.trim();
    if (!name) continue;
    names.add(name);
    const first = name.split(/\s+/)[0]!;
    firstNames.set(first.toLowerCase(), (firstNames.get(first.toLowerCase()) ?? 0) + 1);
  }
  for (const dev of developers) {
    const first = dev.displayName.trim().split(/\s+/)[0];
    if (first && firstNames.get(first.toLowerCase()) === 1) names.add(first);
  }
  if (names.size === 0) return null;
  const alternatives = [...names].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return new RegExp(`@(${alternatives.join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
}

export function resolveMention(name: string, developers: NoteDeveloper[]): NoteDeveloper | null {
  const needle = name.trim().toLowerCase();
  return (
    developers.find((dev) => dev.displayName.trim().toLowerCase() === needle) ??
    developers.find((dev) => dev.displayName.trim().split(/\s+/)[0]!.toLowerCase() === needle) ??
    null
  );
}

export function mentionsIn(text: string, developers: NoteDeveloper[]): NoteDeveloper[] {
  const pattern = mentionPattern(developers);
  if (!pattern) return [];
  const found = new Map<string, NoteDeveloper>();
  for (const match of text.matchAll(pattern)) {
    const dev = resolveMention(match[1] ?? '', developers);
    if (dev) found.set(dev.accountId, dev);
  }
  return [...found.values()];
}

export interface LineInference {
  /** Exactly one task key in the prose → the update target. */
  taskKey: string | null;
  /** Exactly one @person → the assignee. */
  developer: NoteDeveloper | null;
  jiraKey: string | null;
}

/** F8: pre-pick targets from what the line already says. Ambiguity picks nothing. */
export function inferFromText(text: string, developers: NoteDeveloper[]): LineInference {
  const keys = proseTaskKeys(text);
  const people = mentionsIn(text, developers);
  const jira = jiraKeysIn(text);
  return {
    taskKey: keys.length === 1 ? keys[0]! : null,
    developer: people.length === 1 ? people[0]! : null,
    jiraKey: jira.length === 1 ? jira[0]! : null,
  };
}

// ── EOD wrap-up (§5) ──────────────────────────────────────────────────

export interface WrapUpCandidate {
  /** 0-based line index in the body. */
  line: number;
  /** The raw line, used to re-locate it if the body shifted. */
  raw: string;
  text: string;
  kind: 'checkbox' | 'item';
}

/**
 * Open loose ends: unchecked checkboxes, plus bullets that name someone or a
 * task (`@Rohit`, `T-12`) — those read as actions. Plain bullets are how people
 * take notes, so they never count; nor do prose, headings, struck-through,
 * checked, or already-converted lines.
 */
export function wrapUpCandidates(body: string, developers: NoteDeveloper[] = []): WrapUpCandidate[] {
  const out: WrapUpCandidate[] = [];
  body.split('\n').forEach((raw, line) => {
    if (HEADING.test(raw) || hasProvenance(raw)) return;
    const list = parseListPrefix(raw);
    if (!list || list.checkbox === 'done') return;
    const rest = raw.slice(list.prefix.length).trim();
    if (!rest || STRUCK.test(rest)) return;
    const text = lineContent(raw);
    if (!text) return;
    if (CHECKBOX_OPEN.test(raw)) {
      out.push({ line, raw, text, kind: 'checkbox' });
    } else if (proseTaskKeys(rest).length > 0 || mentionsIn(rest, developers).length > 0) {
      out.push({ line, raw, text, kind: 'item' });
    }
  });
  return out;
}

/** Strike a dropped line's content: `- [ ] foo` → `- ~~foo~~`. */
export function dropLine(line: string): string {
  const list = parseListPrefix(line);
  if (!list) return `~~${line.trim()}~~`;
  const rest = line.slice(list.prefix.length).trim();
  if (!rest || STRUCK.test(rest)) return line;
  return `${list.indent}${list.bullet} ~~${rest}~~`;
}

/** Lines carried into the next day's note, each tagged with where it came from. */
export function carryText(texts: string[], fromDate: string): string {
  return texts.map((text) => `- [ ] ${text} ↩ from ${fromDate}`).join('\n');
}

export function prettyNoteDate(date: string, pattern = 'MMM d'): string {
  try {
    return format(parseISO(date), pattern);
  } catch {
    return date;
  }
}

// ── Search snippets (F12) ─────────────────────────────────────────────

export interface SnippetSegment {
  text: string;
  match: boolean;
}

/** Split an FTS snippet with ⟦…⟧ markers into renderable segments. */
export function snippetSegments(snippet: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  const pattern = /⟦([^⟧]*)⟧/g;
  let last = 0;
  for (const match of snippet.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) segments.push({ text: snippet.slice(last, at), match: false });
    if (match[1]) segments.push({ text: match[1], match: true });
    last = at + match[0].length;
  }
  if (last < snippet.length) segments.push({ text: snippet.slice(last), match: false });
  return segments;
}

/** Searchable terms from a query, matching the server's FTS tokenization. */
export function searchTerms(query: string): string[] {
  return (query.match(/[\p{L}\p{N}]+/gu) ?? []).filter((term) => term.length > 0).slice(0, 12);
}
