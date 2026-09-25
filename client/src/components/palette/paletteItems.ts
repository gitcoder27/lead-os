import { format, parseISO } from 'date-fns';
import type { AppView } from '@/App';
import type {
  DailyNoteSummary,
  GlobalSearchCheckInItem,
  GlobalSearchDeveloperItem,
  GlobalSearchDeskItem,
  GlobalSearchIssueItem,
  GlobalSearchTaskItem,
  GlobalSearchTrackerItem,
  TodayActionTarget,
} from '@/types';
import { KIND_LABELS } from '@/types/manager-desk';
import { isValidIsoDate } from '@/lib/view-params';
import { TASK_KEY_PATTERN } from '@/types';

export type PaletteGroupId = 'actions' | 'issues' | 'desk' | 'tracker' | 'tasks' | 'checkins' | 'developers' | 'notes';

export interface PaletteItem {
  id: string;
  group: PaletteGroupId;
  title: string;
  description?: string;
  keywords?: string;
  /** Plain view switch (for surfaces not addressable by TodayActionTarget). */
  view?: AppView;
  /** Navigation targets handed to the app's shared target handler. */
  target?: TodayActionTarget;
  /** Non-navigation actions the palette host executes (capture, sync, quick add). */
  actionId?: 'capture' | 'capture-note' | 'sync' | 'quick-add-desk';
}

export interface PaletteGroup {
  id: PaletteGroupId;
  label: string;
  items: PaletteItem[];
}

const NAVIGATION_COMMANDS: Array<{ view: AppView; title: string; keywords?: string; targetView?: TodayActionTarget['view'] }> = [
  { view: 'today', title: 'Go to Today', keywords: 'home daily start morning' },
  { view: 'work', title: 'Go to Work', keywords: 'defects jira issues triage dashboard', targetView: 'work' },
  { view: 'team', title: 'Go to Team', keywords: 'tracker developers day check-in', targetView: 'team' },
  { view: 'desk', title: 'Go to Desk', keywords: 'manager planning', targetView: 'desk' },
  { view: 'follow-ups', title: 'Go to Follow-ups', keywords: 'promises reminders', targetView: 'follow-ups' },
  { view: 'meetings', title: 'Go to Meetings', keywords: 'actions minutes', targetView: 'meetings' },
  { view: 'notes', title: 'Go to Notes', keywords: 'scratchpad journal private writing', targetView: 'notes' },
  { view: 'settings', title: 'Go to Settings', keywords: 'config jira users backups', targetView: 'settings' },
];

export function buildNavigationCommands(): PaletteItem[] {
  return NAVIGATION_COMMANDS.map((command) => ({
    id: `nav-${command.view}`,
    group: 'actions',
    title: command.title,
    keywords: command.keywords,
    view: command.view,
    target: command.targetView ? { type: 'view', view: command.targetView } : undefined,
  }));
}

export function buildQuickActions(): PaletteItem[] {
  return [
    {
      id: 'action-capture',
      group: 'actions',
      title: 'Quick capture',
      description: 'Desk or Team quick capture',
      keywords: 'capture quick add desk team task follow-up meeting',
      actionId: 'capture',
    },
    {
      id: 'action-capture-note',
      group: 'actions',
      title: 'New note',
      description: "Add to today's private scratchpad",
      keywords: 'note scratchpad journal private write capture',
      actionId: 'capture-note',
    },
    {
      id: 'action-sync',
      group: 'actions',
      title: 'Start Jira sync',
      description: 'Refresh work from Jira now',
      keywords: 'refresh jira update import',
      actionId: 'sync',
    },
  ];
}

export function filterCommands(commands: PaletteItem[], query: string): PaletteItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return commands;
  }
  const tokens = normalized.split(/\s+/);

  const scored: Array<{ command: PaletteItem; index: number; tier: number }> = [];
  commands.forEach((command, index) => {
    const haystack = `${command.title} ${command.keywords ?? ''}`.toLowerCase();
    if (!tokens.every((token) => haystack.includes(token))) {
      return;
    }
    // Title matches outrank keyword-only matches so "capture" surfaces the
    // capture action above destinations that merely mention capturing.
    const titleLower = command.title.toLowerCase();
    const tier = tokens.every((token) => titleLower.includes(token)) ? 0 : 1;
    scored.push({ command, index, tier });
  });

  return scored
    .sort((left, right) => left.tier - right.tier || left.index - right.index)
    .map((entry) => entry.command);
}

