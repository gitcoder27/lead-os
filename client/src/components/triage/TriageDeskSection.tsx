import { ListPlus } from 'lucide-react';
import { JiraIssueLink } from '@/components/JiraIssueLink';
import type { Issue } from '@/types';

interface TriageDeskSectionProps {
  issue: Issue;
  onCapture: () => void;
}

/**
 * docs/73 UXD-21: one accent-tinted card that says what it does — a task linked to this defect —
 * instead of an issue chip and a green owner chip that read like data.
 */
export function TriageDeskSection({ issue, onCapture }: TriageDeskSectionProps) {
  return (
    <div className="triage-section">
      <div
        className="rounded-lg px-3.5 py-2.5 flex items-center justify-between gap-3"
        style={{
          background: 'color-mix(in srgb, var(--accent) 6%, var(--bg-tertiary))',
          border: '1px solid color-mix(in srgb, var(--accent) 16%, transparent)',
        }}
      >
        <div className="flex items-start gap-2 min-w-0">
          <ListPlus size={14} aria-hidden="true" style={{ color: 'var(--accent-text)', flexShrink: 0, marginTop: 2 }} />
          <div className="min-w-0">
            <p className="text-body font-medium" style={{ color: 'var(--text-primary)' }}>Follow up in Tasks</p>
            <p className="text-ui" style={{ color: 'var(--text-muted)' }}>
              Linked to{' '}
              <JiraIssueLink issueKey={issue.jiraKey} className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                {issue.jiraKey}
              </JiraIssueLink>
              {issue.assigneeName ? `, with ${issue.assigneeName}` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCapture}
          className="ui-btn shrink-0"
        >
          Add task
        </button>
      </div>
    </div>
  );
}
