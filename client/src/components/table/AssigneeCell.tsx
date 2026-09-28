export function AssigneeCell({ name }: { name?: string }) {
  if (!name) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  }
  return (
    <span className="flex items-center gap-2 group/assignee">
      <span
        className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-semibold uppercase transition-all duration-150 group-hover/assignee:ring-2 ring-[var(--accent)]"
        style={{
          background: 'var(--bg-tertiary)',
          color: 'var(--text-secondary)',
        }}
      >
        {name.charAt(0)}
      </span>
      <span className="text-[13px] truncate" style={{ color: 'var(--text-primary)' }}>
        {name}
      </span>
    </span>
  );
}
