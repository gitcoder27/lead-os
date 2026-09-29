import { Briefcase, ClipboardList, NotebookPen, Users, type LucideIcon } from 'lucide-react';
import type { ActiveAppView, AppView } from '@/App';
import type { NavPageId, NavPreferences } from '@/types';

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
    // docs/54 §1.7: Tasks is a cyan surface; amber stays with the legacy Desk.
    accentColor: 'var(--accent)',
    href: '/tasks',
    matches: ['desk', 'manager-desk'],
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
};

/** Which optional pages have something to show yet. */
export interface NavAvailability {
  /** The roster has at least one active person. */
  team: boolean;
  /** Jira is connected (or its state is not known yet). */
  work: boolean;
}

/** Shown next to a page in Settings while it is held back. */
export const NAV_UNAVAILABLE_HINT: Partial<Record<NavPageId, string>> = {
  team: 'Appears once you add people.',
  work: 'Appears once Jira is connected.',
};

/**
 * docs/56 P2-04: a solo manager sees Today | Tasks | Notes. Team and Work are
 * held back (not removed from the saved layout) until there is a roster or a
 * Jira connection, and their pages stay reachable by URL and the palette.
 */
export function applyNavAvailability(preferences: NavPreferences, availability: NavAvailability): NavPreferences {
  const held = (id: NavPageId) => (id === 'team' && !availability.team) || (id === 'work' && !availability.work);
  return {
    topNav: preferences.topNav.filter((id) => !held(id)),
    moreNav: preferences.moreNav.filter((id) => !held(id)),
    hidden: preferences.hidden,
  };
}
