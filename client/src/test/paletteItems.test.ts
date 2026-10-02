import { describe, expect, it } from 'vitest';
import type { DailyNoteSummary, GlobalSearchCheckInItem, GlobalSearchDeskItem, GlobalSearchDeveloperItem, GlobalSearchIssueItem, GlobalSearchTaskItem } from '@/types';
import {
  buildNavigationCommands,
  buildQuickActions,
  buildQuickAddItem,
  buildResultGroups,
  buildTaskViewCommands,
  checkInToPaletteItem,
  deskItemToPaletteItem,
  developerToPaletteItem,
  filterCommands,
  issueToPaletteItem,
  noteToPaletteItem,
  pinExactTaskKey,
  placeQuickAddItem,
  QUICK_ADD_MIN_QUERY_LENGTH,
  taskToPaletteItem,
} from '@/components/palette/paletteItems';

const issue: GlobalSearchIssueItem = {
  jiraKey: 'PROJ-1',
  summary: 'Payment provider timeouts',
  statusName: 'In Progress',
  statusCategory: 'indeterminate',
  priorityName: 'High',
  assigneeName: 'Priya',
  dueDate: '2026-03-10',
  updatedAt: '2026-03-05T00:00:00.000Z',
};

const deskItem: GlobalSearchDeskItem = {
  itemId: 12,
  date: '2026-03-06',
  title: 'Follow up on payment bug',
  kind: 'action',
  category: 'follow_up',
  status: 'planned',
  updatedAt: '2026-03-06T00:00:00.000Z',
};

const checkIn: GlobalSearchCheckInItem = {
  checkInId: 33,
  date: '2026-03-07',
  developerAccountId: 'dev-1',
  developerName: 'Alice Smith',
  summary: 'Blocked on gateway keys',
  status: 'blocked',
  createdAt: '2026-03-07T08:00:00.000Z',
};

const developer: GlobalSearchDeveloperItem = {
  accountId: 'dev-1',
  displayName: 'Alice Smith',
  email: 'alice@example.com',
};

const task: GlobalSearchTaskItem = {
  taskKey: 'T-5',
  title: 'Fix login bug',
  kind: 'delegated',
  developerName: 'Bob Jones',
  state: 'in_progress',
  matchedIn: 'key',
  updatedAt: '2026-03-07T08:00:00.000Z',
};

const deskOnlyTask: GlobalSearchTaskItem = {
  taskKey: 'T-9',
  title: 'Renew vendor contract',
  kind: 'desk_only',
  status: 'in_progress',
  matchedIn: 'title',
  updatedAt: '2026-03-07T08:00:00.000Z',
};

const dailyNote: DailyNoteSummary = {
  id: 9,
  date: '2026-03-08',
  kind: 'scratchpad',
  title: 'Retro prep thoughts',
  excerpt: 'Draft agenda for Thursday retro',
  updatedAt: '2026-03-08T09:00:00.000Z',
};

