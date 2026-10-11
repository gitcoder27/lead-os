import { format, parseISO } from 'date-fns';
import { isDueToday, isOverdue } from '@/lib/utils';

/** docs/73 UXD-20: "Thu 8 Oct" in tabular sans; lateness is the colour, not a monospace pill. */
export function DueDateCell({ date }: { date?: string }) {
  if (!date) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  }
  const overdue = isOverdue(date);
  const today = isDueToday(date);
  const parsed = parseISO(date);
  const label = Number.isNaN(parsed.getTime()) ? date : format(parsed, 'EEE d MMM');
  return (
    <span
      className="whitespace-nowrap text-body tabular-nums"
      style={{
        color: overdue ? 'var(--task-danger-text)' : today ? 'var(--task-warning-text)' : 'var(--text-secondary)',
        fontWeight: overdue || today ? 500 : 400,
      }}
      title={overdue ? 'Overdue' : today ? 'Due today' : undefined}
    >
      {label}
    </span>
  );
}