export const QUICK_ADD_MIN_QUERY_LENGTH = 3;

/**
 * Free-text quick add: a typed sentence becomes a desk item on today's inbox.
 * Returns null for queries too short to look like content.
 */
export function buildQuickAddItem(query: string): PaletteItem | null {
  const trimmed = query.trim();
  if (trimmed.length < QUICK_ADD_MIN_QUERY_LENGTH) {
    return null;
  }
  return {
    id: 'quick-add-desk',
    group: 'actions',
    title: 'Add to Desk',
    description: `"${trimmed}" · today's inbox`,
    actionId: 'quick-add-desk',
  };
}

/**
 * Deterministic placement to avoid the duplicate-creation trap: when the
 * quick-add row is the only row, Enter creates immediately; when anything
 * else matches, it is pinned last so Enter opens the top result instead.
 */
export function placeQuickAddItem(rows: PaletteItem[], quickAdd: PaletteItem | null): PaletteItem[] {
  if (!quickAdd) {
    return rows;
  }
  return rows.length === 0 ? [quickAdd] : [...rows, quickAdd];
}

/**
 * A typed task key (e.g. "T-5") pins the matching task rows ahead of commands
 * and quick-add so Enter always opens the task, never creates a desk item.
 */
export function pinExactTaskKey(rows: PaletteItem[], query: string): PaletteItem[] {
  const match = TASK_KEY_PATTERN.exec(query.trim());
  if (!match) {
    return rows;
  }
  const key = `T-${Number(match[1])}`;
  const pinned = rows.filter((row) => row.group === 'tasks' && row.id.startsWith(`task-${key}-`));
  if (pinned.length === 0) {
    return rows;
  }
  return [...pinned, ...rows.filter((row) => !pinned.includes(row))];
}

export function issueToPaletteItem(issue: GlobalSearchIssueItem, index: number): PaletteItem {
  return {
    id: `issue-${issue.jiraKey}-${index}`,
    group: 'issues',
    title: issue.summary,
    description: [issue.jiraKey, issue.statusName, issue.assigneeName ?? 'Unassigned'].join(' · '),
    keywords: issue.jiraKey,
    target: { type: 'issue', view: 'work', issueKey: issue.jiraKey },
  };
}

export function deskItemToPaletteItem(item: GlobalSearchDeskItem, index: number, options?: { showTaxonomy?: boolean }): PaletteItem {
  const showTaxonomy = options?.showTaxonomy ?? true;
  const kindLabel = KIND_LABELS[item.kind] ?? 'Desk item';
  const statusLabel = item.status === 'done' ? 'Done' : item.status.replace(/_/g, ' ');
  return {
    id: `desk-${item.itemId}-${index}`,
    group: 'desk',
    title: item.title,
    // Phase 3 (P3-D13): kind/category retire — desk results lead with the date.
    description: [...(showTaxonomy ? [kindLabel] : []), item.date, statusLabel].join(' · '),
    target: { type: 'manager_desk_item', view: 'desk', managerDeskItemId: item.itemId, date: item.date },
  };
}

const TRACKER_STATE_LABELS: Record<GlobalSearchTrackerItem['state'], string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  done: 'Done',
  dropped: 'Dropped',
};

export function taskToPaletteItem(task: GlobalSearchTaskItem, index: number): PaletteItem {
  const context = [task.taskKey];
  if (task.developerName) {
    context.push(task.developerName);
  }
  if (task.state) {
    context.push(TRACKER_STATE_LABELS[task.state] ?? task.state);
  } else if (task.status) {
    context.push(task.status === 'done' ? 'Done' : task.status.replace(/_/g, ' '));
  }
  if (task.excerpt) {
    context.push(task.excerpt);
  }
  const target: TodayActionTarget =
    task.kind === 'desk_only'
      ? { type: 'manager_desk_item', view: 'desk', taskKey: task.taskKey }
      : { type: 'tracker_item', view: 'team', taskKey: task.taskKey };
  return {
    id: `task-${task.taskKey}-${index}`,
    group: 'tasks',
    title: task.title,
    description: context.join(' · '),
    keywords: `${task.taskKey} ${task.taskKey.toLowerCase()} task`,
    target,
  };
}

