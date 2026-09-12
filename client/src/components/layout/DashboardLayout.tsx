import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Header } from './Header';
import { ErrorBanner } from '@/components/alerts/ErrorBanner';
import { FilterSidebar } from '@/components/filters/FilterSidebar';
import { DefectTable } from '@/components/table/DefectTable';
import { TriagePanel } from '@/components/triage/TriagePanel';
import { WorkloadBar } from '@/components/workload/WorkloadBar';
import { WorkFocusStrip } from '@/components/work/WorkFocusStrip';
import { describeWorkSavedView } from '@/components/work/workSavedViewDescription';
import { SavedViewsMenu } from '@/components/team-tracker/SavedViewsMenu';
import { useTriggerSync } from '@/hooks/useTriggerSync';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useWorkSavedViewState } from '@/hooks/useWorkSavedViewState';
import { useToast } from '@/context/ToastContext';
import { useWorkload } from '@/hooks/useWorkload';
import type { FilterType, ManagerActionTarget } from '@/types';
import type { AppView } from '@/App';
import { DEFAULT_DASHBOARD_FILTER_STATE, type DashboardFilterState } from './dashboard-state';

export { DEFAULT_DASHBOARD_FILTER_STATE, type DashboardFilterState } from './dashboard-state';

const RETAINED_HIGHLIGHT_INTERACTIVE_SELECTOR = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[data-inline-edit-trigger]',
  '[data-tag-editor-root]',
  '[data-tag-editor-popover]',
  '[contenteditable="true"]',
].join(', ');

function shouldIgnoreDashboardShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function hasShortcutModifier(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey || event.isComposing;
}

function areDashboardFilterStatesEqual(left: DashboardFilterState, right: DashboardFilterState): boolean {
  return (
    left.activeFilter === right.activeFilter &&
    left.activeDeveloper === right.activeDeveloper &&
    left.selectedTagId === right.selectedTagId &&
    left.noTagsFilter === right.noTagsFilter
  );
}

interface DashboardLayoutProps {
  activeView?: AppView;
  onViewChange?: (view: AppView) => void;
  filterState?: DashboardFilterState;
  onFilterStateChange?: (state: DashboardFilterState) => void;
  initialIssueKey?: string;
  initialIssueNonce?: number;
  onInitialIssueHandled?: () => void;
  onOpenActionTarget?: (target: ManagerActionTarget) => void;
}

