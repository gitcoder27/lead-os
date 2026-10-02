import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { formatRelativeTime, priorityColor } from '@/lib/utils';
import type { Issue } from '@/types';

interface TriagePropertiesProps {
  issue: Issue;
  jiraAspenSeverityField?: string;
}

export function TriageProperties({ issue, jiraAspenSeverityField }: TriagePropertiesProps) {
  const [expanded, setExpanded] = useState(false);

  const fields = [
    { label: 'Status', value: issue.statusName, accent: statusFieldColor(issue.statusCategory) },
    ...(jiraAspenSeverityField ? [{ label: 'Severity', value: issue.aspenSeverity ?? 'Not set', accent: issue.aspenSeverity ? 'rgb(99,102,241)' : undefined }] : []),
    { label: 'Component', value: issue.component ?? '—' },
    { label: 'Reporter', value: issue.reporterName ?? '—' },
    { label: 'Created', value: formatRelativeTime(issue.createdAt), mono: true },
    { label: 'Jira updated', value: formatRelativeTime(issue.updatedAt), mono: true },
    ...(issue.localUpdatedAt
      ? [{ label: 'Local edit', value: formatRelativeTime(issue.localUpdatedAt), mono: true }]
      : []),
  ];

  return (
    <div className="triage-section">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 group"
      >
        <ChevronRight
          size={12}
          className="shrink-0 transition-transform duration-150"
          style={{ color: 'var(--text-muted)', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        />
        <span className="triage-section-label">Properties</span>
        {!expanded && (
          <span className="ml-auto text-[12px] truncate max-w-[260px]" style={{ color: 'var(--text-muted)' }}>
            {issue.statusName}
            {issue.component ? ` · ${issue.component}` : ''}
            {issue.reporterName ? ` · ${issue.reporterName}` : ''}
          </span>
        )}
      </button>

      {expanded && (
        <div
          className="mt-2 grid grid-cols-2 gap-px rounded-lg overflow-hidden"
          style={{ border: '1px solid var(--border)', background: 'var(--border)' }}
        >
          {fields.map(({ label, value, accent, mono }) => (
            <div key={label} className="px-3 py-2" style={{ background: 'var(--bg-secondary)' }}>
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] mb-0.5" style={{ color: 'var(--text-muted)' }}>
                {label}
              </div>
              <div
                className={`text-[12.5px] font-medium truncate ${mono ? 'font-mono' : ''}`}
                style={{ color: accent ?? 'var(--text-primary)' }}
              >
                {accent && label === 'Status' && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: accent }} />
                )}
                {value}
              </div>
            </div>
          ))}

          {issue.labels && issue.labels.length > 0 && (
            <div className="col-span-2 px-3 py-2" style={{ background: 'var(--bg-secondary)' }}>
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] mb-1" style={{ color: 'var(--text-muted)' }}>
                Labels
              </div>
              <div className="flex flex-wrap gap-1">
                {issue.labels.map((label) => (
                  <span
                    key={label}
                    className="text-[12px] px-1.5 py-[1px] rounded-full"
                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function statusFieldColor(category: string): string {
  switch (category) {
    case 'done': return 'var(--success)';
    case 'indeterminate': return 'var(--accent)';
    case 'new': return 'var(--info)';
    default: return 'var(--text-secondary)';
  }
}
