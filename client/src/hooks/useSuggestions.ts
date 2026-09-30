import { useQuery } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { PRIORITY_OPTIONS } from '@/lib/constants';
import type { PrioritySuggestion, DueDateSuggestion, AssignmentSuggestion } from '@/types';

export function useSuggestions(issueKey?: string, currentPriority?: string) {
  const authScopeKey = useAuthScopeKey();

  const prioritySuggestion = useQuery<PrioritySuggestion>({
    queryKey: ['suggestions', 'priority', issueKey, authScopeKey],
    queryFn: () => api.get(`/suggestions/priority/${issueKey}`),
    enabled: !!issueKey,
  });

  // docs/56 P5-02: the target follows the priority the manager would end up with (a real
  // priority suggestion, else the current one) and counts from the issue's creation.
  const suggestedPriority = prioritySuggestion.data && !prioritySuggestion.data.isDefault
    ? prioritySuggestion.data.suggested
    : undefined;
  // A tenant-specific priority (e.g. "P1") has no SLA target, so no due date is suggested for it
  // rather than one for a priority the issue does not have.
  const currentTarget = currentPriority === undefined
    ? 'Medium'
    : PRIORITY_OPTIONS.includes(currentPriority) ? currentPriority : undefined;
  const dueDatePriority = suggestedPriority ?? currentTarget;

  const dueDateSuggestion = useQuery<DueDateSuggestion>({
    queryKey: ['suggestions', 'duedate', issueKey, dueDatePriority, authScopeKey],
    queryFn: () => api.get(`/suggestions/duedate/${encodeURIComponent(dueDatePriority ?? '')}?issue=${encodeURIComponent(issueKey ?? '')}`),
    enabled: !!issueKey && !!dueDatePriority && !prioritySuggestion.isPending,
  });

  const assigneeSuggestion = useQuery<AssignmentSuggestion[]>({
    queryKey: ['suggestions', 'assignee', issueKey, authScopeKey],
    queryFn: async () => {
      const res = await api.get<{ issueKey: string; suggestions: AssignmentSuggestion[] }>(`/suggestions/assignee/${issueKey}`);
      return res.suggestions;
    },
    enabled: !!issueKey,
  });

  return { prioritySuggestion, dueDateSuggestion, assigneeSuggestion, dueDatePriority };
}
