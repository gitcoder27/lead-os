import { useEffect, useMemo, useState } from 'react';
import { Bug, ExternalLink, LoaderCircle } from 'lucide-react';
import { useIssueDetail } from '@/hooks/useIssueDetail';
import { useConfig } from '@/hooks/useConfig';

interface DrawerLinkedJiraProps {
  issueKeys: string[];
}

export function DrawerLinkedJira({ issueKeys }: DrawerLinkedJiraProps) {
  const keys = useMemo(() => [...new Set(issueKeys.filter(Boolean))], [issueKeys]);
  const [selected, setSelected] = useState(keys[0] ?? '');
  const { data: issue, isLoading } = useIssueDetail(selected || undefined);
  const { data: config } = useConfig();

  useEffect(() => {
    setSelected((current) => (keys.includes(current) ? current : keys[0] ?? ''));
  }, [keys]);

  if (keys.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--md-accent)' }}>
          Linked Jira
        </span>
        {issue && config?.jiraBaseUrl && (
          <a
            href={`${config.jiraBaseUrl}/browse/${issue.jiraKey}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[12px] font-medium transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-secondary)' }}
          >
            <ExternalLink size={10} /> Open in Jira
          </a>
        )}
      </div>

      {keys.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {keys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSelected(key)}
              className="rounded-md px-2 py-0.5 text-[12px] font-semibold transition-all"
              style={{
                background: key === selected ? 'var(--md-accent-glow)' : 'var(--bg-tertiary)',
                color: key === selected ? 'var(--md-accent)' : 'var(--text-secondary)',
                border: `1px solid ${key === selected ? 'color-mix(in srgb, var(--md-accent) 42%, transparent)' : 'var(--border)'}`,
              }}
            >
              {key}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-lg px-3 py-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <LoaderCircle size={14} className="animate-spin" style={{ color: 'var(--md-accent)' }} />
          <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>Loading issue context…</span>
        </div>
      ) : issue ? (
        <div className="rounded-lg px-3 py-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-bold uppercase tracking-[0.08em]" style={{ background: 'var(--md-accent-glow)', color: 'var(--md-accent)' }}>
              <Bug size={10} /> {issue.jiraKey}
            </span>
            <span className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              {issue.statusName}
            </span>
            <span className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              {issue.priorityName}
            </span>
          </div>
          <p className="mt-2 text-[13px] font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>
            {issue.summary}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <span>Assignee: <b style={{ color: 'var(--text-secondary)' }}>{issue.assigneeName ?? 'Unassigned'}</b></span>
            {(issue.developmentDueDate || issue.dueDate) && (
              <span>Due: <b style={{ color: 'var(--text-secondary)' }}>{issue.developmentDueDate ?? issue.dueDate}</b></span>
            )}
            {issue.aspenSeverity && <span>Severity: <b style={{ color: 'var(--text-secondary)' }}>{issue.aspenSeverity}</b></span>}
            {issue.component && <span>Component: <b style={{ color: 'var(--text-secondary)' }}>{issue.component}</b></span>}
          </div>
        </div>
      ) : (
        <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)', border: '1px dashed var(--border)' }}>
          Issue details not available in cache.
        </div>
      )}
    </div>
  );
}
