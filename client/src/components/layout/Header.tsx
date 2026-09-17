import { useLayoutEffect, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Moon, Sun, PanelLeftOpen, Search, Settings, Plus, CloudOff } from 'lucide-react';
import { CopilotMark } from '@/components/brand/CopilotMark';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useQuickActions } from '@/context/QuickActionsContext';
import { useAssistant } from '@/context/AssistantContext';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { useTriggerSync } from '@/hooks/useTriggerSync';
import { formatRelativeTime } from '@/lib/utils';
import type { ActiveAppView, AppView } from '@/App';
import type { ManagerActionTarget } from '@/types';
import type { GlobalCaptureContext } from '@/components/capture/GlobalCaptureDialog';
import { HeaderNav } from '@/components/layout/HeaderNav';
import { ManagerActionInbox } from '@/components/actions/ManagerActionInbox';
import { LeadOSMark } from '@/components/brand/LeadOSMark';

interface HeaderProps {
  onOpenMobileSidebar?: () => void;
  activeView?: ActiveAppView;
  onViewChange?: (view: AppView) => void;
  onOpenActionTarget?: (target: ManagerActionTarget) => void;
  captureContext?: GlobalCaptureContext;
}

export function Header({ onOpenMobileSidebar, activeView, onViewChange, onOpenActionTarget, captureContext }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const { openCapture, openCommandPalette } = useQuickActions();
  const { isOpen: assistantOpen, toggle: toggleAssistant } = useAssistant();
  const showJiraSync = activeView === 'work';
  const { data: sync } = useSyncStatus({ enabled: showJiraSync });
  const triggerSync = useTriggerSync();
  const headerRef = useRef<HTMLElement | null>(null);
  const [, setTimeTick] = useState(0);

  useEffect(() => {
    // Relative sync timestamps only change on re-render; tick even when sync data is unchanged.
    const timer = window.setInterval(() => setTimeTick((tick) => tick + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const isSyncing = sync?.status === 'syncing' || triggerSync.isPending;
  const hasError = sync?.status === 'error';
  const autoSyncOff = sync?.autoSyncEnabled === false;
  const syncLabel = isSyncing
    ? 'Syncing…'
    : hasError
    ? 'Sync issue'
    : autoSyncOff
    ? 'Sync off'
    : sync?.lastSyncedAt
    ? `Synced ${formatRelativeTime(sync.lastSyncedAt)}`
    : 'Not synced';
  const syncTitle = hasError
    ? `Sync issue${sync?.errorMessage ? `: ${sync.errorMessage}` : ''}${autoSyncOff ? ' Jira auto-sync is off; manual sync is still available.' : ''}`
    : autoSyncOff
    ? 'Jira auto-sync is off. Manual sync is still available; turn it back on in Settings → Sync Scope.'
    : sync?.lastSyncedAt
    ? `Synced ${formatRelativeTime(sync.lastSyncedAt)}`
    : 'Not synced';
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
        className="relative z-[300] shrink-0 px-1 pt-0.5 md:px-1.5"
      >
        <div
          className="dashboard-panel rounded-[14px] px-2 py-1.5 md:px-2.5 flex flex-col gap-1.5 xl:flex-row xl:items-center xl:justify-between"
          style={{ borderColor: 'var(--border-strong)' }}
        >
          <div className="flex min-w-0 flex-col gap-1.5 lg:flex-row lg:items-center lg:gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
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
              <div className="h-11 w-11 rounded-[16px] flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
                <LeadOSMark size={32} />
              </div>
              <div className="min-w-[148px]">
                <h1
                  className="font-sans text-[17px] font-semibold leading-tight truncate md:text-[18px]"
                  style={{ color: 'var(--text-primary)' }}
                >
                  LeadOS
                </h1>
                <div className="hidden text-[11.5px] leading-4 sm:block" style={{ color: 'var(--text-secondary)' }}>
                  People, work, risks, and planning
                </div>
              </div>
            </div>
            {onViewChange && (
              <div className="min-w-0 overflow-visible">
                <HeaderNav activeView={activeView} isManager={user?.role === 'manager'} onViewChange={onViewChange} />
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-between gap-1.5 xl:flex-nowrap xl:justify-end">
            {showJiraSync && (
            <div
              className="h-9 rounded-xl px-2.5 flex items-center gap-2"
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}
              title={syncTitle}
            >
              {autoSyncOff && !isSyncing && !hasError ? (
                <CloudOff size={13} style={{ color: 'var(--text-muted)' }} />
              ) : (
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{
                    background: hasError
                      ? 'var(--danger)'
                      : isSyncing
                      ? 'var(--warning)'
                      : 'var(--success)',
                    boxShadow: hasError
                      ? '0 0 10px var(--danger)'
                      : isSyncing
                      ? '0 0 10px var(--warning)'
                      : '0 0 10px var(--success)',
                  }}
                />
              )}
              <div className="min-w-0">
                <div className="truncate font-mono text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  {syncLabel}
                </div>
              </div>
            </div>
            )}

            <div className="flex items-center gap-1.5">
              {user?.role === 'manager' && onViewChange ? (
                <ManagerActionInbox onOpenTarget={openActionTarget} onViewChange={onViewChange} />
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
                  <kbd className="hidden lg:inline font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>⌘J</kbd>
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
                  <kbd className="hidden lg:inline font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>⌘K</kbd>
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
                    background: 'linear-gradient(135deg, var(--md-accent-glow), rgba(217,169,78,0.06))',
                    color: 'var(--md-accent)',
                    border: '1px solid rgba(217,169,78,0.22)',
                    boxShadow: '0 10px 24px rgba(217,169,78,0.08)',
                  }}
                  title="Quick capture (Ctrl/⌘+I)"
                >
                  <Plus size={12} />
                  <span>Capture</span>
                  <kbd className="hidden lg:inline font-mono text-[10px]" style={{ color: 'var(--md-accent)', opacity: 0.7 }}>⌘I</kbd>
                </button>
              )}

              <div
                className="rounded-xl p-0.5 flex items-center gap-0.5"
                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}
              >
                {showJiraSync && (
                  <button
                    onClick={() => triggerSync.mutate()}
                    disabled={isSyncing}
                    className="h-8 w-8 rounded-lg transition-colors duration-150 disabled:opacity-50 flex items-center justify-center"
                    style={{ background: 'transparent' }}
                    title="Manual sync (r)"
                  >
                    <RefreshCw
                      size={16}
                      className={isSyncing ? 'animate-spin' : ''}
                      style={{ color: 'var(--text-secondary)' }}
                    />
                  </button>
                )}

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
