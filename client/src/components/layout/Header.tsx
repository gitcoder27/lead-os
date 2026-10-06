import { useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Moon, Sun, PanelLeftOpen, Search, Settings, Plus, Keyboard } from 'lucide-react';
import { CopilotMark } from '@/components/brand/CopilotMark';
import { useTheme } from '@/context/ThemeContext';
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

interface HeaderProps {
  onOpenMobileSidebar?: () => void;
  activeView?: ActiveAppView;
  onViewChange?: (view: AppView) => void;
  onOpenActionTarget?: (target: ManagerActionTarget) => void;
  captureContext?: GlobalCaptureContext;
}

export function Header({ onOpenMobileSidebar, activeView, onViewChange, onOpenActionTarget, captureContext }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const { user, features } = useAuth();
  const { openCapture, openCommandPalette, openKeyboardShortcuts, keyboardShortcutsOpen } = useQuickActions();
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
      <motion.header
        ref={headerRef}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative z-header shrink-0 px-1 pt-0.5 md:px-1.5"
      >
        <div
          className="header-panel dashboard-panel rounded-[14px] px-2 py-1.5 md:px-2.5 flex flex-col gap-1.5 lg:flex-row lg:items-center lg:justify-between"
          style={{ borderColor: 'var(--border-strong)' }}
        >
          <div className="header-identity-nav flex min-w-0 flex-col gap-1.5 lg:flex-row lg:items-center lg:gap-3">
            <div className="header-brand flex min-w-0 items-center gap-2 md:gap-2.5">
              {onOpenMobileSidebar && (
                <button
                  onClick={onOpenMobileSidebar}
                  className="h-8 w-8 rounded-xl transition-colors duration-150 flex items-center justify-center lg:hidden"
                  style={{ background: 'var(--bg-tertiary)' }}
                  title="Open sidebar"
                  aria-label="Open sidebar"
                >
                  <PanelLeftOpen size={16} style={{ color: 'var(--text-secondary)' }} />
                </button>
              )}
              <div className="h-8 w-8 md:h-11 md:w-11 rounded-[12px] flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
                <LeadOSMark size={32} />
              </div>
              <div className="min-w-0">
                <h1
                  className="font-sans text-[17px] font-semibold leading-tight truncate md:text-[18px]"
                  style={{ color: 'var(--text-primary)' }}
                >
                  LeadOS
                </h1>
              </div>
            </div>
            {onViewChange && (
              <div className="header-navigation min-w-0 overflow-visible">
                <HeaderNav activeView={activeView} isManager={user?.role === 'manager'} onViewChange={onViewChange} />
              </div>
            )}
          </div>

          <div className="header-actions flex min-w-0 items-center justify-between gap-2 lg:flex-1 lg:gap-3">
            {/* One search field in the middle; below md it collapses to an icon. */}
            {canQuickCapture && (
              <div className="flex md:flex-1 md:justify-center">
                <button
                  type="button"
                  onClick={() => openCommandPalette()}
                  className="header-search inline-flex h-8 w-8 items-center justify-center gap-2 rounded-xl text-[12.5px] md:w-full md:max-w-[420px] md:justify-start md:px-3"
                  title="Search and jump anywhere (Ctrl/⌘+K)"
                  aria-label="Open command palette"
                >
                  <Search size={14} className="shrink-0" />
                  <span className="hidden md:inline">Search or jump to…</span>
                  <Kbd variant="bare" className="ml-auto hidden md:inline">⌘K</Kbd>
                </button>
              </div>
            )}

            <div className="flex items-center gap-1 lg:gap-1.5">
              {/* docs/56 UX-30: Today's count rides on the nav's Today tab; the updates inbox shows on every page.
                  Jira attention signals live on Work. The inbox steps aside below 480px. */}
              {user?.role === 'manager' && onViewChange && features?.tasksPhase3 && features.teamMode === 'collab' ? (
                <span className="header-wide-only"><ManagerActionInbox updatesOnly onOpenTarget={openActionTarget} onViewChange={onViewChange} /></span>
              ) : null}

              {canQuickCapture && (
                <button
                  type="button"
                  onClick={toggleAssistant}
                  className="header-ghost header-icon-btn"
                  aria-pressed={assistantOpen}
                  style={assistantOpen ? { color: 'var(--accent-text)', background: 'var(--accent-glow)' } : undefined}
                  title="LeadOS Copilot (Ctrl/⌘+J)"
                  aria-label="Open Copilot"
                >
                  <CopilotMark size={15} monochrome />
                </button>
              )}

              {canQuickCapture && (
                <button type="button" className="header-ghost header-icon-btn" data-global-shortcuts-anchor=""
                  aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" aria-expanded={Boolean(keyboardShortcutsOpen)}
                  onClick={(event) => openKeyboardShortcuts?.(event.currentTarget)}>
                  <Keyboard size={16} />
                </button>
              )}

              <button
                onClick={toggleTheme}
                className="header-ghost header-icon-btn"
                title="Toggle theme"
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>

              {user?.role === 'manager' && onViewChange && (
                <button
                  onClick={() => onViewChange('settings')}
                  className="header-ghost header-icon-btn"
                  style={activeView === 'settings' ? { color: 'var(--accent-text)', background: 'var(--accent-glow)' } : undefined}
                  title="Settings"
                  aria-label="Open settings"
                  aria-current={activeView === 'settings' ? 'page' : undefined}
                >
                  <Settings size={16} />
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
                  className="header-primary-btn ml-1 inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold"
                  title="Quick capture (Ctrl/⌘+I)"
                  aria-label="Capture"
                >
                  <Plus size={14} strokeWidth={2.5} />
                  <span className="hidden sm:inline">Capture</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.header>
    </>
  );
}
