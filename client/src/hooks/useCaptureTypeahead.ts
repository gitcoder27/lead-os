import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { CapturePersonCandidate } from 'shared/capture-grammar';
import { useContacts } from '@/hooks/useContacts';
import { useDevelopers } from '@/hooks/useDevelopers';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { useTaskLabels } from '@/hooks/useTaskLabels';
import {
  applyTokenSuggestion,
  issueSuggestions,
  labelSuggestions,
  personSuggestions,
  readableAlias,
  tokenFragmentAt,
  wireText,
  type TokenFragment,
  type TokenSuggestion,
} from '@/lib/capture-typeahead';

/**
 * docs/57 §3 (P3-05): `@person`, `#JIRA-KEY` and `+label` typeahead for any
 * text input that feeds the capture grammar. Owns the roster lookups, the
 * highlighted row and dismissal; the input owns the text and caret.
 */
export function useCaptureTypeahead(text: string, caret: number) {
  const developers = useDevelopers();
  const contacts = useContacts();
  const labelRegistry = useTaskLabels();
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  // docs/56 UX-05: alias (lower case) → person id for every `@` picked here. The text shows the
  // alias; `toWire` swaps the id back in for the server, so the pick is exact.
  const [aliases, setAliases] = useState<ReadonlyMap<string, string>>(() => new Map());
  const remember = (alias: string, accountId: string) => {
    if (alias === accountId) return;
    setAliases((current) => (current.get(alias.toLowerCase()) === accountId ? current : new Map(current).set(alias.toLowerCase(), accountId)));
  };

  // docs/57 §2: `@handle` also resolves the manager's contacts (external people).
  const people = useMemo<CapturePersonCandidate[]>(
    () => [
      ...(developers.data ?? []).map((dev) => ({ accountId: dev.accountId, displayName: dev.displayName, kind: 'developer' as const })),
      ...(contacts.data ?? []).map((contact) => ({ accountId: contact.handle, displayName: contact.displayName, kind: 'contact' as const, contactId: contact.id })),
    ],
    [developers.data, contacts.data],
  );

  const fragment = useMemo<TokenFragment | null>(() => tokenFragmentAt(text, caret), [text, caret]);
  const issueQuery = fragment?.trigger === '#' ? fragment.fragment : '';
  const issues = useGlobalSearch(issueQuery, { enabled: fragment?.trigger === '#' });

  const suggestions = useMemo<TokenSuggestion[]>(() => {
    if (!fragment || dismissed) return [];
    if (fragment.trigger === '@') return personSuggestions(fragment.fragment, people);
    if (fragment.trigger === '+') return labelSuggestions(fragment.fragment, (labelRegistry.data?.labels ?? []).map((label) => label.name));
    return issueSuggestions(issues.data?.issues ?? [], fragment.fragment);
  }, [fragment, dismissed, people, labelRegistry.data, issues.data]);

  // New edits reopen a dismissed list and restart at the top.
  useEffect(() => {
    setDismissed(false);
    setActiveIndex(0);
  }, [text]);

  const open = suggestions.length > 0;
  const active = suggestions[Math.min(activeIndex, Math.max(suggestions.length - 1, 0))];

  /** The text and caret after choosing `suggestion` (default: the highlighted row). */
  const choose = (suggestion: TokenSuggestion | undefined = active): { text: string; caret: number } | null => {
    if (!fragment || !suggestion) return null;
    if (suggestion.ref) remember(suggestion.insert, suggestion.ref);
    return applyTokenSuggestion(text, caret, fragment, suggestion);
  };

  /** The readable `@` text for a person picked outside the list (the ambiguity chooser); remembered like a pick. */
  const mentionFor = (accountId: string): string => {
    const person = people.find((candidate) => candidate.accountId === accountId);
    if (!person) return accountId;
    const alias = readableAlias(person, people);
    remember(alias, accountId);
    return alias;
  };

  /** The text to send: picked aliases become ids again. */
  const toWire = (value: string): string => wireText(value, aliases);

  /**
   * Navigation keys for an open list: arrows move, Tab accepts, Escape closes.
   * Returns the chosen text when Tab accepted one; `true` when the key was
   * consumed; `false` to let the input handle it. Enter is left to the caller
   * (it accepts a suggestion, or submits).
   */
  const handleKey = (event: KeyboardEvent): { text: string; caret: number } | boolean => {
    if (!open) return false;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => (index + 1) % suggestions.length); return true; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length); return true; }
    if (event.key === 'Tab') { event.preventDefault(); return choose() ?? true; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(true); return true; }
    return false;
  };

  return {
    people,
    developersPending: developers.isPending,
    fragment,
    suggestions,
    open,
    activeIndex,
    activeId: active?.id,
    setActiveIndex,
    choose,
    mentionFor,
    toWire,
    handleKey,
  };
}
