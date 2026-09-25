import { Bell, Briefcase, CalendarDays, ClipboardList, NotebookPen, Users, type LucideIcon } from 'lucide-react';
import type { ActiveAppView, AppView } from '@/App';
import type { NavPageId } from '@/types';

export interface NavPageMeta {
  id: NavPageId;
  view: AppView;
  label: string;
  icon: LucideIcon;
  accentColor: string;
  href: string;
  matches: ActiveAppView[];
}

export const NAV_PAGE_META: Record<NavPageId, NavPageMeta> = {
  work: {
    id: 'work',
    view: 'work',
    label: 'Work',
    icon: ClipboardList,
    accentColor: 'var(--accent)',
    href: '/work',
    matches: ['work', 'dashboard'],
  },
  team: {
    id: 'team',
    view: 'team',
    label: 'Team',
    icon: Users,
    accentColor: 'var(--accent)',
    href: '/team',
    matches: ['team', 'team-tracker'],
  },
  desk: {
    id: 'desk',
    view: 'desk',
    label: 'Desk',
    icon: Briefcase,
    accentColor: 'var(--md-accent)',
    href: '/desk',
    matches: ['desk', 'manager-desk'],
  },
  // Phase 3 (P3-D1): the same page under its new name/path.
  tasks: {
    id: 'tasks',
    view: 'desk',
    label: 'Tasks',
    icon: Briefcase,
    accentColor: 'var(--md-accent)',
    href: '/tasks',
    matches: ['desk', 'manager-desk'],
  },
  'follow-ups': {
    id: 'follow-ups',
    view: 'follow-ups',
    label: 'Follow-ups',
    icon: Bell,
    accentColor: 'var(--warning)',
    href: '/follow-ups',
    matches: ['follow-ups'],
  },
  notes: {
    id: 'notes',
    view: 'notes',
    label: 'Notes',
    icon: NotebookPen,
    accentColor: 'var(--accent)',
    href: '/notes',
    matches: ['notes'],
  },
  meetings: {
    id: 'meetings',
    view: 'meetings',
    label: 'Meetings',
    icon: CalendarDays,
    accentColor: 'var(--accent)',
    href: '/meetings',
    matches: ['meetings'],
  },
};
