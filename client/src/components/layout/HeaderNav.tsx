import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Home, MoreHorizontal, type LucideIcon } from 'lucide-react';
import type { ActiveAppView, AppView } from '@/App';
import { WorkspaceNavLink } from '@/components/layout/WorkspaceNavLink';
import { useNavPreferences } from '@/hooks/useNavPreferences';
import { NAV_PAGE_META } from '@/lib/nav-pages';
import type { NavPageId } from '@/types';

// Developers keep the fixed lean layout; only managers can customize the nav.
const DEVELOPER_TOP_NAV: NavPageId[] = ['work', 'team'];

interface HeaderNavProps {
  activeView?: ActiveAppView;
  isManager: boolean;
  onViewChange: (view: AppView) => void;
}

export function HeaderNav({ activeView, isManager, onViewChange }: HeaderNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const closeMoreTimeoutRef = useRef<number | null>(null);
  const { preferences } = useNavPreferences();
  const topPages = isManager ? preferences.topNav : DEVELOPER_TOP_NAV;
  const morePages = isManager ? preferences.moreNav : [];
  const moreIsActive = morePages.some((id) => Boolean(activeView && NAV_PAGE_META[id].matches.includes(activeView)));

  const clearCloseMoreTimeout = () => {
    if (closeMoreTimeoutRef.current === null) {
      return;
    }
    window.clearTimeout(closeMoreTimeoutRef.current);
    closeMoreTimeoutRef.current = null;
  };

  const openMore = () => {
    clearCloseMoreTimeout();
    setMoreOpen(true);
  };

  const closeMore = () => {
    clearCloseMoreTimeout();
    setMoreOpen(false);
  };

  const scheduleCloseMore = () => {
    clearCloseMoreTimeout();
    closeMoreTimeoutRef.current = window.setTimeout(() => {
      closeMoreTimeoutRef.current = null;
      setMoreOpen(false);
    }, 180);
  };

  useEffect(() => {
    if (!moreOpen) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (moreRef.current?.contains(target)) {
        return;
      }
      if (closeMoreTimeoutRef.current !== null) {
        window.clearTimeout(closeMoreTimeoutRef.current);
        closeMoreTimeoutRef.current = null;
      }
      setMoreOpen(false);
    };

    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [moreOpen]);

  useEffect(() => {
    if (morePages.length === 0) {
      setMoreOpen(false);
    }
  }, [morePages.length]);

  useEffect(() => {
    return () => {
      clearCloseMoreTimeout();
    };
  }, []);

  return (
    <nav
      aria-label="Workspace navigation"
      className="flex min-w-0 items-center gap-0.5 rounded-xl p-0.5"
      style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}
    >
      <WorkspaceNavLink
        label="Today"
        icon={Home}
        active={activeView === 'today'}
        accentColor="var(--accent)"
        onClick={() => onViewChange('today')}
        newTabHref="/"
        newTabLabel="Open Today in new tab"
      />
      {topPages.map((id) => {
        const meta = NAV_PAGE_META[id];
        return (
          <WorkspaceNavLink
            key={id}
            label={meta.label}
            icon={meta.icon}
            active={Boolean(activeView && meta.matches.includes(activeView))}
            accentColor={meta.accentColor}
            onClick={() => onViewChange(meta.view)}
            newTabHref={meta.href}
            newTabLabel={`Open ${meta.label} in new tab`}
          />
        );
      })}
      {isManager && morePages.length > 0 && (
        <div
          className="relative"
          ref={moreRef}
          onMouseEnter={openMore}
          onMouseLeave={scheduleCloseMore}
        >
          <button
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            className="flex h-8 min-w-[48px] items-center justify-center gap-1.5 rounded-lg px-3 text-[12px] font-medium transition-colors"
            style={{
              background: moreIsActive ? 'var(--bg-elevated)' : 'transparent',
              color: moreIsActive ? 'var(--accent)' : 'var(--text-muted)',
              boxShadow: moreIsActive ? 'var(--soft-shadow)' : 'none',
            }}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            aria-label="More workspaces"
          >
            <MoreHorizontal size={13} className="shrink-0" />
            <span className="hidden sm:inline">More</span>
          </button>

          {moreOpen && (
            <div className="absolute right-0 top-full z-[320] w-48 pt-1.5">
              <div
                role="menu"
                className="overflow-hidden rounded-xl border p-1 shadow-2xl"
                style={{
                  borderColor: 'var(--border)',
                  background: 'color-mix(in srgb, var(--bg-secondary) 96%, transparent)',
                }}
              >
                {morePages.map((id) => {
                  const meta = NAV_PAGE_META[id];
                  return (
                    <MoreMenuItem
                      key={id}
                      label={meta.label}
                      icon={meta.icon}
                      active={Boolean(activeView && meta.matches.includes(activeView))}
                      accentColor={meta.accentColor}
                      onClick={() => {
                        onViewChange(meta.view);
                        closeMore();
                      }}
                      newTabHref={meta.href}
                      newTabLabel={`Open ${meta.label} in new tab`}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

interface MoreMenuItemProps {
  label: string;
  icon: LucideIcon;
  active: boolean;
  accentColor: string;
  onClick: () => void;
  newTabHref: string;
  newTabLabel: string;
}

function MoreMenuItem({ label, icon: Icon, active, accentColor, onClick, newTabHref, newTabLabel }: MoreMenuItemProps) {
  return (
    <div className="workspace-nav-chip relative">
      <button
        type="button"
        role="menuitem"
        onClick={onClick}
        className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 pr-9 text-left text-[12px] font-medium transition-colors"
        style={{
          color: active ? accentColor : 'var(--text-secondary)',
          background: active ? 'var(--bg-elevated)' : 'transparent',
        }}
      >
        <Icon size={13} className="shrink-0" />
        <span className="truncate">{label}</span>
      </button>
      {!active && (
        <a
          href={newTabHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={newTabLabel}
          title={newTabLabel}
          className="workspace-nav-new-tab absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-active)]"
          style={{ color: 'var(--text-muted)' }}
        >
          <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}