describe('palette item builders', () => {
  it('opens Copy weekly update at Send update without completing anything', () => {
    const commands = buildNavigationCommands({ tasksPhase3: true });
    expect(commands.find((command) => command.id === 'action-copy-weekly-update')?.href).toBe('/?mode=review&step=send');
    expect(buildNavigationCommands({ tasksPhase3: false }).some((command) => command.id === 'action-copy-weekly-update')).toBe(false);
  });

  it('maps an issue to a work target', () => {
    const item = issueToPaletteItem(issue, 0);

    expect(item.target).toEqual({ type: 'issue', view: 'work', issueKey: 'PROJ-1' });
    expect(item.title).toBe('Payment provider timeouts');
    expect(item.description).toContain('PROJ-1');
  });

  it('maps a desk item to a dated desk target', () => {
    const item = deskItemToPaletteItem(deskItem, 0);

    expect(item.target).toEqual({
      type: 'manager_desk_item',
      view: 'desk',
      managerDeskItemId: 12,
      date: '2026-03-06',
    });
    expect(item.description).toContain('2026-03-06');
  });

  it('maps a check-in to the developer day target', () => {
    const item = checkInToPaletteItem(checkIn, 0);

    expect(item.target).toEqual({
      type: 'developer',
      view: 'team',
      developerAccountId: 'dev-1',
    });
    expect(item.title).toBe('Blocked on gateway keys');
  });

  it('maps a developer to the team target', () => {
    const item = developerToPaletteItem(developer, 0);

    expect(item.target).toEqual({
      type: 'developer',
      view: 'team',
      developerAccountId: 'dev-1',
    });
    expect(item.description).toBe('alice@example.com');
  });

  it('maps a note summary to the notes day target', () => {
    const item = noteToPaletteItem(dailyNote, 0);

    expect(item.target).toEqual({ type: 'view', view: 'notes', date: '2026-03-08', kind: 'scratchpad' });
    expect(item.title).toBe('Retro prep thoughts');
    expect(item.description).toContain('Mar 8');
    expect(item.description).toContain('Draft agenda');
  });

  it('maps a tracker task to a team target keyed by task key', () => {
    const item = taskToPaletteItem(task, 0);

    expect(item.group).toBe('tasks');
    expect(item.target).toEqual({ type: 'tracker_item', view: 'team', taskKey: 'T-5' });
    expect(item.title).toBe('Fix login bug');
    expect(item.description).toContain('T-5');
    expect(item.description).toContain('Bob Jones');
    expect(item.keywords).toContain('T-5');
  });

  it('maps a desk-only task to a desk target keyed by task key', () => {
    const item = taskToPaletteItem(deskOnlyTask, 1);

    expect(item.target).toEqual({ type: 'manager_desk_item', view: 'desk', taskKey: 'T-9' });
    expect(item.id).toBe('task-T-9-1');
  });

  it('builds result groups with only non-empty groups', () => {
    const groups = buildResultGroups({
      issues: [issue],
      deskItems: [],
      checkIns: [checkIn],
      developers: [],
    });

    expect(groups.map((group) => group.id)).toEqual(['issues', 'checkins']);
  });

  it('places the tasks group first when present', () => {
    const groups = buildResultGroups({
      issues: [issue],
      deskItems: [],
      tasks: [task],
      trackerItems: [],
      checkIns: [checkIn],
      developers: [],
    });

    expect(groups.map((group) => group.id)).toEqual(['tasks', 'issues', 'checkins']);
    expect(groups[0].items[0].id).toBe('task-T-5-0');
  });

  it('includes a notes group when note results are present', () => {
    const groups = buildResultGroups({
      issues: [],
      deskItems: [],
      checkIns: [],
      developers: [],
      notes: [dailyNote],
    });

    expect(groups.map((group) => group.id)).toEqual(['notes']);
    expect(groups[0].items[0].target).toEqual({ type: 'view', view: 'notes', date: '2026-03-08', kind: 'scratchpad' });
  });
});

