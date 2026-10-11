/**
 * docs/73 UXD-20: status as a dot and a sentence-case label ("To do"), not a tinted pill —
 * the dot carries the state, the words stay quiet.
 */
const STATUS_DOTS: Record<string, string> = {
  'to do': 'var(--text-muted)',
  'in progress': 'var(--accent)',
  done: 'var(--success)',
  blocked: 'var(--danger)',
};

export function statusLabel(status: string): string {
  const lower = status.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function StatusBadge({ status }: { status: string }) {
  const dot = STATUS_DOTS[status.toLowerCase()] ?? 'var(--text-disabled)';
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ui" style={{ color: 'var(--text-secondary)' }} title={status}>
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} />
      {statusLabel(status)}
    </span>
  );
}
