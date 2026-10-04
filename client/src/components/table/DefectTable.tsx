import { WorkBulkTriage } from '@/components/work/WorkBulkTriage';
import { WorkIssueMenu } from '@/components/work/WorkIssueMenu';
import { ISSUE_BULK_LIMIT } from '@/types';
import '@/components/work/work-execution.css';
import { csvFileName, downloadCsv, workCsv } from '@/lib/csv';
import { useMemo, useEffect, useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { motion } from 'framer-motion';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { TriangleAlert, ArrowUpDown, Ban, Filter, Search, X, CircleX } from 'lucide-react';
import { PriorityCell } from './PriorityCell';
import { StatusBadge } from './StatusBadge';
import { AssigneeCell } from './AssigneeCell';
import { DueDateCell } from './DueDateCell';
import { AnalysisStatusCell } from './AnalysisStatusCell';
import { TrackerAssignmentsCell } from './TrackerAssignmentsCell';
import { InlineEditAssignee } from './InlineEditAssignee';
import { InlineEditDueDate } from './InlineEditDueDate';
import { InlineEditTags } from './InlineEditTags';
import { DismissCell } from './DismissCell';
import { useIssues } from '@/hooks/useIssues';
import { useConfig } from '@/hooks/useConfig';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { useExcludeIssue } from '@/hooks/useExcludeIssue';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import { JiraIssueLink } from '@/components/JiraIssueLink';
import { useScopedStorageKey } from '@/lib/scoped-storage';
import { isOverdue, isDueToday, getLocalIsoDate } from '@/lib/utils';
import type { Issue, FilterType } from '@/types';
import { useQuickActions } from '@/context/QuickActionsContext';
import { JiraNotConnectedState, NothingSyncedState, ProjectCleanState } from './DefectEmptyStates';

const ASPEN_SEVERITY_ORDER: Record<string, number> = {
  '1 - Critical': 0,
  '2 - Major': 1,
  '3 - Minor': 2,
  '4 - Low': 3,
};

const INITIAL_ROW_ANIMATION_DELAY = 0.4;
const INITIAL_ROW_ANIMATION_STAGGER = 0.03;
const INITIAL_ROW_STAGGER_CAP = 12;
const ROW_HOVER_BACKGROUND = 'color-mix(in srgb, var(--bg-tertiary) 72%, transparent)';
const ROW_DEFAULT_BACKGROUND = 'color-mix(in srgb, var(--bg-secondary) 42%, transparent)';
const STATUS_FILTER_STORAGE_KEY = 'dcc:defect-table:excluded-statuses';
const EMPTY_ISSUES: Issue[] = [];

const columnHelper = createColumnHelper<Issue>();

function readPersistedExcludedStatuses(storageKey: string): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return Array.from(new Set(parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
  } catch {
    return [];
  }
}

function persistExcludedStatuses(storageKey: string, excludedStatuses: string[]) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (excludedStatuses.length === 0) {
      window.localStorage.removeItem(storageKey);
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(excludedStatuses));
  } catch {
    // Ignore storage failures and continue with in-memory state.
  }
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function useStableStringArray(values: string[]): string[] {
  const previousValuesRef = useRef(values);

  if (!areStringArraysEqual(previousValuesRef.current, values)) {
    previousValuesRef.current = values;
  }

  return previousValuesRef.current;
}

function hasAnalysisNotes(issue: Issue): boolean {
  return Boolean(issue.analysisNotes?.trim());
}

function getTrackerAssignmentCount(issue: Issue): number {
  return issue.trackerAssignmentsToday?.activeCount ?? 0;
}

function getEffectiveDueDate(issue: Issue): string | undefined {
  return issue.developmentDueDate ?? issue.dueDate;
}

