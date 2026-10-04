import { useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Moon, Sun, PanelLeftOpen, Search, Settings, Plus } from 'lucide-react';
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
import { TodayCountLink } from '@/components/layout/TodayCountLink';
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
      <motion.header
        ref={headerRef}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative z-header shrink-0 px-1 pt-0.5 md:px-1.5"
      >
        <div
          className="header-panel dashboard-panel rounded-[14px] px-2 py-1.5 md:px-2.5 flex flex-col gap-1.5 xl:flex-row xl:items-center xl:justify-between"
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

          <div className="header-actions flex min-w-0 flex-wrap items-center justify-between gap-1.5 xl:flex-nowrap xl:justify-end">
            <div className="flex items-center gap-1.5">
              {/* docs/56 UX-30: one pointer to Today ("Today N") off Today, and the updates inbox on every page;
                  Jira attention signals live on Work. Both step aside below 480px, where the nav already has Today. */}
              {user?.role === 'manager' && onViewChange && activeView !== 'today' ? (
                <span className="header-wide-only"><TodayCountLink onOpenToday={() => onViewChange('today')} /></span>
              ) : null}
              {user?.role === 'manager' && onViewChange && features?.tasksPhase3 && features.teamMode === 'collab' ? (
                <span className="header-wide-only"><ManagerActionInbox updatesOnly onOpenTarget={openActionTarget} onViewChange={onViewChange} /></span>
              ) : null}

              {canQuickCapture && (
                <button
                  type="button"
                  onClick={toggleAssistant}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[12px] font-medium transition-all"
                  style={{
                    background: assistantOpen ? 'var(--bg-elevated)' : 'var(--bg-tertiary)',
                    color: assistantOpen ? 'var(--accent)' : 'var(--text-secondary)',
                    border: '1px solid var(--border)',
                  }}
                  title="LeadOS Copilot (Ctrl/⌘+J)"
                  aria-label="Open Copilot"
                >
                  <CopilotMark size={13} monochrome />
                  <span className="hidden sm:inline">Copilot</span>
                  <Kbd variant="bare" className="hidden lg:inline">⌘J</Kbd>
                </button>
              )}

              {canQuickCapture && (
                <button
                  type="button"
                  onClick={() => openCommandPalette()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[12px] font-medium transition-all"
                  style={{
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border)',
                  }}
                  title="Search and jump anywhere (Ctrl/⌘+K)"
                  aria-label="Open command palette"
                >
                  <Search size={13} />
                  <span className="hidden sm:inline">Search</span>
                  <Kbd variant="bare" className="hidden lg:inline">⌘K</Kbd>
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
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold transition-all"
                  style={{
                    background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                    color: 'var(--accent)',
                    border: '1px solid color-mix(in srgb, var(--accent) 28%, transparent)',
                  }}
                  title="Quick capture (Ctrl/⌘+I)"
                  aria-label="Capture"
                >
                  <Plus size={12} />
                  <span className="hidden sm:inline">Capture</span>
                  <Kbd variant="bare" className="hidden lg:inline">⌘I</Kbd>
                </button>
              )}

              <div
                className="rounded-xl p-0.5 flex items-center gap-0.5"
                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}
              >
                <button
                  onClick={toggleTheme}
                  className="h-8 w-8 rounded-lg transition-colors duration-150 flex items-center justify-center"
                  style={{ background: 'transparent' }}
                  title="Toggle theme"
                >
                  {theme === 'dark' ? (
                    <Sun size={16} style={{ color: 'var(--text-secondary)' }} />
                  ) : (
                    <Moon size={16} style={{ color: 'var(--text-secondary)' }} />
                  )}
                </button>

                {user?.role === 'manager' && onViewChange && (
                  <button
                    onClick={() => onViewChange('settings')}
                    className="h-8 w-8 rounded-lg transition-colors duration-150 flex items-center justify-center"
                    style={{
                      background: activeView === 'settings' ? 'var(--bg-elevated)' : 'transparent',
                      boxShadow: activeView === 'settings' ? 'var(--soft-shadow)' : 'none',
                    }}
                    title="Settings"
                    aria-label="Open settings"
                  >
                    <Settings
                      size={16}
                      style={{ color: activeView === 'settings' ? 'var(--accent)' : 'var(--text-secondary)' }}
                    />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.header>
    </>
  );
}
