import { useState } from 'react';
import { useSuggestions } from '@/hooks/useSuggestions';
import { useUpdateIssue } from '@/hooks/useUpdateIssue';
import { buildSuggestionRows, mergeRowUpdates, type SuggestionRow } from '@/lib/suggestion-diff';
import { workloadAssignedLabel } from '@/lib/utils';
import { ArrowRight, Sparkles } from 'lucide-react';
import type { Issue, AssignmentSuggestion } from '@/types';

interface SuggestionBarProps {
  issue: Issue;
}

function AssigneeMetrics({ suggestion }: { suggestion: AssignmentSuggestion }) {
  const w = suggestion.workload;
  const todayLabel = workloadAssignedLabel(w);
  const isIdle = w.signals?.idle ?? false;
  const isDoneForToday = w.trackerStatus === 'done_for_today';
  const isBlocked = w.trackerStatus === 'blocked';

  return (
    <span className="flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--text-secondary)' }}>
      👤 <strong style={{ color: 'var(--text-primary)' }}>{suggestion.developer.displayName}</strong>
      <span className="flex items-center gap-1 text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>
        <span
          className="rounded-full px-1.5 py-0.5"
          style={{ background: 'var(--bg-tertiary)' }}
        >
          {todayLabel} today
        </span>
        <span
          className="rounded-full px-1.5 py-0.5"
          style={{ background: 'var(--bg-tertiary)' }}
        >
          S{w.score} · {w.activeDefects} Jira
        </span>
        {isIdle && (
          <span
            className="rounded-full px-1.5 py-0.5 uppercase"
            style={{ background: 'var(--bg-tertiary)', letterSpacing: '0.06em' }}
          >
            idle
          </span>
        )}
        {isDoneForToday && (
          <span
            className="rounded-full px-1.5 py-0.5 uppercase"
            style={{ color: 'var(--text-muted)', background: 'var(--bg-tertiary)', letterSpacing: '0.06em' }}
          >
            done for today
          </span>
        )}
        {isBlocked && (
          <span
            className="rounded-full px-1.5 py-0.5 uppercase"
            style={{ color: 'var(--danger)', background: 'rgba(239, 68, 68, 0.08)', letterSpacing: '0.06em' }}
          >
            blocked
          </span>
        )}
      </span>
    </span>
  );
}

export function SuggestionBar({ issue }: SuggestionBarProps) {
  const { prioritySuggestion, dueDateSuggestion, assigneeSuggestion } = useSuggestions(
    issue.jiraKey,
    issue.priorityName
  );
  const updateIssue = useUpdateIssue();
  const [error, setError] = useState<string | null>(null);

  const topAssignee = assigneeSuggestion.data?.[0];
  const rows = buildSuggestionRows(issue, {
    priority: prioritySuggestion.data,
    dueDate: dueDateSuggestion.data,
    assignee: topAssignee,
  });

  if (rows.length === 0) return null;

  const apply = (selected: SuggestionRow[]) => {
    setError(null);
    updateIssue.mutate(
      { key: issue.jiraKey, update: mergeRowUpdates(selected) },
      {
        onError: (err) => {
          setError(err instanceof Error && err.message ? err.message : 'The update could not be applied.');
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
          <span className="triage-section-label" style={{ color: 'var(--accent)' }}>
            <Sparkles size={11} /> Suggestions
          </span>
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => apply(rows)}
              disabled={applying}
              aria-label={`Apply all ${rows.length} suggestions`}
              className="px-2.5 py-1 rounded-md text-[12px] font-semibold transition-all duration-150 active:scale-[0.97]"
              style={{ background: 'var(--accent-solid)', color: 'var(--on-accent)', opacity: applying ? 0.6 : 1 }}
            >
              {applying ? 'Applying…' : `Apply all (${rows.length})`}
            </button>
          )}
        </div>

        <ul className="flex flex-col gap-2 text-[12.5px]" aria-label="Suggested changes">
          {rows.map((row) => (
            <li key={row.field} className="flex flex-col gap-1" data-testid={`suggestion-${row.field}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-[68px] shrink-0 text-[12px]" style={{ color: 'var(--text-muted)' }}>{row.label}</span>
                <span className="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap" style={{ color: 'var(--text-secondary)' }}>
                  <span data-testid={`suggestion-${row.field}-current`} style={{ textDecoration: 'line-through' }}>{row.current}</span>
                  <ArrowRight size={11} aria-hidden="true" />
                  <strong data-testid={`suggestion-${row.field}-suggested`} style={{ color: 'var(--text-primary)' }}>{row.suggested}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => apply([row])}
                  disabled={applying}
                  aria-label={`Apply ${row.label.toLowerCase()}`}
                  className="px-2 py-0.5 rounded-md text-[12px] font-semibold transition-all duration-150 active:scale-[0.97]"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)', opacity: applying ? 0.6 : 1 }}
                >
                  Apply
                </button>
              </div>
              {row.reason ? (
                <p className="pl-[76px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{row.reason}</p>
              ) : null}
              {row.warning ? (
                <p className="pl-[76px] text-[11.5px]" style={{ color: 'var(--warning)' }}>{row.warning}</p>
              ) : null}
              {row.field === 'assignee' && topAssignee ? (
                <div className="pl-[76px]"><AssigneeMetrics suggestion={topAssignee} /></div>
              ) : null}
            </li>
          ))}
        </ul>

        {error ? (
          <p role="alert" className="text-[12px]" style={{ color: 'var(--danger)' }}>
            Could not apply: {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
