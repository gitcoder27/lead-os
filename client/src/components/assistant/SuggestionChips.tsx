import type { Alert } from '@/types';

interface SuggestionChipsProps {
  currentView: string;
  /** Explicit items (e.g. server follow-up suggestions); defaults to per-view starters. */
  items?: string[];
  onPick: (text: string) => void;
}

export function suggestionsForView(path: string): string[] {
  if (path.startsWith('/team')) {
    return ["Who hasn't checked in today?", 'Summarize the team board', 'Who needs attention?'];
  }
  if (path.startsWith('/work')) {
    return ['Which defects are overdue?', 'Unassigned high-priority defects', "What's due today?"];
  }
  if (path.startsWith('/desk') || path.startsWith('/follow-ups') || path.startsWith('/meetings')) {
    return ['What follow-ups are due?', 'Create a follow-up', "What's on my desk today?"];
  }
  if (path.startsWith('/notes')) {
    return ["Summarize today's notes", 'Add a note'];
  }
  return ['Brief me on today', 'Who needs attention?', 'Create a follow-up'];
}

/** Live-data starters: alert-driven chips first, view defaults as fill — max 3. */
export function contextualSuggestions(alerts: Alert[], path: string): string[] {
  const counts = new Map<Alert['type'], number>();
  for (const alert of alerts) {
    counts.set(alert.type, (counts.get(alert.type) ?? 0) + 1);
  }
  const chips: string[] = [];
  const overdue = counts.get('overdue') ?? 0;
  if (overdue > 0) {
    chips.push(`Show the ${overdue} overdue defect${overdue === 1 ? '' : 's'}`);
  }
  const idle = counts.get('idle_developer') ?? 0;
  if (idle > 0) {
    chips.push(`Draft nudges for the ${idle} missing check-in${idle === 1 ? '' : 's'}`);
  }
  if ((counts.get('blocked') ?? 0) > 0) {
    chips.push('Which issues are blocked and who owns them?');
  }
  if ((counts.get('stale') ?? 0) > 0) {
    chips.push('What has gone stale this week?');
  }
  if ((counts.get('high_priority_not_started') ?? 0) > 0) {
    chips.push("Which high-priority defects haven't started?");
  }
  return [...new Set([...chips, ...suggestionsForView(path)])].slice(0, 3);
}

export function SuggestionChips({ currentView, items, onPick }: SuggestionChipsProps) {
  const suggestions = items ?? suggestionsForView(currentView);
  return (
    <div className="flex flex-wrap gap-1.5">
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => onPick(suggestion)}
          className="rounded-full px-2.5 py-1 text-[11.5px] transition-colors"
          style={{
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}
