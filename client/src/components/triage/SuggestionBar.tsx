import { useSuggestions } from '@/hooks/useSuggestions';
import { useUpdateIssue } from '@/hooks/useUpdateIssue';
import { workloadAssignedLabel } from '@/lib/utils';
import { Sparkles } from 'lucide-react';
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

  const hasSuggestions =
    prioritySuggestion.data || dueDateSuggestion.data || (assigneeSuggestion.data && assigneeSuggestion.data.length > 0);

  if (!hasSuggestions) return null;

  const topAssignee = assigneeSuggestion.data?.[0];

  const handleApplyAll = () => {
    const updates: Record<string, string> = {};
    if (prioritySuggestion.data?.suggested) updates.priorityName = prioritySuggestion.data.suggested;
    if (dueDateSuggestion.data?.suggested) updates.dueDate = dueDateSuggestion.data.suggested;
    const jiraAccountId = topAssignee?.developer.jiraAccountId ?? topAssignee?.developer.accountId;
    if (jiraAccountId) updates.assigneeId = jiraAccountId;

    if (Object.keys(updates).length > 0) {
      updateIssue.mutate({ key: issue.jiraKey, update: updates });
    }
  };

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
          <button
            onClick={handleApplyAll}
            disabled={updateIssue.isPending}
            className="px-2.5 py-1 rounded-md text-[12px] font-semibold transition-all duration-150 active:scale-[0.97]"
            style={{ background: 'var(--accent-solid)', color: 'var(--on-accent)', opacity: updateIssue.isPending ? 0.6 : 1 }}
          >
            {updateIssue.isPending ? 'Applying…' : 'Apply All'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-[12.5px]">
          {prioritySuggestion.data && (
            <span className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
              📌 <strong style={{ color: 'var(--text-primary)' }}>{prioritySuggestion.data.suggested}</strong>
            </span>
          )}
          {dueDateSuggestion.data && (
            <span className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
              📅 <strong style={{ color: 'var(--text-primary)' }}>{dueDateSuggestion.data.suggested}</strong>
            </span>
          )}
          {topAssignee && (
            <AssigneeMetrics suggestion={topAssignee} />
          )}
        </div>
      </div>
    </div>
  );
}
