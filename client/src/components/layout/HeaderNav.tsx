import { useEffect, useRef, useState } from 'react';
import { Home, MoreHorizontal } from 'lucide-react';
import type { ActiveAppView, AppView } from '@/App';
import { interceptWorkspaceLink, WorkspaceNavLink } from './WorkspaceNavLink';
import { useNavPreferences } from '@/hooks/useNavPreferences';
import { useNavAvailability } from '@/hooks/useNavAvailability';
import { TodayCountBadge } from './TodayCountLink';
import { NAV_PAGE_META, applyNavAvailability } from '@/lib/nav-pages';
import { Popover } from '@/components/ui/Popover';
import type { NavPageId } from '@/types';

const DEVELOPER_TOP_NAV: NavPageId[] = ['work', 'team'];
interface HeaderNavProps { activeView?: ActiveAppView; isManager: boolean; onViewChange: (view: AppView) => void }

export function HeaderNav({ activeView, isManager, onViewChange }: HeaderNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const { preferences: saved } = useNavPreferences();
  const availability = useNavAvailability();
  const preferences = applyNavAvailability(saved, availability);
  const topPages = isManager ? preferences.topNav : DEVELOPER_TOP_NAV;
  const morePages = isManager ? preferences.moreNav : [];
  useEffect(() => { if (morePages.length === 0) setMoreOpen(false); }, [morePages.length]);
  const moreIsActive = morePages.some((id) => Boolean(activeView && NAV_PAGE_META[id].matches.includes(activeView)));
  return (
    <nav aria-label="Workspace navigation" className="flex min-w-0 flex-wrap items-center gap-0.5">
      <WorkspaceNavLink label="Today" icon={Home} active={activeView === 'today'} accentColor="var(--accent)" onClick={() => onViewChange('today')} href="/"
        badge={isManager && activeView !== 'today' ? <TodayCountBadge /> : undefined} />
      {topPages.map((id) => {
        const meta = NAV_PAGE_META[id];
        return <WorkspaceNavLink key={id} label={meta.label} icon={meta.icon} active={Boolean(activeView && meta.matches.includes(activeView))} accentColor={meta.accentColor} onClick={() => onViewChange(meta.view)} href={meta.href} />;
      })}
      {isManager && morePages.length > 0 && (
        <>
          <button ref={moreRef} type="button" onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen} aria-haspopup="menu" aria-label="More workspaces"
            className="header-ghost flex min-h-8 min-w-8 items-center justify-center gap-1 rounded-lg px-2 text-[12.5px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
            style={moreIsActive || moreOpen ? { background: 'var(--bg-tertiary)', color: moreIsActive ? 'var(--accent-text)' : 'var(--text-primary)' } : undefined}>
            <MoreHorizontal size={13} /><span className="hidden sm:inline">More</span>
          </button>
          {moreOpen && <Popover anchor={moreRef.current} onClose={() => setMoreOpen(false)} label="More workspaces" width={192}>
            {morePages.map((id) => {
              const meta = NAV_PAGE_META[id]; const Icon = meta.icon;
              return <a key={id} href={meta.href} role="menuitem" onClick={(event) => interceptWorkspaceLink(event, () => { onViewChange(meta.view); setMoreOpen(false); })}
                className="flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-[12px] hover:bg-[var(--bg-tertiary)] focus-visible:bg-[var(--bg-tertiary)] focus-visible:outline-none" style={{ color: 'var(--text-secondary)' }}>
                <Icon size={13} /><span>{meta.label}</span>
              </a>;
            })}
          </Popover>}
        </>
      )}
    </nav>
  );
}
