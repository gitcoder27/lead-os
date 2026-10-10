import { formatDate, isDueToday, isOverdue } from '@/lib/utils';

export function DueDateCell({ date }: { date?: string }) {
  if (!date) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  }

  const overdue = isOverdue(date);
  const today = isDueToday(date);

  return (
    <span
      className="text-body font-mono tabular-nums"
      style={{
        color: overdue
          ? 'var(--danger)'
          : today
          ? 'var(--warning)'
          : 'var(--text-secondary)',
        fontWeight: overdue || today ? 600 : 400,
      }}
    >
      {formatDate(date)}
    </span>
  );
}
