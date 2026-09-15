const VIEW_NAMES: Record<string, string> = {
  '/': 'Today',
  '/today': 'Today',
  '/work': 'Work',
  '/dashboard': 'Work',
  '/team': 'Team',
  '/team-tracker': 'Team',
  '/desk': 'Desk',
  '/manager-desk': 'Desk',
  '/follow-ups': 'Follow-ups',
  '/followups': 'Follow-ups',
  '/meetings': 'Meetings',
  '/meeting': 'Meetings',
  '/notes': 'Notes',
  '/settings': 'Settings',
  '/my-day': 'My Day',
};

/** Same keys collectPageContext sends — the label must mirror what the model actually sees. */
const DISPLAY_PARAMS = ['date', 'q', 'filter', 'dev', 'tag', 'view', 'sort', 'group', 'noTags'] as const;

/** "Work · filter=overdue" — friendly page name plus the active params sent as prompt context. */
export function viewingLabel(pathname: string, search: string): string {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const name = VIEW_NAMES[normalized] ?? normalized;
  const params = new URLSearchParams(search);
  const parts = DISPLAY_PARAMS.filter((key) => params.get(key)).map((key) =>
    key === 'noTags' ? key : `${key}=${params.get(key)}`,
  );
  return parts.length > 0 ? `${name} · ${parts.join(' · ')}` : name;
}
