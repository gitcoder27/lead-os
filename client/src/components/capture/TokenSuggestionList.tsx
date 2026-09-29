import { Hash, Tags } from 'lucide-react';
import { taskLabelDisplayName } from '@/types';
import { Avatar } from '@/components/ui/Avatar';
import type { TokenSuggestion, TypeaheadTrigger } from '@/lib/capture-typeahead';

const LIST_LABEL: Record<TypeaheadTrigger, string> = {
  '@': 'Person suggestions',
  '#': 'Issue suggestions',
  '+': 'Label suggestions',
};

interface TokenSuggestionListProps {
  trigger: TypeaheadTrigger;
  suggestions: TokenSuggestion[];
  activeIndex: number;
  onChoose: (suggestion: TokenSuggestion) => void;
  onHover?: (index: number) => void;
  /** Drop below the input (default) or float above it. */
  placement?: 'below' | 'above';
}

/** docs/57 §3 (P3-05): the `@` / `#` / `+` suggestion popover under a capture input. */
export function TokenSuggestionList({ trigger, suggestions, activeIndex, onChoose, onHover, placement = 'below' }: TokenSuggestionListProps) {
  if (suggestions.length === 0) return null;
  return (
    <div
      className={`absolute left-0 right-0 z-20 overflow-hidden rounded-xl ${placement === 'below' ? 'top-full mt-1' : 'bottom-full mb-1'}`}
      role="listbox"
      aria-label={LIST_LABEL[trigger]}
      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', boxShadow: '0 12px 32px rgba(0,0,0,0.28)' }}
    >
      {suggestions.map((suggestion, index) => (
        <button
          key={suggestion.id}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onHover?.(index)}
          onClick={() => onChoose(suggestion)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors"
          style={{
            background: index === activeIndex ? 'var(--accent-glow)' : 'transparent',
            color: 'var(--text-primary)',
          }}
        >
          {trigger === '@' ? (
            <Avatar name={suggestion.label} seed={suggestion.seed} size={16} />
          ) : trigger === '#' ? (
            <Hash size={10} style={{ color: 'var(--info)' }} />
          ) : (
            <Tags size={10} style={{ color: 'var(--accent)' }} />
          )}
          <span className={trigger === '@' ? 'font-medium' : 'font-mono font-semibold'}>
            {trigger === '@' ? suggestion.label : `${trigger}${suggestion.insert}`}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {trigger === '+' ? taskLabelDisplayName(suggestion.insert) : trigger === '@' ? (
              <>
                {suggestion.detail ? `${suggestion.detail} · ` : ''}
                <span className="font-mono">@{suggestion.insert}</span>
              </>
            ) : suggestion.detail}
          </span>
        </button>
      ))}
    </div>
  );
}