describe('palette commands', () => {
  it('drops "Start Jira sync" only when Jira is known not to be connected (docs/56 P2-03)', () => {
    const has = (options?: Parameters<typeof buildQuickActions>[0]) => buildQuickActions(options).some((command) => command.actionId === 'sync');
    expect(has()).toBe(true);
    expect(has({ jiraConfigured: true })).toBe(true);
    expect(has({ jiraConfigured: false })).toBe(false);
    expect(buildQuickActions({ jiraConfigured: false }).map((command) => command.actionId)).toEqual(['capture', 'capture-note']);
  });

  it('offers navigation for every surface plus quick actions', () => {
    const navigation = buildNavigationCommands({ backups: true });
    const commands = [...navigation, ...buildQuickActions()];

    expect(commands.filter((command) => command.target || command.view).length).toBeGreaterThanOrEqual(6);
    expect(navigation.filter((command) => command.target).length).toBe(6);
    expect(commands.some((command) => command.actionId === 'capture')).toBe(true);
    expect(commands.some((command) => command.actionId === 'capture-note')).toBe(true);
    expect(commands.some((command) => command.actionId === 'sync')).toBe(true);
    expect(navigation.map((command) => command.view).filter(Boolean)).toEqual([
      'today',
      'work',
      'team',
      'desk',
      'notes',
      'settings',
    ]);
  });

  it('has a command that opens Settings → Data & Backups (docs/56 P6-01)', () => {
    const backups = buildNavigationCommands({ backups: true }).find((command) => command.id === 'nav-backups');

    expect(backups?.target).toEqual({ type: 'view', view: 'settings', section: 'data' });
    expect(filterCommands(buildNavigationCommands({ backups: true }), 'snapshot').map((command) => command.id)).toEqual(['nav-backups']);
  });

  it('leaves the backups command out unless the session may manage backups (P6-01 review)', () => {
    expect(buildNavigationCommands().some((command) => command.id === 'nav-backups')).toBe(false);
    expect(buildNavigationCommands({ backups: false }).some((command) => command.id === 'nav-backups')).toBe(false);
  });

  it('filters commands across title and keywords', () => {
    const commands = [...buildNavigationCommands(), ...buildQuickActions()];

    expect(filterCommands(commands, 'jira').map((command) => command.id)).toEqual([
      'action-sync',
      'nav-work',
      'nav-settings',
    ]);
    expect(filterCommands([...buildNavigationCommands({ tasksPhase3: true }), ...buildQuickActions()], 'delegated').map((command) => command.id)).toEqual(['nav-waiting']);
    expect(filterCommands(commands, 'zzz')).toEqual([]);
  });

  it('ranks title matches above keyword-only matches', () => {
    const commands = [...buildNavigationCommands(), ...buildQuickActions()];

    expect(filterCommands(commands, 'note')[0].id).toBe('nav-notes');
    expect(filterCommands(commands, 'capture')[0].id).toBe('action-capture');
  });

  it('no longer lets Desk or Meetings hijack capture and note keywords', () => {
    const commands = [...buildNavigationCommands(), ...buildQuickActions()];

    expect(filterCommands(commands, 'note').map((command) => command.id)).toEqual(['nav-notes', 'action-capture-note']);
    expect(filterCommands(commands, 'capture').map((command) => command.id)).toEqual(['action-capture', 'action-capture-note']);
  });
});

describe('quick-add to Desk', () => {
  it('returns null for queries shorter than the minimum length', () => {
    expect(buildQuickAddItem('')).toBeNull();
    expect(buildQuickAddItem('   ')).toBeNull();
    expect(buildQuickAddItem('ab')).toBeNull();
    expect(buildQuickAddItem(' a ')).toBeNull();
    expect(QUICK_ADD_MIN_QUERY_LENGTH).toBe(3);
  });

  it('builds an add row from the trimmed query', () => {
    const item = buildQuickAddItem('  follow up with Priya about payment bug  ');

    expect(item).toMatchObject({
      id: 'quick-add-desk',
      group: 'actions',
      title: 'Add to Desk',
      actionId: 'quick-add-desk',
    });
    expect(item?.description).toBe('"follow up with Priya about payment bug" · today\'s inbox');
    expect(item?.target).toBeUndefined();
  });

  it('places the add row first when it is the only row', () => {
    const quickAdd = buildQuickAddItem('follow up with Priya about pricing')!;

    expect(placeQuickAddItem([], quickAdd)).toEqual([quickAdd]);
  });

  it('pins the add row last when other rows exist', () => {
    const quickAdd = buildQuickAddItem('payment')!;
    const results = [...buildNavigationCommands().slice(0, 2)];

    const rows = placeQuickAddItem(results, quickAdd);

    expect(rows).toHaveLength(3);
    expect(rows[rows.length - 1]?.id).toBe('quick-add-desk');
    expect(rows[0].id).toBe('nav-today');
  });

  it('leaves rows untouched when quick add is unavailable', () => {
    const results = buildNavigationCommands().slice(0, 2);

    expect(placeQuickAddItem(results, null)).toBe(results);
  });

  it('pins the add row last when command matches exist for the same query', () => {
    const quickAdd = buildQuickAddItem('work items')!;
    const commandRows = filterCommands([...buildNavigationCommands(), ...buildQuickActions()], 'work');

    expect(commandRows.length).toBeGreaterThan(0);
    const rows = placeQuickAddItem(commandRows, quickAdd);

    expect(rows[rows.length - 1]?.id).toBe('quick-add-desk');
    expect(rows.filter((row) => row.id === 'quick-add-desk')).toHaveLength(1);
  });
});

