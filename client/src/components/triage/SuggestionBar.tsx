import { useState } from 'react';
import { useSuggestions } from '@/hooks/useSuggestions';
import { useUpdateIssue } from '@/hooks/useUpdateIssue';
import { useToast } from '@/context/ToastContext';
import { applyAllRows, buildSuggestionRows, buildUndoUpdate, mergeRowUpdates, type SuggestionRow } from '@/lib/suggestion-diff';
import { workloadAssignedLabel } from '@/lib/utils';
import { ArrowRight, Sparkles } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Avatar } from '@/components/ui/Avatar';
import type { Issue, IssueUpdate, AssignmentSuggestion } from '@/types';

interface SuggestionBarProps {
  issue: Issue;
}

/** docs/73 UXD-21: who and how loaded, in words; the raw score stays in the tooltip. */
function AssigneeMetrics({ suggestion }: { suggestion: AssignmentSuggestion }) {
  const w = suggestion.workload;
  const todayLabel = workloadAssignedLabel(w);
  const isIdle = w.signals?.idle ?? false;
  const isDoneForToday = w.trackerStatus === 'done_for_today';
  const isBlocked = w.trackerStatus === 'blocked';
  const pill = 'rounded-full px-1.5 py-0.5';

  return (
    <span className="flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--text-secondary)' }}>
      <Avatar name={suggestion.developer.displayName} seed={suggestion.developer.accountId} size={18} />
      <strong style={{ color: 'var(--text-primary)' }}>{suggestion.developer.displayName}</strong>
      <span className="flex items-center gap-1 text-ui tabular-nums" style={{ color: 'var(--text-muted)' }} title={`Workload score ${w.score}`}>
        <span className={pill} style={{ background: 'var(--bg-tertiary)' }}>{todayLabel} today</span>
        <span className={pill} style={{ background: 'var(--bg-tertiary)' }}>
          {w.activeDefects} Jira {w.activeDefects === 1 ? 'defect' : 'defects'}
        </span>
        {isIdle && <span className={pill} style={{ background: 'var(--bg-tertiary)' }}>Idle</span>}
        {isDoneForToday && <span className={pill} style={{ background: 'var(--bg-tertiary)' }}>Done for today</span>}
        {isBlocked && (
          <span className={pill} style={{ color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 8%, transparent)' }}>
            Blocked
          </span>
        )}
      </span>
    </span>
  );
}

/** docs/73 UXD-21: suggested dates read "Wed 14 Oct", not "2026-10-14"; other values pass through. */
function displayValue(field: SuggestionRow['field'], value: string): string {
  if (field !== 'dueDate' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const date = parseISO(value.slice(0, 10));
  return format(date, date.getFullYear() === new Date().getFullYear() ? 'EEE d MMM' : 'EEE d MMM yyyy');
}

export function SuggestionBar({ issue }: SuggestionBarProps) {
  const { prioritySuggestion, dueDateSuggestion, assigneeSuggestion, dueDatePriority } = useSuggestions(
    issue.jiraKey,
    issue.priorityName
  );
  const updateIssue = useUpdateIssue();
  const { addToast } = useToast();
  const [error, setError] = useState<string | null>(null);

  const topAssignee = assigneeSuggestion.data?.[0];
  const rows = buildSuggestionRows(issue, {
    priority: prioritySuggestion.data,
    dueDate: dueDateSuggestion.data,
    dueDatePriority,
    assignee: topAssignee,
  });
  const allRows = applyAllRows(rows);

  if (rows.length === 0) return null;

  const errorMessage = (err: unknown) => (err instanceof Error && err.message ? err.message : 'The update could not be applied.');

  const undo = (update: IssueUpdate) => {
    updateIssue.mutate(
      { key: issue.jiraKey, update },
      {
        onSuccess: () => addToast({ type: 'success', title: `Restored ${issue.jiraKey} in Jira` }),
        onError: (err) => addToast({ type: 'error', title: `Could not undo on ${issue.jiraKey}`, message: errorMessage(err) }),
      }
    );
  };

  const apply = (selected: SuggestionRow[]) => {
    setError(null);
    const update = mergeRowUpdates(selected);
    // docs/56 P5-02 review: capture what the issue had before the write, so it can be put back.
    const previous = buildUndoUpdate(issue, update);
    updateIssue.mutate(
      { key: issue.jiraKey, update },
      {
        onSuccess: () => {
          const canUndo = Object.keys(previous.update).length > 0;
          addToast({
            type: 'success',
            title: `Updated ${issue.jiraKey} in Jira`,
            message: previous.complete ? undefined : 'Fields that were empty before cannot be cleared from here.',
            action: canUndo ? { label: 'Undo', onClick: () => undo(previous.update) } : undefined,
            duration: canUndo ? 10_000 : undefined,
          });
        },
        onError: (err) => {
          setError(errorMessage(err));
        },
      }
    );
  };

  const applying = updateIssue.isPending;

  return (
    <div className="triage-section">
      <div
        className="rounded-lg px-3.5 py-3 flex flex-col gap-2.5"
        style={{ background: 'var(--bg-glow)', border: '1px solid var(--border-active)' }}
      >
        <div className="flex items-center justify-between">
          <span className="ui-label inline-flex items-center gap-1.5" style={{ color: 'var(--accent-text)' }}>
            <Sparkles size={11} /> Suggestions
          </span>
          {allRows.length > 1 && (
            <button
              type="button"
              onClick={() => apply(allRows)}
              disabled={applying}
              aria-label={`Apply all ${allRows.length} suggestions`}
              title={allRows.length < rows.length ? 'Changes that replace a value already set are applied one at a time.' : undefined}
              className="px-2.5 py-1 rounded-md text-ui font-semibold transition-all duration-150 active:scale-[0.97]"
              style={{ background: 'var(--accent-solid)', color: 'var(--on-accent)', opacity: applying ? 0.6 : 1 }}
            >
              {applying ? 'Applying…' : `Apply all (${allRows.length})`}
            </button>
          )}
        </div>

        <ul className="flex flex-col gap-2 text-body" aria-label="Suggested changes">
          {rows.map((row) => (
            <li key={row.field} className="flex flex-col gap-1" data-testid={`suggestion-${row.field}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-[68px] shrink-0 text-ui" style={{ color: 'var(--text-muted)' }}>{row.label}</span>
                <span className="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap" style={{ color: 'var(--text-secondary)' }}>
                  <span data-testid={`suggestion-${row.field}-current`} style={{ textDecoration: 'line-through' }}>{displayValue(row.field, row.current)}</span>
                  <ArrowRight size={11} aria-hidden="true" />
                  <strong data-testid={`suggestion-${row.field}-suggested`} style={{ color: 'var(--text-primary)' }}>{displayValue(row.field, row.suggested)}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => apply([row])}
                  disabled={applying}
                  aria-label={`Apply ${row.label.toLowerCase()}`}
                  className="px-2 py-0.5 rounded-md text-ui font-semibold transition-all duration-150 active:scale-[0.97]"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)', opacity: applying ? 0.6 : 1 }}
                >
                  Apply
                </button>
              </div>
              {row.reason ? (
                <p className="pl-[76px] text-meta" style={{ color: 'var(--text-muted)' }}>{row.reason}</p>
              ) : null}
              {row.warning ? (
                <p className="pl-[76px] text-meta" style={{ color: 'var(--warning)' }}>{row.warning}</p>
              ) : null}
              {row.overwrites && allRows.length > 1 ? (
                <p className="pl-[76px] text-meta" style={{ color: 'var(--text-muted)' }}>
                  Replaces the current value, so it is not part of Apply all.
                </p>
              ) : null}
              {row.field === 'assignee' && topAssignee ? (
                <div className="pl-[76px]"><AssigneeMetrics suggestion={topAssignee} /></div>
              ) : null}
            </li>
          ))}
        </ul>

        {error ? (
          <p role="alert" className="text-ui" style={{ color: 'var(--danger)' }}>
            Could not apply: {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
