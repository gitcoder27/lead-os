import { Circle, Users } from 'lucide-react';

interface TrackerAssignmentsCellProps {
  activeCount: number;
  developerNames: string[];
}

function buildLabel(activeCount: number, developerNames: string[]): string {
  if (activeCount === 0) {
    return 'No Team Tracker tasks linked';
  }

  const developerLabel = developerNames.length > 0 ? `: ${developerNames.join(', ')}` : '';
  const taskLabel = activeCount === 1 ? 'task' : 'tasks';
  return `${activeCount} Team Tracker ${taskLabel} linked${developerLabel}`;
}

export function TrackerAssignmentsCell({
  activeCount,
  developerNames,
}: TrackerAssignmentsCellProps) {
  const label = buildLabel(activeCount, developerNames);

  if (activeCount === 0) {
    return (
      <span
        role="img"
        className="inline-flex items-center justify-center"
        title={label}
        aria-label={label}
      >
        <Circle size={12} style={{ color: 'var(--text-muted)', opacity: 0.65 }} />
      </span>
    );
  }

  return (
    <span
      role="img"
      className="inline-flex min-w-[2.25rem] items-center justify-center gap-1 rounded-full px-1.5 py-0.5 text-[12px] font-semibold"
      title={label}
      aria-label={label}
      style={{
        background: 'var(--accent-glow)',
        color: 'var(--accent)',
        border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)',
      }}
    >
      <Users size={11} />
      <span>{activeCount}</span>
    </span>
  );
}
