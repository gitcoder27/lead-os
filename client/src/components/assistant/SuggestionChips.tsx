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
