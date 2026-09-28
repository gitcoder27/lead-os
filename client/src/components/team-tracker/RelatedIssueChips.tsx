import { JiraIssueLink } from '@/components/JiraIssueLink';

interface RelatedIssueChipsProps {
  issueKeys?: string[];
  muted?: boolean;
  compact?: boolean;
  link?: boolean;
  className?: string;
}

export function RelatedIssueChips({
  issueKeys,
  muted = false,
  compact = false,
  link = true,
  className,
}: RelatedIssueChipsProps) {
  const keys = (issueKeys ?? []).filter(Boolean);
  if (keys.length === 0) {
    return null;
  }

  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-1 ${className ?? ''}`}>
      <span
        className="text-[11px] font-semibold uppercase"
        style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}
      >
        Related
      </span>
      {keys.map((issueKey) => {
        const className = `font-mono font-semibold ${compact ? 'text-[11px]' : 'text-[12px]'} rounded-full px-1.5 py-0.5`;
        const style = {
          color: muted ? 'var(--text-muted)' : 'var(--accent)',
          background: muted ? 'var(--bg-tertiary)' : 'var(--accent-glow)',
          border: `1px solid ${muted ? 'var(--border)' : 'color-mix(in srgb, var(--accent) 22%, transparent)'}`,
        };

        return link ? (
          <JiraIssueLink key={issueKey} issueKey={issueKey} className={className} style={style}>
            {issueKey}
          </JiraIssueLink>
        ) : (
          <span key={issueKey} className={className} style={style}>
            {issueKey}
          </span>
        );
      })}
    </div>
  );
}
