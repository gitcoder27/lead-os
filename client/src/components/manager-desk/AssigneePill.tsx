import type { ManagerDeskAssignee } from '@/types/manager-desk';

interface AssigneePillProps {
  assignee?: ManagerDeskAssignee;
  size?: 'xs' | 'sm' | 'md';
  tone?: 'accent' | 'neutral';
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function AssigneePill({
  assignee,
  size = 'md',
  tone = 'accent',
}: AssigneePillProps) {
  if (!assignee) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]"
        style={{
          borderColor: 'var(--border)',
          background: 'color-mix(in srgb, var(--bg-secondary) 92%, transparent)',
          color: 'var(--text-muted)',
        }}
      >
        Unassigned
      </span>
    );
  }

  const avatarSize =
    size === 'xs' ? 'h-4 w-4 text-[11px]' : size === 'sm' ? 'h-5 w-5 text-[11px]' : 'h-7 w-7 text-[12px]';
  const textSize = size === 'xs' ? 'text-[11px]' : size === 'sm' ? 'text-[12px]' : 'text-[12px]';
  const pillPadding =
    size === 'xs' ? 'gap-1 rounded-full border px-1 py-0.5 pr-1.5' : 'gap-2 rounded-full border px-1.5 py-1 pr-2.5';
  const toneStyle =
    tone === 'accent'
      ? {
          borderColor: 'color-mix(in srgb, var(--md-accent) 28%, transparent)',
          background: 'color-mix(in srgb, var(--md-accent) 14%, var(--bg-elevated))',
          color: 'var(--text-primary)',
        }
      : {
          borderColor: 'var(--border)',
          background: 'color-mix(in srgb, var(--bg-secondary) 94%, transparent)',
          color: 'var(--text-primary)',
        };

  return (
    <span
      className={`inline-flex max-w-full items-center ${pillPadding}`}
      style={toneStyle}
      title={assignee.availability?.state === 'inactive' && assignee.availability.note
        ? `${assignee.displayName} — ${assignee.availability.note}`
        : assignee.displayName}
    >
      <span
        className={`inline-flex ${avatarSize} shrink-0 items-center justify-center rounded-full font-bold uppercase tracking-[0.08em]`}
        style={{
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--md-accent) 84%, white) 0%, var(--md-accent) 100%)',
          color: '#1f1600',
          boxShadow: '0 6px 18px rgba(217, 169, 78, 0.24)',
        }}
      >
        {initialsFor(assignee.displayName) || 'TM'}
      </span>
      <span className={`truncate font-semibold ${textSize}`}>{assignee.displayName}</span>
      {assignee.availability?.state === 'inactive' && (
        <span
          className="rounded-full px-1 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em]"
          style={{ background: 'rgba(245, 158, 11, 0.14)', color: 'var(--warning)' }}
        >
          Inactive
        </span>
      )}
    </span>
  );
}
