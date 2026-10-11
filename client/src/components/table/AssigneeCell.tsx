import { Avatar } from '@/components/ui/Avatar';

/** docs/73 UXD-20: the shared person avatar, so a developer is the same colour here as on Team and Tasks. */
export function AssigneeCell({ name, accountId }: { name?: string; accountId?: string }) {
  if (!name) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={name} seed={accountId} size={22} />
      <span className="truncate text-body" style={{ color: 'var(--text-primary)' }}>
        {name}
      </span>
    </span>
  );
}
