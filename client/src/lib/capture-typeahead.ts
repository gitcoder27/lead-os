import { matchCapturePeople, type CapturePersonCandidate } from 'shared/capture-grammar';

/**
 * docs/57 §3 (P3-05): `@person`, `#JIRA-KEY` and `+label` typeahead for the
 * capture grammar. Pure helpers — the hook owns selection state, the input
 * owns the text.
 */
export type TypeaheadTrigger = '@' | '#' | '+';

export interface TokenFragment {
  trigger: TypeaheadTrigger;
  /** Index of the trigger character in the text. */
  start: number;
  /** What was typed after the trigger, up to the caret. */
  fragment: string;
}

export interface TokenSuggestion {
  id: string;
  trigger: TypeaheadTrigger;
  /** Inserted after the trigger. */
  insert: string;
  label: string;
  detail?: string;
  /** Avatar seed for people. */
  seed?: string;
}

const MAX_SUGGESTIONS = 6;
// `:` and `.` belong to person ids (Jira account ids); `-` to issue keys and labels.
const FRAGMENT = /(?:^|\s)([@#+])([A-Za-z0-9:._-]*)$/;

/** The token being typed at the caret, or null. */
export function tokenFragmentAt(text: string, caret: number): TokenFragment | null {
  const match = FRAGMENT.exec(text.slice(0, caret));
  if (!match) return null;
  const fragment = match[2]!;
  return { trigger: match[1] as TypeaheadTrigger, start: caret - fragment.length - 1, fragment };
}

/** Developers first, then contacts; an empty fragment lists the first few people. */
export function personSuggestions(fragment: string, people: readonly CapturePersonCandidate[]): TokenSuggestion[] {
  const ordered = [...people].sort((left, right) => Number(left.kind === 'contact') - Number(right.kind === 'contact'));
  const matches = fragment ? matchCapturePeople(fragment, ordered) : ordered;
  return matches
    // A fully typed handle needs no suggestion — Enter should submit.
    .filter((person) => person.accountId.toLowerCase() !== fragment.toLowerCase())
    .slice(0, MAX_SUGGESTIONS)
    .map((person) => ({
      id: `${person.kind ?? 'developer'}:${person.accountId}`,
      trigger: '@' as const,
      insert: person.accountId,
      label: person.displayName || person.accountId,
      detail: person.kind === 'contact' ? 'Contact' : undefined,
      seed: person.accountId,
    }));
}

export function labelSuggestions(fragment: string, names: readonly string[]): TokenSuggestion[] {
  const needle = fragment.toLowerCase();
  const prefix = names.filter((name) => name.startsWith(needle) && name !== needle);
  const contains = names.filter((name) => !prefix.includes(name) && name !== needle && name.includes(needle));
  return [...prefix, ...contains].slice(0, MAX_SUGGESTIONS).map((name) => ({
    id: `label:${name}`,
    trigger: '+' as const,
    insert: name,
    label: name,
  }));
}

export function issueSuggestions(issues: readonly { jiraKey: string; summary: string }[], fragment: string): TokenSuggestion[] {
  const needle = fragment.toLowerCase();
  return issues
    .filter((issue) => issue.jiraKey.toLowerCase() !== needle)
    .slice(0, MAX_SUGGESTIONS)
    .map((issue) => ({ id: `issue:${issue.jiraKey}`, trigger: '#' as const, insert: issue.jiraKey, label: issue.jiraKey, detail: issue.summary }));
}

/**
 * Replace the fragment with the chosen token, followed by one space — the
 * caret lands after it, reusing a space that is already there.
 */
export function applyTokenSuggestion(
  text: string,
  caret: number,
  fragment: TokenFragment,
  suggestion: TokenSuggestion,
): { text: string; caret: number } {
  const token = `${fragment.trigger}${suggestion.insert}`;
  const after = text.slice(caret);
  const hasSpace = /^\s/.test(after);
  return {
    text: `${text.slice(0, fragment.start)}${token}${hasSpace ? '' : ' '}${after}`,
    caret: fragment.start + token.length + 1,
  };
}