function useDashboardShortcuts({
  visibleIssueKeys,
  focusedIndex,
  setFocusedIndex,
  openIssue,
  triggerSync,
  setFilterState,
  clearIssueHighlight,
  closePanel,
}: {
  visibleIssueKeys: string[];
  focusedIndex: number;
  setFocusedIndex: (updater: number | ((previous: number) => number)) => void;
  openIssue: (key: string) => void;
  triggerSync: Pick<ReturnType<typeof useTriggerSync>, 'mutate'>;
  setFilterState: (updater: DashboardFilterState | ((prev: DashboardFilterState) => DashboardFilterState)) => void;
  clearIssueHighlight: () => void;
  closePanel: () => void;
}) {
  useEffect(() => {
    const setFilterShortcut = (activeFilter: FilterType) => {
      setFilterState((prev) => ({ ...prev, activeFilter }));
      clearIssueHighlight();
      setFocusedIndex(-1);
    };

    const handler = (event: KeyboardEvent) => {
      if (hasShortcutModifier(event) || shouldIgnoreDashboardShortcut(event.target)) {
        return;
      }

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setFocusedIndex((prev) => Math.min(prev + 1, visibleIssueKeys.length - 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setFocusedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter': {
          event.preventDefault();
          const issueKey = visibleIssueKeys[focusedIndex];
          if (issueKey) {
            openIssue(issueKey);
          }
          break;
        }
        case 'r':
          event.preventDefault();
          triggerSync.mutate();
          break;
        case '0':
        case '1':
          event.preventDefault();
          setFilterShortcut('all');
          break;
        case '2':
          event.preventDefault();
          setFilterShortcut('unassigned');
          break;
        case '3':
          event.preventDefault();
          setFilterShortcut('dueToday');
          break;
        case '4':
          event.preventDefault();
          setFilterShortcut('dueThisWeek');
          break;
        case '5':
          event.preventDefault();
          setFilterShortcut('overdue');
          break;
        case '6':
          event.preventDefault();
          setFilterShortcut('blocked');
          break;
        case '7':
          event.preventDefault();
          setFilterShortcut('stale');
          break;
        case 'Escape':
          closePanel();
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    clearIssueHighlight,
    closePanel,
    focusedIndex,
    openIssue,
    setFilterState,
    setFocusedIndex,
    triggerSync,
    visibleIssueKeys,
  ]);
}

export function DashboardLayout({
  activeView,
  onViewChange,
  filterState,
  onFilterStateChange,
  initialIssueKey,
  initialIssueNonce,
  onInitialIssueHandled,
  onOpenActionTarget,
}: DashboardLayoutProps) {
  const [internalFilterState, setInternalFilterState] = useState<DashboardFilterState>(DEFAULT_DASHBOARD_FILTER_STATE);
  const [selectedIssueKey, setSelectedIssueKey] = useState<string | undefined>();
  const [highlightedIssueKey, setHighlightedIssueKey] = useState<string | undefined>();
  const [shouldClearHighlightedIssueOnInteraction, setShouldClearHighlightedIssueOnInteraction] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [visibleIssueKeys, setVisibleIssueKeys] = useState<string[]>([]);
  const [desktopSidebarExpanded, setDesktopSidebarExpanded] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const hasAnimatedRef = useRef(false);
  const [hasAnimated, setHasAnimated] = useState(false);
  const armHighlightClearTimeoutRef = useRef<number | null>(null);
  const clearHighlightTimeoutRef = useRef<number | null>(null);
  const selectedIssueKeyRef = useRef<string | undefined>(selectedIssueKey);
  const triggerSync = useTriggerSync();

  const isCompact = useMediaQuery('(max-width: 1023px)');
  const isControlled = filterState !== undefined && onFilterStateChange !== undefined;
  const resolvedFilterState = filterState ?? internalFilterState;
  const { activeFilter, activeDeveloper, selectedTagId, noTagsFilter } = resolvedFilterState;

  const setFilterState = useCallback((updater: DashboardFilterState | ((prev: DashboardFilterState) => DashboardFilterState)) => {
    if (isControlled) {
      const nextState = typeof updater === 'function' ? updater(resolvedFilterState) : updater;
      if (!areDashboardFilterStatesEqual(resolvedFilterState, nextState)) {
        onFilterStateChange(nextState);
      }
      return;
    }

    setInternalFilterState((previous) => {
      const nextState = typeof updater === 'function' ? updater(previous) : updater;
      return areDashboardFilterStatesEqual(previous, nextState) ? previous : nextState;
    });
  }, [isControlled, onFilterStateChange, resolvedFilterState]);

  selectedIssueKeyRef.current = selectedIssueKey;

  const { addToast } = useToast();
  const { data: workload } = useWorkload();
  const developerNames = useMemo(
    () => new Map(workload?.map((developer) => [developer.developer.accountId, developer.developer.displayName])),
    [workload],
  );
  const workViews = useWorkSavedViewState(addToast, resolvedFilterState, setFilterState);
  const workViewsMenu = (
    <SavedViewsMenu
      views={workViews.savedViews}
      describe={(view) => describeWorkSavedView(view, developerNames)}
      activeViewId={workViews.activeViewId}
      isDirty={workViews.isDirty}
      isViewsLoading={workViews.isViewsLoading}
      onApplyView={workViews.handleApplyView}
      onClearView={workViews.handleClearView}
      onSaveNew={workViews.handleSaveNewView}
      onUpdateView={workViews.handleUpdateView}
      onDeleteView={workViews.handleDeleteView}
      isSaving={workViews.isSaving}
    />
  );

  useEffect(() => {
    if (!isCompact) {
      setMobileSidebarOpen(false);
    }
  }, [isCompact]);

  const handleVisibleIssueKeysChange = useCallback((keys: string[]) => {
    setVisibleIssueKeys((previous) => {
      if (previous.length === keys.length && previous.every((key, index) => key === keys[index])) {
        return previous;
      }
      return keys;
    });
  }, []);

  // Mark animation as played after first render
  useEffect(() => {
    if (!hasAnimatedRef.current) {
      const timer = setTimeout(() => {
        hasAnimatedRef.current = true;
        setHasAnimated(true);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, []);

  const closeSidebarOnCompact = useCallback(() => {
    if (isCompact) {
      setMobileSidebarOpen(false);
    }
  }, [isCompact]);

  const cancelHighlightClearTimers = useCallback(() => {
    if (armHighlightClearTimeoutRef.current !== null) {
      window.clearTimeout(armHighlightClearTimeoutRef.current);
      armHighlightClearTimeoutRef.current = null;
    }

    if (clearHighlightTimeoutRef.current !== null) {
      window.clearTimeout(clearHighlightTimeoutRef.current);
      clearHighlightTimeoutRef.current = null;
    }
  }, []);

  const clearIssueHighlight = useCallback(() => {
    cancelHighlightClearTimers();
    setSelectedIssueKey(undefined);
    setHighlightedIssueKey(undefined);
    setShouldClearHighlightedIssueOnInteraction(false);
  }, [cancelHighlightClearTimers]);

  const openIssue = useCallback((key: string) => {
    cancelHighlightClearTimers();

    if (selectedIssueKeyRef.current === key) {
      setSelectedIssueKey(undefined);
      setHighlightedIssueKey(key);
      setShouldClearHighlightedIssueOnInteraction(true);
      return;
    }

    setSelectedIssueKey(key);
    setHighlightedIssueKey(key);
    setShouldClearHighlightedIssueOnInteraction(false);
  }, [cancelHighlightClearTimers]);

  const closePanel = useCallback(() => {
    cancelHighlightClearTimers();
    setSelectedIssueKey(undefined);
    setShouldClearHighlightedIssueOnInteraction(Boolean(highlightedIssueKey));
  }, [cancelHighlightClearTimers, highlightedIssueKey]);

  const scheduleHighlightedIssueClear = useCallback(() => {
    if (clearHighlightTimeoutRef.current !== null) {
      window.clearTimeout(clearHighlightTimeoutRef.current);
    }

    clearHighlightTimeoutRef.current = window.setTimeout(() => {
      clearHighlightTimeoutRef.current = null;

      if (selectedIssueKeyRef.current) {
        return;
      }

      setHighlightedIssueKey(undefined);
      setShouldClearHighlightedIssueOnInteraction(false);
    }, 0);
  }, []);

  const handleFilterChange = useCallback((filter: FilterType) => {
    setFilterState((prev) => ({ ...prev, activeFilter: filter }));
    clearIssueHighlight();
    setFocusedIndex(-1);
    closeSidebarOnCompact();
  }, [clearIssueHighlight, closeSidebarOnCompact, setFilterState]);

  const handleClearFilter = useCallback(() => {
    setFilterState((prev) => ({ ...prev, activeFilter: 'all' }));
    clearIssueHighlight();
    setFocusedIndex(-1);
    closeSidebarOnCompact();
  }, [clearIssueHighlight, closeSidebarOnCompact, setFilterState]);

  const handleDeveloperChange = useCallback((accountId?: string) => {
    setFilterState((prev) => ({ ...prev, activeDeveloper: accountId }));
    clearIssueHighlight();
    setFocusedIndex(-1);
    closeSidebarOnCompact();
  }, [clearIssueHighlight, closeSidebarOnCompact, setFilterState]);

  const handleClearDeveloper = useCallback(() => {
    setFilterState((prev) => ({ ...prev, activeDeveloper: undefined }));
    clearIssueHighlight();
    setFocusedIndex(-1);
    closeSidebarOnCompact();
  }, [clearIssueHighlight, closeSidebarOnCompact, setFilterState]);

  const handleTagToggle = useCallback((tagId: number) => {
    setFilterState((prev) => ({
      ...prev,
      noTagsFilter: false,
      selectedTagId: prev.selectedTagId === tagId ? undefined : tagId,
    }));
    clearIssueHighlight();
    setFocusedIndex(-1);
    closeSidebarOnCompact();
  }, [clearIssueHighlight, closeSidebarOnCompact, setFilterState]);

  const handleNoTagsToggle = useCallback(() => {
    setFilterState((prev) => ({
      ...prev,
      noTagsFilter: !prev.noTagsFilter,
      selectedTagId: undefined,
    }));
    clearIssueHighlight();
    setFocusedIndex(-1);
    closeSidebarOnCompact();
  }, [clearIssueHighlight, closeSidebarOnCompact, setFilterState]);

  const handleClearTagFilters = useCallback(() => {
    setFilterState((prev) => ({
      ...prev,
      selectedTagId: undefined,
      noTagsFilter: false,
    }));
    clearIssueHighlight();
    setFocusedIndex(-1);
    closeSidebarOnCompact();
  }, [clearIssueHighlight, closeSidebarOnCompact, setFilterState]);

  const handleClearAllFilters = useCallback(() => {
    setFilterState(DEFAULT_DASHBOARD_FILTER_STATE);
    clearIssueHighlight();
    setFocusedIndex(-1);
  }, [clearIssueHighlight, setFilterState]);

  const handleSelectIssue = useCallback((key: string) => {
    openIssue(key);
  }, [openIssue]);

  const handleClosePanel = useCallback(() => {
    closePanel();
  }, [closePanel]);

  useEffect(() => {
    if (!shouldClearHighlightedIssueOnInteraction || selectedIssueKey || !highlightedIssueKey) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(RETAINED_HIGHLIGHT_INTERACTIVE_SELECTOR)) {
        return;
      }

      scheduleHighlightedIssueClear();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') {
        return;
      }

      scheduleHighlightedIssueClear();
    };

    armHighlightClearTimeoutRef.current = window.setTimeout(() => {
      armHighlightClearTimeoutRef.current = null;
      window.addEventListener('click', handleClick, true);
      window.addEventListener('keydown', handleKeyDown, true);
    }, 0);

    return () => {
      if (armHighlightClearTimeoutRef.current !== null) {
        window.clearTimeout(armHighlightClearTimeoutRef.current);
        armHighlightClearTimeoutRef.current = null;
      }

      window.removeEventListener('click', handleClick, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [highlightedIssueKey, scheduleHighlightedIssueClear, selectedIssueKey, shouldClearHighlightedIssueOnInteraction]);

  useEffect(() => {
    return () => {
      cancelHighlightClearTimers();
    };
  }, [cancelHighlightClearTimers]);

  useEffect(() => {
    if (focusedIndex >= visibleIssueKeys.length) {
      setFocusedIndex(visibleIssueKeys.length - 1);
    }
  }, [focusedIndex, visibleIssueKeys.length]);

  useEffect(() => {
    if (initialIssueKey) {
      openIssue(initialIssueKey);
      onInitialIssueHandled?.();
    }
  }, [initialIssueKey, initialIssueNonce, onInitialIssueHandled, openIssue]);

  useDashboardShortcuts({
    visibleIssueKeys,
    focusedIndex,
    setFocusedIndex,
    openIssue,
    triggerSync,
    setFilterState,
    clearIssueHighlight,
    closePanel,
  });

  const handleToggleSidebar = useCallback(() => {
    if (isCompact) {
      setMobileSidebarOpen((prev) => !prev);
      return;
    }

    setDesktopSidebarExpanded((prev) => !prev);
  }, [isCompact]);

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: 'transparent' }}>
      <Header
        onOpenMobileSidebar={isCompact ? () => setMobileSidebarOpen(true) : undefined}
        activeView={activeView}
        onViewChange={onViewChange}
        onOpenActionTarget={onOpenActionTarget}
        captureContext={selectedIssueKey ? { issue: { jiraKey: selectedIssueKey } } : undefined}
      />

      <div className="flex-1 min-h-0 px-1 pb-0.5 md:px-1.5 md:pb-1">
        <div className="h-full min-h-0 min-w-0 rounded-[16px] border overflow-hidden flex flex-col" style={{ borderColor: 'var(--border-strong)', background: 'color-mix(in srgb, var(--bg-primary) 84%, transparent)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)' }}>
          <WorkFocusStrip
            activeFilter={activeFilter}
            onFilterChange={handleFilterChange}
            onOpenDesk={onViewChange ? () => onViewChange('desk') : undefined}
            onOpenTeam={onViewChange ? () => onViewChange('team') : undefined}
            actions={workViewsMenu}
          />

          <ErrorBanner />

          <div className="flex flex-1 min-h-0 min-w-0 relative">
            <FilterSidebar
              activeFilter={activeFilter}
              activeDeveloper={activeDeveloper}
              onFilterChange={handleFilterChange}
              onClearFilter={handleClearFilter}
              onDeveloperChange={handleDeveloperChange}
              onClearDeveloper={handleClearDeveloper}
              selectedTagId={selectedTagId}
              noTagsFilter={noTagsFilter}
              onTagToggle={handleTagToggle}
              onNoTagsToggle={handleNoTagsToggle}
              onClearTagFilters={handleClearTagFilters}
              collapsed={!isCompact && !desktopSidebarExpanded}
              isMobile={isCompact}
              open={!isCompact || mobileSidebarOpen}
              onClose={() => setMobileSidebarOpen(false)}
              onCollapse={() => setDesktopSidebarExpanded(false)}
              onExpand={() => setDesktopSidebarExpanded(true)}
            />

            <DefectTable
              filter={activeFilter}
              assigneeFilter={activeDeveloper}
              selectedKey={selectedIssueKey}
              highlightedKey={highlightedIssueKey}
              focusedIndex={focusedIndex}
              onFocusedIndexChange={setFocusedIndex}
              onSelectIssue={handleSelectIssue}
              hasAnimated={hasAnimated}
              tagId={selectedTagId}
              noTags={noTagsFilter}
              onClearFilters={handleClearAllFilters}
              onVisibleIssueKeysChange={handleVisibleIssueKeysChange}
            />

            {/* Subtle backdrop — click to dismiss */}
            {selectedIssueKey && (
              <div
                className="absolute inset-0 z-40 transition-opacity duration-200"
                style={{ background: 'rgba(0,0,0,0.08)', backdropFilter: 'blur(0.5px)' }}
                onClick={handleClosePanel}
              />
            )}
            <div className="absolute right-0 top-0 bottom-0 z-50 pointer-events-none">
              <div className="pointer-events-auto h-full">
                <TriagePanel
                  issueKey={selectedIssueKey}
                  onClose={handleClosePanel}
                  onOpenManagerDesk={onViewChange ? () => onViewChange('desk') : undefined}
                />
              </div>
            </div>
          </div>

          <WorkloadBar activeDeveloper={activeDeveloper} onDeveloperClick={handleDeveloperChange} />
        </div>
      </div>

    </div>
  );
}
