import type { TeamMode } from '@/types';

/** Small descriptors only: importing help must not load a page or its editor. */
export interface ShortcutGroup {
  group?: string;
  keys: Array<[string, string]>;
}

export type ShortcutPlatform = 'mac' | 'other';

export function shortcutPlatform(): ShortcutPlatform {
  if (typeof navigator === 'undefined') return 'other';
  const info = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = info.userAgentData?.platform || info.platform || info.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(platform) ? 'mac' : 'other';
}

export function formatShortcutKeys(keys: string, platform = shortcutPlatform()): string {
  if (platform === 'mac') return keys;
  return keys.replace(/⌘-?/g, 'Ctrl+').replace(/⌥/g, 'Alt+').replace(/⇧/g, 'Shift+');
}

/** A visible keyboard layer owns help, including menus whose trigger retains focus. */
export function shortcutLayerOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [aria-modal="true"], [data-popover-layer], [data-testid="standup-mode"]'));
}

export function shouldIgnoreShortcutHelp(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey || shortcutLayerOpen()) return true;
  const editable = (target: EventTarget | null) => target instanceof Element &&
    Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
  return editable(event.target) || editable(document.activeElement);
}

export function globalShortcuts(copilotAvailable: boolean): ShortcutGroup {
  return { group: 'Global', keys: [
    ['⌘ I', 'Quick capture'], ['⌘ K', 'Command palette'],
    ...(copilotAvailable ? [['⌘ J', 'Toggle Copilot'] as [string, string]] : []),
    ['?', 'Keyboard shortcuts'], ['Esc', 'Close this sheet'],
  ] };
}

export const NOTE_ACTION_SHORTCUTS = {
  task: { key: 'Mod-Shift-e', label: '⌘⇧E' },
  update: { key: 'Mod-Shift-u', label: '⌘⇧U' },
  'follow-up': { key: 'Mod-Shift-l', label: '⌘⇧L' },
};

export const TASK_SHORTCUTS: ShortcutGroup[] = [
  {
    group: 'Move',
    keys: [
      ['j / k', 'Next / previous task'],
      ['Enter / o', 'Open task'],
      ['x', 'Select / deselect'],
      ['⇧ j / ⇧ k', 'Extend selection'],
      ['⌥ ↑ / ⌥ ↓', 'Reorder within the day'],
    ],
  },
  {
    group: 'Act',
    keys: [
      ['e', 'Toggle done'],
      ['Space', 'Activate focused control'],
      ['s', 'Schedule — then t m w l c or 1–7'],
      ['a', 'Assign'],
      ['l', 'Labels'],
      ['p', 'Priority'],
      ['w', 'Waiting on…'],
      ['c', 'Check-by date'],
      ['#', 'Drop'],
      ['n', 'New task in this group'],
      ['z', 'Undo last change'],
    ],
  },
  {
    group: 'Views',
    keys: [
      ['g → t', 'Planned today'],
      ['g → i', 'Inbox'],
      ['g → m', 'My tasks'],
      ['g → w', 'Waiting'],
      ['g → e', 'Meetings'],
      ['g → l', 'Later'],
      ['g → h', 'High priority'],
      ['g → a', 'Needs attention'],
      ['g → c', 'Closed'],
      ['/', 'Search'],
      ['?', 'This sheet'],
      ['Esc', 'Close menu, clear selection, clear search'],
    ],
  },
];

export const teamBoardShortcuts = (teamMode: TeamMode): ShortcutGroup[] => [
  { group: 'Board', keys: [['j / k', 'Next / previous person'], ['Enter / o', 'Open their drawer'], ['/', 'Search']] },
  { group: 'Day', keys: [['[ / ]', 'Previous / next day'], ['t', 'Today'], ['?', 'This sheet']] },
  { group: 'In the drawer', keys: [['⇧ s', 'Status'], ['n', 'New task'], ['u', 'Update'], ['c', teamMode === 'solo' ? 'Note' : 'Check-in'], ['Esc', 'Close']] },
];

export const TODAY_TRIAGE_KEYS: Array<{ keys: string[]; label: string }> = [
  { keys: ['j', 'k', '↓', '↑'], label: 'Move down / up' },
  { keys: ['Enter'], label: 'Open (a focused button keeps its own action)' },
  { keys: ['e'], label: 'Primary action' },
  { keys: ['Space'], label: 'Primary action when no button is focused' },
  { keys: ['s'], label: 'Snooze to tomorrow' },
  { keys: ['f'], label: 'Follow up' },
  { keys: ['c'], label: 'Check-in' },
  { keys: ['z'], label: 'Undo' },
];

export const NOTES_SHORTCUTS: ShortcutGroup[] = [
  {
    group: 'Turn a line into',
    keys: [
      [NOTE_ACTION_SHORTCUTS.task.label, 'A task'],
      [NOTE_ACTION_SHORTCUTS.update.label, 'An update on a task'],
      [NOTE_ACTION_SHORTCUTS['follow-up'].label, 'A follow-up'],
    ],
  },
  {
    group: 'Write',
    keys: [
      ['/', 'Commands (at line start)'],
      ['@ · T- · #', 'Mention a person · task · Jira issue'],
      ['⌘-click', 'Open a chip'],
      ['⌘S', 'Save now'],
    ],
  },
  {
    group: 'Day',
    keys: [
      ['⌥ [ / ⌥ ] / ⌥ ↑ / ⌥ ↓', 'Previous / next day'],
      ['⌥T', 'Today'],
      ['⌘⇧F', 'Search notes'],
      ['⌘⏎', 'Wrap up the day'],
      ['?', 'This sheet'],
    ],
  },
];

export function todayShortcuts(teamMode: TeamMode): ShortcutGroup[] {
  return [{ group: 'Today queue', keys: [
    ...TODAY_TRIAGE_KEYS.filter((entry) => teamMode === 'collab' || !entry.keys.includes('c'))
      .map((entry): [string, string] => [entry.keys.join(' / '), entry.label]),
    ['?', 'This sheet'],
  ] }];
}

export function pageShortcuts(page: string, teamMode: TeamMode): ShortcutGroup[] {
  switch (page) {
    case 'today': return todayShortcuts(teamMode);
    case 'tasks': return TASK_SHORTCUTS;
    case 'team': return teamBoardShortcuts(teamMode);
    case 'notes': return NOTES_SHORTCUTS;
    default: return [];
  }
}
