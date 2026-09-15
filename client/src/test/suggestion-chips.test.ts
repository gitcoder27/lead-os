import { describe, expect, it } from 'vitest';
import type { Alert } from '@/types';
import { contextualSuggestions } from '@/components/assistant/SuggestionChips';

function alert(type: Alert['type']): Alert {
  return { id: `${type}-${Math.random()}`, type, severity: 'medium', message: '', detectedAt: '' };
}

describe('contextualSuggestions', () => {
  it('puts alert-driven chips first and fills with view defaults', () => {
    const chips = contextualSuggestions([alert('overdue'), alert('overdue'), alert('idle_developer')], '/work');
    expect(chips[0]).toBe('Show the 2 overdue defects');
    expect(chips[1]).toBe('Draft nudges for the 1 missing check-in');
    expect(chips).toHaveLength(3);
  });

  it('falls back to view defaults when there are no alerts', () => {
    expect(contextualSuggestions([], '/team')).toEqual([
      "Who hasn't checked in today?",
      'Summarize the team board',
      'Who needs attention?',
    ]);
  });

  it('caps at three chips and dedupes against view defaults', () => {
    const alerts = [alert('overdue'), alert('idle_developer'), alert('blocked'), alert('stale'), alert('high_priority_not_started')];
    const chips = contextualSuggestions(alerts, '/');
    expect(chips).toHaveLength(3);
    expect(new Set(chips).size).toBe(3);
  });
});
