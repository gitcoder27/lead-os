import { ArrowLeft, ExternalLink } from 'lucide-react';
import { JiraIssueLink } from '@/components/JiraIssueLink';
import type { Issue } from '@/types';

interface TriagePanelHeaderProps {
  issue?: Issue;
  jiraBaseUrl?: string;
  onClose: () => void;
}

function statusAccent(category: string): string {
  switch (category) {
    case 'done': return 'var(--success)';
    case 'indeterminate': return 'var(--accent)';
    case 'new': return 'var(--info)';
    default: return 'var(--text-secondary)';
  }
}

export function TriagePanelHeader({ issue, jiraBaseUrl, onClose }: TriagePanelHeaderProps) {
  const accent = issue ? statusAccent(issue.statusCategory) : 'var(--text-muted)';

  return (
    <div
      className="flex items-center justify-between px-5 py-2.5 border-b sticky top-0 z-10 shrink-0"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--bg-secondary) 95%, transparent)',
        backdropFilter: 'blur(16px)',
      }}
    >
      <button
        onClick={onClose}
        className="p-1.5 -ml-1 rounded-lg transition-colors duration-150 hover:bg-[var(--bg-tertiary)]"
        title="Close (Esc)"
      >
        <ArrowLeft size={15} style={{ color: 'var(--text-secondary)' }} />
      </button>

      {issue && (
        <div className="flex items-center gap-2.5">
          <span
            className="text-[11px] font-bold uppercase tracking-[0.06em] px-2 py-[3px] rounded-full leading-none"
            style={{
              color: accent,
              background: `color-mix(in srgb, ${accent} 10%, transparent)`,
              border: `1px solid color-mix(in srgb, ${accent} 18%, transparent)`,
            }}
          >
            {issue.statusName}
          </span>
          <JiraIssueLink
            issueKey={issue.jiraKey}
            className="font-mono text-[13px] font-semibold tracking-tight"
            style={{ color: 'var(--accent)' }}
          >
            {issue.jiraKey}
          </JiraIssueLink>
          <a
            href={jiraBaseUrl ? `${jiraBaseUrl}/browse/${issue.jiraKey}` : undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded-md transition-colors duration-150 hover:bg-[var(--bg-tertiary)]"
            title="Open in Jira"
            style={{
              pointerEvents: jiraBaseUrl ? 'auto' : 'none',
              opacity: jiraBaseUrl ? 1 : 0.3,
            }}
          >
            <ExternalLink size={13} style={{ color: 'var(--text-muted)' }} />
          </a>
        </div>
      )}
    </div>
  );
}