function useDefectTableModel({
  baseIssues,
  normalizedSearch,
  excludedStatuses,
  columns,
  sorting,
  setSorting,
}: {
  baseIssues: Issue[];
  normalizedSearch: string;
  excludedStatuses: string[];
  columns: Parameters<typeof useReactTable<Issue>>[0]['columns'];
  sorting: SortingState;
  setSorting: Dispatch<SetStateAction<SortingState>>;
}) {
  const filteredIssues = useMemo(() => {
    let filtered = baseIssues;
    if (excludedStatuses.length) {
      const excludedSet = new Set(excludedStatuses);
      filtered = filtered.filter((issue) => !excludedSet.has(issue.statusName));
    }
    if (!normalizedSearch) {
      return filtered;
    }

    return filtered.filter((issue) => {
      return issue.jiraKey.toLowerCase().includes(normalizedSearch) || issue.summary.toLowerCase().includes(normalizedSearch);
    });
  }, [baseIssues, excludedStatuses, normalizedSearch]);

  const table = useReactTable({
    data: filteredIssues,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rawVisibleIssueKeys = useMemo(
    () => table.getRowModel().rows.map((row) => row.original.jiraKey),
    [table, filteredIssues, sorting]
  );
  const visibleIssueKeys = useStableStringArray(rawVisibleIssueKeys);

  return { filteredIssues, table, visibleIssueKeys };
}

interface DefectTableProps {
  filter: FilterType;
  assigneeFilter?: string;
  selectedKey?: string;
  highlightedKey?: string;
  focusedIndex: number;
  onFocusedIndexChange: (index: number) => void;
  onSelectIssue: (key: string) => void;
  hasAnimated: boolean;
  tagId?: number;
  noTags?: boolean;
  onClearFilters: () => void;
  onVisibleIssueKeysChange?: (keys: string[]) => void;
  /** docs/56 P2-03: open Settings → Jira from the not-connected empty state. */
  onConnectJira?: () => void;
  /** Open Settings → Sync scope from the nothing-synced empty state. */
  onOpenSyncSettings?: () => void;
}

export function DefectTable({
  filter,
  assigneeFilter,
  selectedKey,
  highlightedKey,
  focusedIndex,
  onFocusedIndexChange,
  onSelectIssue,
  hasAnimated,
  tagId,
  noTags,
  onClearFilters,
  onVisibleIssueKeysChange,
  onConnectJira,
  onOpenSyncSettings,
}: DefectTableProps) {
  const { theme } = useTheme();
  const { data: issues, isLoading, isError, error, refetch, isFetching } = useIssues(filter, assigneeFilter, tagId, noTags);
  const { data: config } = useConfig();
  const { data: syncStatus } = useSyncStatus();
  const { openCapture } = useQuickActions();
  const { exclude, restore } = useExcludeIssue();
  const excludeIssue = exclude.mutate;
  const restoreIssue = restore.mutate;
  const { addToast } = useToast();
  const statusStorageKey = useScopedStorageKey(STATUS_FILTER_STORAGE_KEY);

  const [sorting, setSorting] = useState<SortingState>([
    { id: 'aspenSeverity', desc: false },
    { id: 'developmentDueDate', desc: false },
  ]);
  const [editingCell, setEditingCell] = useState<{
    rowKey: string;
    column: 'assignee' | 'dueDate';
  } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  const [excludedStatuses, setExcludedStatuses] = useState<string[]>(() => readPersistedExcludedStatuses(statusStorageKey));

  const [selectionMode, setSelectionMode] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const selectionScope = [
    statusStorageKey,
    filter,
    assigneeFilter,
    tagId,
    noTags,
    searchQuery,
    excludedStatuses.join(','),
  ].join('|');
  const [selection, setSelection] = useState<{ scope: string; keys: Set<string> }>({
    scope: selectionScope,
    keys: new Set(),
  });
  const selectedKeys = useMemo(
    () => (selection.scope === selectionScope ? selection.keys : new Set<string>()),
    [selection, selectionScope],
  );
  const selectionRef = useRef({ keys: selectedKeys, scope: selectionScope });
  selectionRef.current = { keys: selectedKeys, scope: selectionScope };
  const toggleSelected = useCallback(
    (key: string) =>
      setSelection((current) => {
        const keys = new Set(current.scope === selectionScope ? current.keys : []);
        if (keys.has(key)) keys.delete(key);
        else if (keys.size < ISSUE_BULK_LIMIT) keys.add(key);
        return { scope: selectionScope, keys };
      }),
    [selectionScope],
  );
  const removeSelected = useCallback(
    (keys: string[]) =>
      setSelection((current) => ({
        ...current,
        keys: new Set([...current.keys].filter((key) => !keys.includes(key))),
      })),
    [],
  );

  const tableRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const statusFilterRef = useRef<HTMLDivElement>(null);
  const statusFilterButtonRef = useRef<HTMLButtonElement>(null);
  const statusStorageKeyRef = useRef(statusStorageKey);
  const clearVisitedHighlightTimeoutRef = useRef<number | null>(null);
  const [lastVisitedKey, setLastVisitedKey] = useState<string | null>(null);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  const scheduleVisitedHighlightClear = useCallback(() => {
    if (clearVisitedHighlightTimeoutRef.current !== null) {
      window.clearTimeout(clearVisitedHighlightTimeoutRef.current);
    }

    clearVisitedHighlightTimeoutRef.current = window.setTimeout(() => {
      clearVisitedHighlightTimeoutRef.current = null;
      setLastVisitedKey(null);
    }, 0);
  }, []);

  useEffect(() => {
    return () => {
      if (clearVisitedHighlightTimeoutRef.current !== null) {
        window.clearTimeout(clearVisitedHighlightTimeoutRef.current);
      }
    };
  }, []);

  // Clear visited-link highlight after the outside click completes so the clicked control still runs.
  useEffect(() => {
    if (!lastVisitedKey) return;
    const handleInteraction = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest('[data-jira-link]')) {
        return;
      }

      scheduleVisitedHighlightClear();
    };
    window.addEventListener('click', handleInteraction, true);
    return () => window.removeEventListener('click', handleInteraction, true);
  }, [lastVisitedKey, scheduleVisitedHighlightClear]);

  // Expose issue keys for parent keyboard nav
  const baseIssues = issues ?? EMPTY_ISSUES;
  // docs/56 P2-03: `false` is a connection that was never made; unknown (still loading) is not.
  const jiraNotConnected = syncStatus?.jiraConfigured === false;
  const syncErrorMessage = syncStatus?.status === 'error' && !jiraNotConnected ? syncStatus.errorMessage : undefined;
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const allStatuses = useMemo(() => {
    const statusSet = new Set<string>();
    for (const issue of baseIssues) {
      if (issue.statusName) {
        statusSet.add(issue.statusName);
      }
    }
    return Array.from(statusSet).sort((a, b) => a.localeCompare(b));
  }, [baseIssues]);
  const hasStatusFilter = excludedStatuses.length > 0;

  const clearStatusFilter = useCallback(() => {
    setExcludedStatuses([]);
    setStatusFilterOpen(false);
  }, []);

  const toggleStatusFilter = useCallback((status: string) => {
    setExcludedStatuses((previous) => {
      const next = new Set(previous);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return Array.from(next);
    });
  }, []);

  useEffect(() => {
    if (!statusFilterOpen) {
      return;
    }

    const handleOutsideMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (statusFilterRef.current?.contains(target)) {
        return;
      }
      if (statusFilterButtonRef.current?.contains(target)) {
        return;
      }
      setStatusFilterOpen(false);
    };

    const handleStatusFilterKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setStatusFilterOpen(false);
      }
    };

    window.addEventListener('mousedown', handleOutsideMouseDown);
    window.addEventListener('keydown', handleStatusFilterKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleOutsideMouseDown);
      window.removeEventListener('keydown', handleStatusFilterKeyDown);
    };
  }, [statusFilterOpen]);

  useEffect(() => {
    if (statusStorageKeyRef.current !== statusStorageKey) {
      statusStorageKeyRef.current = statusStorageKey;
      setExcludedStatuses(readPersistedExcludedStatuses(statusStorageKey));
      setStatusFilterOpen(false);
      return;
    }

    persistExcludedStatuses(statusStorageKey, excludedStatuses);
  }, [excludedStatuses, statusStorageKey]);

  // Auto-scroll to focused row
  useEffect(() => {
    if (focusedIndex >= 0 && tableRef.current) {
      const rows = tableRef.current.querySelectorAll('tbody tr');
      rows[focusedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex]);

  const handleCellClick = useCallback(
    (issueKey: string, column: 'assignee' | 'dueDate', e: React.MouseEvent) => {
      e.stopPropagation();
      setEditingCell({ rowKey: issueKey, column });
    },
    []
  );

  const closeInlineEdit = useCallback(() => setEditingCell(null), []);

  const handleExclude = useCallback(
    (issueKey: string, _e: React.MouseEvent) => {
      excludeIssue(issueKey, {
        onSuccess: () => {
          addToast({
            type: 'success',
            title: `${issueKey} dismissed`,
            message: 'Issue excluded from tracking',
            action: {
              label: 'Undo',
              onClick: () => restoreIssue(issueKey),
            },
            duration: 8000,
          });
        },
        onError: () => {
          addToast({ type: 'error', title: 'Failed to dismiss issue' });
        },
      });
    },
    [excludeIssue, restoreIssue, addToast]
  );

  const columns = useMemo(
    () => [
      ...(selectionMode
        ? [
            columnHelper.display({
              id: 'select',
              header: ({ table }) => {
                const keys = table
                  .getRowModel()
                  .rows.slice(0, ISSUE_BULK_LIMIT)
                  .map((row) => row.original.jiraKey);
                const all = keys.length > 0 && keys.every((key) => selectionRef.current.keys.has(key));
                return (
                  <label className="work-select-control">
                    <input
                      type="checkbox"
                      aria-label="Select first 20 visible defects"
                      checked={all}
                      onChange={() => setSelection({ scope: selectionRef.current.scope, keys: all ? new Set() : new Set(keys) })}
                    />
                  </label>
                );
              },
              cell: ({ row }) => (
                <label className="work-select-control" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.original.jiraKey}`}
                    checked={selectionRef.current.keys.has(row.original.jiraKey)}
                    disabled={!selectionRef.current.keys.has(row.original.jiraKey) && selectionRef.current.keys.size >= ISSUE_BULK_LIMIT}
                    onChange={() => toggleSelected(row.original.jiraKey)}
                  />
                </label>
              ),
              size: 44,
              enableSorting: false,
            }),
          ]
        : []),
      ...(filter === 'outOfTeam'
        ? [
            columnHelper.display({
              id: 'dismiss',
              header: '',
              cell: (info) => {
                const issue = info.row.original;
                return (
                  <DismissCell
                    issueKey={issue.jiraKey}
                    onConfirm={handleExclude}
                  />
                );
              },
              size: 40,
              enableSorting: false,
            }),
          ]
        : []),
      columnHelper.display({
        id: 'open',
        header: 'Open',
        cell: (info) => {
          const issue = info.row.original;
          return (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onSelectIssue(issue.jiraKey);
              }}
              className="rounded-md px-2 py-1 text-[12px] font-semibold transition-colors hover:bg-[var(--bg-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-active)]"
              style={{ color: 'var(--accent)' }}
              aria-label={`Open triage for ${issue.jiraKey}`}
            >
              Open
            </button>
          );
        },
        size: 58,
        enableSorting: false,
      }),
      columnHelper.accessor('aspenSeverity', {
        id: 'aspenSeverity',
        header: 'Sev',
        cell: (info) => <PriorityCell severity={info.getValue()} />,
        size: 40,
        sortingFn: (a, b) =>
          (ASPEN_SEVERITY_ORDER[a.original.aspenSeverity ?? ''] ?? 99) -
          (ASPEN_SEVERITY_ORDER[b.original.aspenSeverity ?? ''] ?? 99),
      }),
      columnHelper.accessor('jiraKey', {
        header: 'ID',
        cell: (info) => {
          const jiraKey = info.getValue();
          const isVisited = lastVisitedKey === jiraKey;
          const href = config?.jiraBaseUrl
            ? `${config.jiraBaseUrl}/browse/${jiraKey}`
            : undefined;
          return href ? (
            <JiraIssueLink
              issueKey={jiraKey}
              data-jira-link
              className="font-mono text-[13px] font-medium relative group/id cursor-pointer whitespace-nowrap"
              style={{
                color: isVisited ? 'var(--info)' : 'var(--accent)',
                textDecoration: isVisited ? 'underline' : 'none',
                textDecorationColor: 'var(--info)',
                textUnderlineOffset: '3px',
                textDecorationThickness: '1.5px',
              }}
              onClick={(e) => {
                e.stopPropagation();
                setLastVisitedKey(jiraKey);
              }}
            >
              {jiraKey}
              {!isVisited && (
                <span
                  className="absolute bottom-0 left-0 w-0 h-px group-hover/id:w-full transition-all duration-200"
                  style={{ background: 'var(--accent)' }}
                />
              )}
            </JiraIssueLink>
          ) : (
            <span
              className="font-mono text-[13px] font-medium whitespace-nowrap"
              style={{ color: 'var(--accent)' }}
            >
              {jiraKey}
            </span>
          );
        },
        size: 100,
      }),
      columnHelper.accessor('summary', {
        header: 'Title',
        cell: (info) => (
          <span
            className="text-[13px] truncate block max-w-[420px]"
            title={info.getValue()}
            style={{ color: 'var(--text-primary)' }}
          >
            {info.getValue()}
            {info.row.original.excluded ? (
              <small className="block">Excluded</small>
            ) : info.row.original.snoozedUntil && Date.parse(info.row.original.snoozedUntil) > Date.now() ? (
              <small className="block">
                Snoozed until {new Date(info.row.original.snoozedUntil).toLocaleDateString()}
              </small>
            ) : null}
          </span>
        ),
        size: undefined, // flex
      }),
      columnHelper.display({
        id: 'tags',
        header: 'Tags',
        cell: (info) => {
          const issue = info.row.original;
          return (
            <InlineEditTags
              issueKey={issue.jiraKey}
              localTags={issue.localTags}
            />
          );
        },
        size: 250,
        enableSorting: false,
      }),
      columnHelper.accessor('assigneeName', {
        header: 'Assignee',
        cell: (info) => {
          const issue = info.row.original;
          if (editingCell?.rowKey === issue.jiraKey && editingCell?.column === 'assignee') {
            return (
              <InlineEditAssignee
                issueKey={issue.jiraKey}
                currentId={issue.assigneeId ?? undefined}
                onClose={closeInlineEdit}
              />
            );
          }
          return (
            <button
              type="button"
              data-inline-edit-trigger="assignee"
              onClick={(e) => handleCellClick(issue.jiraKey, 'assignee', e)}
              className="block min-w-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-active)]"
              aria-label={`Edit assignee for ${issue.jiraKey}`}
            >
              <AssigneeCell name={info.getValue() ?? undefined} />
            </button>
          );
        },
        size: 120,
      }),
      columnHelper.accessor('developmentDueDate', {
        header: 'Due Date',
        cell: (info) => {
          const issue = info.row.original;
          const effectiveDueDate = getEffectiveDueDate(issue);
          if (editingCell?.rowKey === issue.jiraKey && editingCell?.column === 'dueDate') {
            return (
              <InlineEditDueDate
                issueKey={issue.jiraKey}
                currentValue={effectiveDueDate ?? undefined}
                onClose={closeInlineEdit}
              />
            );
          }
          return (
            <button
              type="button"
              data-inline-edit-trigger="dueDate"
              onClick={(e) => handleCellClick(issue.jiraKey, 'dueDate', e)}
              className="block min-w-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-active)]"
              aria-label={`Edit due date for ${issue.jiraKey}`}
            >
              <DueDateCell date={effectiveDueDate ?? undefined} />
            </button>
          );
        },
        size: 100,
      }),
      columnHelper.accessor('statusName', {
        header: () => (
          <div className="relative inline-flex items-center gap-1">
            <span>Status</span>
            <button
              ref={statusFilterButtonRef}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setStatusFilterOpen((open) => !open);
              }}
              onMouseDown={(event) => event.stopPropagation()}
              className="h-6 px-1.5 rounded-md inline-flex items-center gap-1 text-[12px] transition-colors"
              style={{
                border: hasStatusFilter ? '1px solid var(--border)' : '1px dashed var(--border)',
                background: statusFilterOpen ? 'var(--bg-tertiary)' : 'transparent',
                color: hasStatusFilter ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
              aria-label="Open status filter"
              title="Filter by status"
            >
              <Filter size={11} />
            </button>
            {hasStatusFilter ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  clearStatusFilter();
                }}
                onMouseDown={(event) => event.stopPropagation()}
                className="h-6 w-6 inline-flex items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-tertiary)]"
                style={{
                  color: 'var(--danger)',
                  background: 'color-mix(in srgb, var(--danger) 16%, transparent)',
                }}
                aria-label="Clear status filter"
                title="Clear status filter"
              >
                <X size={11} />
              </button>
            ) : null}
            {statusFilterOpen ? (
              <div
                ref={statusFilterRef}
                className="absolute right-0 top-7 z-30 min-w-[240px] rounded-xl border shadow-md overflow-hidden"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="px-2 py-1.5 text-[12px] uppercase font-semibold border-b flex items-center justify-between"
                     style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', letterSpacing: '0.08em' }}
                >
                  <span>Status filter</span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      clearStatusFilter();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    className="h-6 w-6 inline-flex items-center justify-center rounded-md hover:bg-[var(--bg-tertiary)]"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label="Clear status filter"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="max-h-56 overflow-auto p-1.5">
                  {allStatuses.map((status) => (
                    <label
                      key={status}
                      className="flex items-center gap-2 px-2 py-1 rounded-md text-[13px]"
                      style={{
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!excludedStatuses.includes(status)}
                        onChange={() => toggleStatusFilter(status)}
                        onClick={(event) => event.stopPropagation()}
                        className="h-3.5 w-3.5"
                      />
                      <span className="truncate" title={status}>
                        {status}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ),
        cell: (info) => <StatusBadge status={info.getValue()} />,
        size: 100,
        enableSorting: false,
      }),
      columnHelper.accessor((row) => (hasAnalysisNotes(row) ? 1 : 0), {
        id: 'analysisStatus',
        header: 'Notes',
        cell: (info) => <AnalysisStatusCell hasNotes={Boolean(info.getValue())} />,
        sortDescFirst: false,
        size: 60,
      }),
      columnHelper.accessor((row) => getTrackerAssignmentCount(row), {
        id: 'trackerAssignments',
        header: 'Tracker',
        cell: (info) => (
          <TrackerAssignmentsCell
            activeCount={info.getValue()}
            developerNames={info.row.original.trackerAssignmentsToday?.developerNames ?? []}
          />
        ),
        sortDescFirst: true,
        size: 78,
      }),
      columnHelper.display({
        id: 'more',
        header: '',
        size: 44,
        enableSorting: false,
        cell: ({ row }) => <WorkIssueMenu issue={row.original} />,
      }),
      columnHelper.accessor('flagged', {
        header: '',
        cell: (info) =>
          info.getValue() ? (
            <Ban size={14} className="animate-pulse-blocked" style={{ color: 'var(--danger)' }} />
          ) : null,
        size: 40,
        enableSorting: false,
      }),
    ],
    [
      selectionMode,
      toggleSelected,
      editingCell,
      handleCellClick,
      closeInlineEdit,
      config,
      lastVisitedKey,
      filter,
      handleExclude,
      allStatuses,
      hasStatusFilter,
      excludedStatuses,
      statusFilterOpen,
      clearStatusFilter,
      toggleStatusFilter,
      onSelectIssue,
    ]
  );

  const hasActiveFilters =
    filter !== 'all' ||
    Boolean(assigneeFilter) ||
    tagId !== undefined ||
    Boolean(noTags) ||
    hasStatusFilter ||
    Boolean(normalizedSearch);

  const { filteredIssues, table, visibleIssueKeys } = useDefectTableModel({
    baseIssues,
    normalizedSearch,
    excludedStatuses,
    columns,
    sorting,
    setSorting,
  });

  useEffect(() => {
    onVisibleIssueKeysChange?.(visibleIssueKeys);
  }, [onVisibleIssueKeysChange, visibleIssueKeys]);

  const closeSearch = useCallback(() => {
    setSearchQuery('');
    setSearchOpen(false);
  }, []);

  const handleClearFilters = useCallback(() => {
    closeSearch();
    clearStatusFilter();
    onClearFilters();
  }, [clearStatusFilter, closeSearch, onClearFilters]);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }

    const handleOutsideMouseDown = (event: MouseEvent) => {
      if (searchQuery.trim()) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (searchContainerRef.current?.contains(target)) {
        return;
      }
      setSearchOpen(false);
    };

    window.addEventListener('mousedown', handleOutsideMouseDown);
    return () => {
      window.removeEventListener('mousedown', handleOutsideMouseDown);
    };
  }, [searchOpen, searchQuery]);

  if (isLoading) {
    return (
      <div className="flex-1 min-w-0 min-h-0 flex flex-col px-3 pt-3">
        <div className="text-[13px] font-medium pb-1.5" style={{ color: 'var(--text-secondary)' }}>
          Loading defects
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-10 mb-1 rounded-[12px] animate-pulse"
            style={{ background: 'var(--bg-secondary)' }}
          />
        ))}
      </div>
    );
  }

  if (isError && !bulkOpen) {
    return (
      <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center p-6 text-center">
        <div>
          <div className="text-[13px] font-semibold" style={{ color: 'var(--danger)' }}>
            Could not load defects
          </div>
          <p className="mt-2 max-w-md text-[13px] leading-5" style={{ color: 'var(--text-secondary)' }}>
            {error instanceof Error ? error.message : 'The issue query failed.'}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="mt-4 rounded-md px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--accent-solid)', color: 'var(--on-accent)' }}
          >
            {isFetching ? 'Retrying' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  const selectedIssues = table
    .getRowModel()
    .rows.map((row) => row.original)
    .filter((issue) => selectedKeys.has(issue.jiraKey));
  const bulkDialog = bulkOpen ? (
    <WorkBulkTriage
      issues={selectedIssues}
      onClose={() => setBulkOpen(false)}
      onApplied={removeSelected}
      onOpen={onSelectIssue}
    />
  ) : null;

  const toolbar = (
    <div
      ref={searchContainerRef}
      className="px-3 py-1.5 border-b flex items-center justify-between gap-2"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="min-w-0 flex items-center gap-2">
        <div className="text-[13px] font-semibold whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
          Defects
        </div>
        <div className="h-4 w-px" style={{ background: 'var(--border)' }} />
        <div className="text-[13px] truncate" style={{ color: 'var(--text-secondary)' }}>
          {filteredIssues.length} visible defect{filteredIssues.length !== 1 ? 's' : ''}{normalizedSearch ? ' after search' : ''}.
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5 min-w-0 md:min-w-[260px]">
        <button
          type="button"
          className="ui-btn-ghost work-action-button"
          aria-pressed={selectionMode}
          onClick={() => {
            setSelectionMode(!selectionMode);
            setSelection({ scope: selectionScope, keys: new Set() });
          }}
        >
          {selectionMode ? 'Cancel' : 'Select'}
        </button>
        <button type="button" className="ui-btn-ghost" aria-label="Export CSV" disabled={!filteredIssues.length} onClick={() => downloadCsv(workCsv(table.getRowModel().rows.map((row) => row.original)), csvFileName('work', 'current', getLocalIsoDate()))}>CSV</button>
        <button
          type="button"
          onClick={handleClearFilters}
          disabled={!hasActiveFilters}
          className="h-8 rounded-lg px-2.5 flex items-center justify-center transition-colors gap-1.5 disabled:cursor-not-allowed"
          style={{
            color: hasActiveFilters ? 'var(--text-secondary)' : 'var(--text-muted)',
            background: 'var(--bg-tertiary)',
            opacity: hasActiveFilters ? 1 : 0.6,
          }}
          aria-label="Clear all defect filters"
          title="Clear all filters"
        >
          <CircleX size={15} />
          <span className="text-[13px] font-medium hidden sm:inline">Clear filters</span>
        </button>

        {!searchOpen ? (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
          className="h-8 rounded-lg px-2.5 flex items-center justify-center transition-colors hover:bg-[var(--bg-tertiary)] gap-1.5"
            style={{ color: 'var(--text-secondary)', background: 'var(--bg-tertiary)' }}
            aria-label="Open defect search"
            title="Search defects"
          >
            <Search size={15} />
            <span className="text-[13px] font-medium hidden sm:inline">Search</span>
          </button>
        ) : (
          <div
            className="h-8 w-[320px] max-w-full rounded-lg border px-2.5 flex items-center gap-2"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}
          >
            <Search size={14} style={{ color: 'var(--text-muted)' }} />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by ID or title..."
              className="flex-1 text-[13px] bg-transparent outline-none"
              style={{ color: 'var(--text-primary)' }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  closeSearch();
                }
              }}
              onBlur={(e) => {
                if (searchQuery.trim()) {
                  return;
                }
                const nextFocused = e.relatedTarget;
                if (nextFocused && searchContainerRef.current?.contains(nextFocused)) {
                  return;
                }
                setSearchOpen(false);
              }}
              aria-label="Search defects by ID or title"
            />
            <button
              type="button"
              onClick={closeSearch}
              className="h-7 w-7 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--bg-tertiary)]"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Clear defect search"
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (!baseIssues.length && !hasActiveFilters && jiraNotConnected) {
    return <JiraNotConnectedState onConnectJira={onConnectJira} onAddTask={() => openCapture()} />;
  }

  if (!baseIssues.length && !hasActiveFilters && syncErrorMessage) {
    return (
      <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center p-4 text-center">
        <div className="max-w-[420px] rounded-2xl px-5 py-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-strong)' }}>
          <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)' }}>
            <TriangleAlert size={18} />
          </div>
          <p className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            Jira defects could not be refreshed
          </p>
          <p className="mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {syncErrorMessage}
          </p>
          <p className="mt-2 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            Check the saved Jira API token in Settings, then run Save &amp; Sync.
          </p>
        </div>
      </div>
    );
  }

  if (!baseIssues.length && !hasActiveFilters && !bulkOpen) {
    // Connected, yet the last sync returned nothing (or none ran): explain, do not claim the project is clean.
    if (syncStatus?.jiraConfigured && (!syncStatus.lastSyncedAt || !syncStatus.issuesSynced)) {
      return <NothingSyncedState syncStatus={syncStatus} scopeMode={config?.jiraSyncScopeMode ?? syncStatus.syncScope?.mode} onOpenSyncSettings={onOpenSyncSettings} />;
    }
    return <ProjectCleanState />;
  }

  if (!baseIssues.length && !bulkOpen) {
    return (
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        {toolbar}
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center">
            <div className="text-[12px] uppercase font-semibold" style={{ letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
              Filter State
            </div>
            <p className="text-[14px] mt-2" style={{ color: 'var(--text-secondary)' }}>
              No defects match the current filters.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
      {toolbar}
      {selectionMode && (
        <div className="work-selection-bar">
          <span role="status">
            {selectedIssues.length} selected · up to {ISSUE_BULK_LIMIT}
          </span>
          <button
            type="button"
            className="ui-btn-primary"
            disabled={!selectedIssues.length}
            onClick={() => setBulkOpen(true)}
          >
            Update selected
          </button>
        </div>
      )}
      {bulkDialog}

      <div
        className="flex-1 min-w-0 overflow-auto px-1 pb-1"
        ref={tableRef}
      >
          {filteredIssues.length === 0 ? (
            <div className="h-full flex items-center justify-center px-6">
              <div className="text-center">
                <div className="text-[12px] uppercase font-semibold" style={{ letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
                  Search State
                </div>
                <p className="text-[14px] mt-2" style={{ color: 'var(--text-secondary)' }}>
                  No defects match this search.
                </p>
              </div>
            </div>
          ) : (
            <table className="min-w-full border-separate border-spacing-y-0">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const canSort = header.column.getCanSort();
                      const sortState = header.column.getIsSorted();
                      return (
                        <th
                          key={header.id}
                          aria-sort={canSort ? sortState === 'asc' ? 'ascending' : sortState === 'desc' ? 'descending' : 'none' : undefined}
                          className="text-left text-[12px] font-semibold uppercase px-2 py-1.5 select-none sticky top-0 z-30"
                          style={{
                            letterSpacing: '0.08em',
                            color: 'var(--text-muted)',
                            background: 'color-mix(in srgb, var(--bg-secondary) 94%, white 6%)',
                            boxShadow: '0 1px 0 var(--border)',
                            width: header.column.getSize() !== 150 ? header.column.getSize() : undefined,
                          }}
                        >
                          {canSort ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className="flex items-center gap-1 rounded-sm text-left uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-active)]"
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              <ArrowUpDown size={10} style={{ opacity: sortState ? 0.8 : 0.4 }} />
                            </button>
                          ) : (
                            <span className="flex items-center gap-1">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                            </span>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row, i) => {
            const issue = row.original;
            const isSelected = issue.jiraKey === selectedKey;
            const isHighlighted = issue.jiraKey === highlightedKey;
            const isFocused = i === focusedIndex;
              const effectiveDueDate = getEffectiveDueDate(issue);
              const overdue = isOverdue(effectiveDueDate);
              const dueToday = isDueToday(effectiveDueDate);
            // docs/56 P1-05: the server applies the Attention rules; no client threshold.
            const stale = issue.statusCategory !== 'done' && Boolean(issue.stale);
            const isLastVisited = lastVisitedKey === issue.jiraKey;
            const selectionState = isSelected ? 'active' : isHighlighted ? 'retained' : 'none';
            const rowBackgroundColor = selectionState !== 'none'
              ? ROW_HOVER_BACKGROUND
              : isFocused
              ? 'color-mix(in srgb, var(--bg-tertiary) 88%, white 12%)'
              : isLastVisited
              ? 'rgba(139,92,246,0.04)'
              : issue.flagged
              ? 'rgba(239,68,68,0.04)'
              : ROW_DEFAULT_BACKGROUND;

            let leftBorder = 'transparent';
            let indicatorReason: string | null = null;
            if (isSelected) {
              leftBorder = 'var(--accent)';
              indicatorReason = 'Open in triage';
            } else if (isHighlighted) {
              leftBorder = 'var(--accent)';
              indicatorReason = 'Last opened defect';
            } else if (isFocused) {
              leftBorder = 'var(--accent)';
              indicatorReason = 'Focused defect';
            } else if (isLastVisited) {
              leftBorder = 'var(--info)';
              indicatorReason = 'Last opened in Jira';
            } else if (overdue) {
              leftBorder = 'var(--danger)';
              indicatorReason = 'Overdue development due date';
            } else if (dueToday) {
              leftBorder = 'var(--warning)';
              indicatorReason = 'Development due date is today';
            } else if (issue.flagged) {
              leftBorder = 'var(--danger-muted)';
              indicatorReason = 'Flagged issue';
            } else if (stale) {
              leftBorder = 'var(--text-muted)';
              indicatorReason = 'Stale: no recent Jira update (see Attention rules)';
            }

            const shouldAnimate = !hasAnimated;
            const animationDelay =
              Math.min(i, INITIAL_ROW_STAGGER_CAP) * INITIAL_ROW_ANIMATION_STAGGER + INITIAL_ROW_ANIMATION_DELAY;

                return (
                  <motion.tr
                    key={`${theme}-${issue.jiraKey}`}
                    initial={shouldAnimate ? { opacity: 0, y: 6 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={shouldAnimate ? { duration: 0.2, delay: animationDelay } : undefined}
                    onClick={() => onSelectIssue(issue.jiraKey)}
                    className="cursor-pointer transition-colors duration-150 group/row"
                    data-selection-state={selectionState}
                    style={{
                      backgroundColor: rowBackgroundColor,
                      boxShadow: 'inset 0 -1px 0 color-mix(in srgb, var(--border) 70%, transparent)',
                    }}
                    whileHover={{ y: -1, backgroundColor: ROW_HOVER_BACKGROUND }}
                  >
                    {row.getVisibleCells().map((cell, cellIndex) => (
                      <td key={cell.id} className="px-2 py-1.5 text-[13px] relative z-0 first:rounded-l-[10px] last:rounded-r-[10px]">
                        {cellIndex === 0 && indicatorReason ? (
                          <span
                            role="img"
                            className="absolute left-0 top-0 bottom-0 w-3 flex items-center justify-start cursor-help"
                            title={indicatorReason}
                            aria-label={`Row indicator: ${indicatorReason}`}
                          >
                            <span
                              className="block h-full w-[3px] rounded-l-[12px]"
                              style={{ background: leftBorder }}
                            />
                          </span>
                        ) : null}
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </motion.tr>
                );
              })}
              </tbody>
            </table>
          )}
        </div>
    </div>
  );
}
