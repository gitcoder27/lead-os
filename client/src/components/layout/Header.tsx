import { useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Search, Plus } from 'lucide-react';
import { CopilotMark } from '@/components/brand/CopilotMark';
import { useAuth } from '@/context/AuthContext';
import { useQuickActions } from '@/context/QuickActionsContext';
import { useAssistant } from '@/context/AssistantContext';
import type { ActiveAppView, AppView } from '@/App';
import type { ManagerActionTarget } from '@/types';
import type { GlobalCaptureContext } from '@/components/capture/GlobalCaptureDialog';
import { HeaderNav } from '@/components/layout/HeaderNav';
import { ManagerActionInbox } from '@/components/actions/ManagerActionInbox';
import { LeadOSMark } from '@/components/brand/LeadOSMark';
import { Kbd } from '@/components/ui/Kbd';
import { HeaderUserMenu } from '@/components/layout/HeaderUserMenu';
import { interceptWorkspaceLink } from '@/components/layout/WorkspaceNavLink';
import { formatShortcutKeys } from '@/lib/keyboard-shortcuts';

interface HeaderProps {
  activeView?: ActiveAppView;
  onViewChange?: (view: AppView) => void;
  onOpenActionTarget?: (target: ManagerActionTarget) => void;
  captureContext?: GlobalCaptureContext;
}

export function Header({ activeView, onViewChange, onOpenActionTarget, captureContext }: HeaderProps) {
  const { user, features } = useAuth();
  const { openCapture, openCommandPalette } = useQuickActions();
  const { isOpen: assistantOpen, toggle: toggleAssistant } = useAssistant();
  const headerRef = useRef<HTMLElement | null>(null);
  const canQuickCapture = user?.role === 'manager';
  const currentView = activeView ?? 'today';
  const defaultCaptureTarget = currentView === 'team' || currentView === 'team-tracker'
    ? 'team-tracker'
    : 'manager-desk';
  const openActionTarget = onOpenActionTarget ?? ((target: ManagerActionTarget) => {
    if (onViewChange) {
      onViewChange(target.view as AppView);
    }
  });

  useLayoutEffect(() => {
    const headerElement = headerRef.current;

    if (!headerElement || typeof document === 'undefined') {
      return undefined;
    }

    const rootStyle = document.documentElement.style;
    const updateHeaderHeight = () => {
      rootStyle.setProperty('--app-header-height', `${Math.ceil(headerElement.getBoundingClientRect().height)}px`);
    };

    updateHeaderHeight();
    window.addEventListener('resize', updateHeaderHeight);

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        window.removeEventListener('resize', updateHeaderHeight);
        rootStyle.removeProperty('--app-header-height');
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      updateHeaderHeight();
    });
    resizeObserver.observe(headerElement);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateHeaderHeight);
      rootStyle.removeProperty('--app-header-height');
    };
  }, []);

  return (
    <>
      {/* docs/73 UXD-06: the first stop on every page skips the header to the page's <main>. */}
      <a href="#main" className="skip-link">Skip to content</a>
      <motion.header
        ref={headerRef}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative z-header shrink-0 px-1 pt-0.5 md:px-1.5"
      >
        <div
          className="header-panel dashboard-panel rounded-[14px] px-2 py-1.5 md:px-2.5 flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between"
          style={{ borderColor: 'var(--border-strong)' }}
        >
          <div className="header-identity-nav flex min-w-0 flex-col gap-1.5 md:flex-row md:items-center md:gap-2 lg:gap-3">
            {/* The wordmark is a way home, not the page's heading: each page owns its one <h1>. */}
            <a
              href="/"
              className="header-brand header-wordmark flex min-w-0 items-center gap-2 rounded-xl md:gap-2.5"
              aria-label="LeadOS, go to Today"
              onClick={(event) => { if (onViewChange) interceptWorkspaceLink(event, () => onViewChange('today')); }}
            >
              <span className="h-8 w-8 md:h-11 md:w-11 rounded-[12px] flex items-center justify-center shrink-0" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
                <LeadOSMark size={32} />
              </span>
              <span className="font-sans text-title-sm font-semibold leading-tight truncate md:hidden lg:inline" style={{ color: 'var(--text-primary)' }}>
                LeadOS
              </span>
            </a>
            {onViewChange && (
              <div className="header-navigation min-w-0 overflow-visible">
                <HeaderNav activeView={activeView} isManager={user?.role === 'manager'} onViewChange={onViewChange} />
              </div>
            )}
          </div>

          <div className="header-actions flex min-w-0 items-center justify-between gap-2 md:justify-end lg:flex-1 lg:justify-between lg:gap-3">
            {/* One search field in the middle; below lg it collapses to an icon. */}
            {canQuickCapture && (
              <div className="flex lg:flex-1 lg:justify-center">
                <button
                  type="button"
                  onClick={() => openCommandPalette()}
                  className="header-search header-icon-btn lg:w-full lg:max-w-[420px] lg:justify-start lg:gap-2 lg:px-3 text-ui"
                  title={`Search and jump anywhere (${formatShortcutKeys('⌘K')})`}
                  aria-label="Open command palette"
                >
                  <Search size={14} className="shrink-0" />
                  <span className="hidden lg:inline">Search or jump to…</span>
                  <Kbd variant="bare" className="ml-auto hidden lg:inline">⌘K</Kbd>
                </button>
              </div>
            )}

            <div className="flex items-center gap-1 lg:gap-1.5">
              {/* docs/56 UX-30: Today's count rides on the nav's Today tab; the updates inbox shows on every page.
                  Jira attention signals live on Work. The inbox steps aside below 480px. A solo workspace shows the
                  bell only while updates are unread, because the tab title and favicon count them either way. */}
              {user?.role === 'manager' && onViewChange && features?.tasksPhase3 ? (
                <span className="header-wide-only">
                  <ManagerActionInbox updatesOnly onlyWithUnread={features.teamMode !== 'collab'} onOpenTarget={openActionTarget} onViewChange={onViewChange} />
                </span>
              ) : null}

              {canQuickCapture && (
                <button
                  type="button"
                  onClick={toggleAssistant}
                  className="header-ghost header-icon-btn"
                  aria-pressed={assistantOpen}
                  style={assistantOpen ? { color: 'var(--accent-text)', background: 'var(--accent-glow)' } : undefined}
                  title={`LeadOS Copilot (${formatShortcutKeys('⌘J')})`}
                  aria-label="Open Copilot"
                >
                  <CopilotMark size={15} monochrome />
                </button>
              )}

              {canQuickCapture && (
                <button
                  type="button"
                  onClick={() =>
                    openCapture({
                      ...(captureContext ?? {}),
                      defaultTarget: captureContext?.defaultTarget ?? defaultCaptureTarget,
                    })
                  }
                  className="header-capture-hit ml-1"
                  title={`Quick capture (${formatShortcutKeys('⌘I')})`}
                  aria-label="Capture"
                >
                  {/* The fill stays 32px; on phones the button around it is the 44px target. */}
                  <span className="header-primary-btn inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-xl px-2 text-ui font-semibold lg:px-3">
                    <Plus size={14} strokeWidth={2.5} />
                    <span className="hidden lg:inline">Capture</span>
                  </span>
                </button>
              )}

              <HeaderUserMenu
                onOpenSettings={user?.role === 'manager' && onViewChange ? () => onViewChange('settings') : undefined}
                settingsActive={activeView === 'settings'}
              />
            </div>
          </div>
        </div>
      </motion.header>
    </>
  );
}
