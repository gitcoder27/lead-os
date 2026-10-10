const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'To Do': { bg: 'rgba(139,92,246,0.15)', text: '#A78BFA' },
  'In Progress': { bg: 'rgba(16,185,129,0.15)', text: '#34D399' },
  Done: { bg: 'rgba(75,85,99,0.15)', text: '#9CA3AF' },
  Blocked: { bg: 'rgba(239,68,68,0.15)', text: '#F87171' },
};

export function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? { bg: 'var(--bg-tertiary)', text: 'var(--text-secondary)' };

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-ui font-medium whitespace-nowrap"
      style={{ background: colors.bg, color: colors.text }}
    >
      {status}
    </span>
  );
}