export function trackerItemToPaletteItem(item: GlobalSearchTrackerItem, index: number): PaletteItem {
  const context = [item.developerName, item.date, TRACKER_STATE_LABELS[item.state] ?? item.state];
  if (item.jiraKey) {
    context.unshift(item.jiraKey);
  }
  return {
    id: `tracker-${item.itemId}-${index}`,
    group: 'tracker',
    title: item.title,
    description: context.join(' · '),
    keywords: [item.jiraKey, ...(item.relatedIssueKeys ?? []), item.developerName].filter(Boolean).join(' '),
    target: {
      type: 'tracker_item',
      view: 'team',
      trackerItemId: item.itemId,
      developerAccountId: item.developerAccountId,
      managerDeskItemId: item.managerDeskItemId,
      date: item.date,
    },
  };
}

export function checkInToPaletteItem(checkIn: GlobalSearchCheckInItem, index: number): PaletteItem {
  return {
    id: `checkin-${checkIn.checkInId}-${index}`,
    group: 'checkins',
    title: checkIn.summary,
    description: [checkIn.developerName, checkIn.date].join(' · '),
    target: { type: 'developer', view: 'team', developerAccountId: checkIn.developerAccountId },
  };
}

export function developerToPaletteItem(developer: GlobalSearchDeveloperItem, index: number): PaletteItem {
  return {
    id: `developer-${developer.accountId}-${index}`,
    group: 'developers',
    title: developer.displayName,
    description: developer.email ?? developer.accountId,
    target: { type: 'developer', view: 'team', developerAccountId: developer.accountId },
  };
}

export function noteToPaletteItem(note: DailyNoteSummary, index: number): PaletteItem {
  const dateLabel = isValidIsoDate(note.date) ? format(parseISO(note.date), 'MMM d') : note.date;
  return {
    id: `note-${note.id}-${index}`,
    group: 'notes',
    title: note.title || 'Daily note',
    description: note.excerpt ? `${dateLabel} · ${note.excerpt}` : dateLabel,
    target: { type: 'view', view: 'notes', date: note.date },
  };
}

export function buildResultGroups(results: {
  issues: GlobalSearchIssueItem[];
  deskItems: GlobalSearchDeskItem[];
  trackerItems?: GlobalSearchTrackerItem[];
  tasks?: GlobalSearchTaskItem[];
  checkIns: GlobalSearchCheckInItem[];
  developers: GlobalSearchDeveloperItem[];
  notes?: DailyNoteSummary[];
}, options?: { showTaxonomy?: boolean }): PaletteGroup[] {
  const groups: PaletteGroup[] = [
    {
      id: 'tasks',
      label: 'Tasks',
      items: (results.tasks ?? []).map(taskToPaletteItem),
    },
    {
      id: 'issues',
      label: 'Work items',
      items: results.issues.map(issueToPaletteItem),
    },
    {
      id: 'desk',
      label: 'Desk items & follow-ups',
      items: results.deskItems.map((item, index) => deskItemToPaletteItem(item, index, options)),
    },
    {
      id: 'tracker',
      label: 'Tracker tasks',
      items: (results.trackerItems ?? []).map(trackerItemToPaletteItem),
    },
    {
      id: 'checkins',
      label: 'Check-ins',
      items: results.checkIns.map(checkInToPaletteItem),
    },
    {
      id: 'developers',
      label: 'Developers',
      items: results.developers.map(developerToPaletteItem),
    },
    {
      id: 'notes',
      label: 'Notes',
      items: (results.notes ?? []).map(noteToPaletteItem),
    },
  ];
  return groups.filter((group) => group.items.length > 0);
}