describe('exact task-key pinning', () => {
  it('pins the matching task row ahead of commands and quick-add', () => {
    const rows = [
      ...buildNavigationCommands().slice(0, 2),
      taskToPaletteItem(task, 0),
      taskToPaletteItem(deskOnlyTask, 1),
    ];
    const placed = placeQuickAddItem(rows, buildQuickAddItem('T-5'));

    const pinned = pinExactTaskKey(placed, 'T-5');

    expect(pinned[0].id).toBe('task-T-5-0');
    expect(pinned[pinned.length - 1]?.id).toBe('quick-add-desk');
    expect(pinned).toHaveLength(placed.length);
  });

  it('matches lowercase keys against canonical row ids', () => {
    const rows = [taskToPaletteItem(task, 0)];

    expect(pinExactTaskKey(rows, 't-5')[0].id).toBe('task-T-5-0');
  });

  it('leaves rows untouched when the query is not a task key or no task matches', () => {
    const rows = [taskToPaletteItem(task, 0), ...buildNavigationCommands().slice(0, 1)];

    expect(pinExactTaskKey(rows, 'login')).toBe(rows);
    expect(pinExactTaskKey(rows, 'T-99')).toBe(rows);
    expect(pinExactTaskKey(rows, '')).toBe(rows);
  });
});

describe('Waiting and Meetings are Tasks views (docs/57 P3-06)', () => {
  it('has Go to Waiting and Go to Meetings under Phase 3, opening the Tasks lenses', () => {
    const commands = buildNavigationCommands({ tasksPhase3: true });
    expect(commands.find((command) => command.id === 'nav-waiting')).toMatchObject({ title: 'Go to Waiting', href: '/tasks?view=waiting' });
    expect(commands.find((command) => command.id === 'nav-meetings')).toMatchObject({ title: 'Go to Meetings', href: '/tasks?view=meetings' });
    // Neither is an app view of its own any more.
    expect(commands.filter((command) => command.id === 'nav-waiting' || command.id === 'nav-meetings').every((command) => !command.view && !command.target)).toBe(true);
  });

  it('finds Waiting by its old and new names', () => {
    const commands = buildNavigationCommands({ tasksPhase3: true });
    expect(commands.find((command) => command.id === 'nav-waiting')?.description).toBe('Tasks · Waiting');
    for (const query of ['follow-ups', 'followups', 'promises', 'delegated', 'waiting']) {
      expect(filterCommands(commands, query).map((command) => command.id)).toContain('nav-waiting');
    }
    expect(filterCommands(commands, 'minutes').map((command) => command.id)).toContain('nav-meetings');
  });

  it('has neither command without Phase 3, where there is no Tasks page to open', () => {
    expect(buildNavigationCommands().some((command) => command.id === 'nav-waiting' || command.id === 'nav-meetings')).toBe(false);
  });

  it('does not list the two built-in views a second time as "Tasks: …"', () => {
    const views = [
      { id: 'waiting', name: 'Waiting / Delegated', builtin: true, definition: {} },
      { id: 'meetings', name: 'Meetings', builtin: true, definition: {} },
      { id: 'inbox', name: 'Inbox', builtin: true, definition: {} },
      { id: 'saved:3', name: 'Meetings', builtin: false, definition: {} },
    ];
    expect(buildTaskViewCommands(views).map((command) => command.id)).toEqual(['taskview-inbox', 'taskview-saved:3']);
  });

  it('the capture hint mentions waiting, not follow-ups', () => {
    expect(buildQuickActions({ tasksPhase3: true }).find((command) => command.id === 'action-capture')?.description).toBe('Tasks, waiting, notes');
  });
});

describe('Weekly review (docs/59 §5.1)', () => {
  it('has a Weekly review command under Phase 3 that opens the review mode of Today', () => {
    const commands = buildNavigationCommands({ tasksPhase3: true });
    expect(commands.find((command) => command.id === 'action-weekly-review')).toMatchObject({ title: 'Weekly review', href: '/?mode=review' });
    for (const query of ['weekly', 'friday', 'review', 'retro']) {
      expect(filterCommands(commands, query).map((command) => command.id), query).toContain('action-weekly-review');
    }
  });

  it('has no such command without the Tasks workspace', () => {
    expect(buildNavigationCommands().some((command) => command.id === 'action-weekly-review')).toBe(false);
  });
});
