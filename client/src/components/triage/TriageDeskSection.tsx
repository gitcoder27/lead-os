import { Briefcase } from 'lucide-react';
import { JiraIssueLink } from '@/components/JiraIssueLink';
import type { Issue } from '@/types';

interface TriageDeskSectionProps {
  issue: Issue;
  onCapture: () => void;
}

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
        <div className="flex items-center gap-2 min-w-0">
          <Briefcase size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <div className="flex flex-wrap gap-1 min-w-0">
            <JiraIssueLink
              issueKey={issue.jiraKey}
              className="rounded-full px-1.5 py-[1px] text-ui font-medium"
              style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            >
              {issue.jiraKey}
            </JiraIssueLink>
            {issue.assigneeName && (
              <span
                className="rounded-full px-1.5 py-[1px] text-ui font-medium"
                style={{ background: 'rgba(16,185,129,0.08)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.14)' }}
              >
                {issue.assigneeName}
              </span>
            )}
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
