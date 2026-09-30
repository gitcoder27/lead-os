import type { JiraSyncScopeMode } from '@/types';

/** docs/56 P5-01: one place for how each Jira sync scope reads in the UI. */
export const SYNC_SCOPE_SHORT_LABELS: Record<JiraSyncScopeMode, string> = {
  team_and_unassigned: 'Team + unassigned',
  team_assignees: 'Team assignees',
  base_query: 'Base query',
};

export const SYNC_SCOPE_SUMMARIES: Record<JiraSyncScopeMode, string> = {
  team_and_unassigned: 'Team assignees and unassigned issues, added at sync time.',
  team_assignees: 'Team assignees appended at sync time.',
  base_query: 'Base query only.',
};

export const SYNC_SCOPE_DESCRIPTIONS: Record<JiraSyncScopeMode, string> = {
  team_and_unassigned: 'Team + unassigned (tracked people’s issues and anything unassigned)',
  team_assignees: 'Team assignees (only tracked people’s issues)',
  base_query: 'Base query (exact JQL)',
};
