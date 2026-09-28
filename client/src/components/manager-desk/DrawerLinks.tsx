import { useMemo, useState, type ReactNode } from 'react';
import { Bug, UserCircle, Users, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { useAddManagerDeskLink } from '@/hooks/useManagerDesk';
import type { ManagerDeskItem } from '@/types/manager-desk';
import { JiraIssueLink } from '@/components/JiraIssueLink';
import { LinkSearchPanel } from './LinkSearchPanel';
import { DrawerLinkedJira } from './DrawerLinkedJira';

interface DrawerLinksProps {
  item: ManagerDeskItem;
  date: string;
  readOnly?: boolean;
  addLink: ReturnType<typeof useAddManagerDeskLink>;
  onDeleteLink: (linkId: number) => void;
}

const linkIcons: Record<string, ReactNode> = {
  issue: <Bug size={11} style={{ color: 'var(--accent)' }} />,
  developer: <UserCircle size={11} style={{ color: 'var(--info)' }} />,
  external_group: <Users size={11} style={{ color: 'var(--text-secondary)' }} />,
};

export function DrawerLinks({ item, date, readOnly = false, addLink, onDeleteLink }: DrawerLinksProps) {
  const [showSearch, setShowSearch] = useState<'issue' | 'developer' | 'external' | null>(null);
  const issueKeys = useMemo(
    () => item.links.filter((l) => l.linkType === 'issue' && Boolean(l.issueKey)).map((l) => l.issueKey!),
    [item.links],
  );

  return (
    <div className="space-y-4 px-5 py-4">
      <DrawerLinkedJira issueKeys={issueKeys} />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>
            Connections
          </span>
          {!readOnly && (
            <div className="flex items-center gap-1">
              <AddButton icon={<Bug size={10} />} label="Issue" onClick={() => setShowSearch('issue')} />
              <AddButton icon={<UserCircle size={10} />} label="Dev" onClick={() => setShowSearch('developer')} />
              <AddButton icon={<Users size={10} />} label="External" onClick={() => setShowSearch('external')} />
            </div>
          )}
        </div>

        {item.links.length > 0 ? (
          <div className="space-y-1">
            {item.links.map((link) => (
              <div
                key={link.id}
                className="group flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
              >
                {linkIcons[link.linkType]}
                {link.linkType === 'issue' && link.issueKey ? (
                  <JiraIssueLink issueKey={link.issueKey} className="flex-1 truncate text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
                    {link.displayLabel}
                  </JiraIssueLink>
                ) : (
                  <span className="flex-1 truncate text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>{link.displayLabel}</span>
                )}
                {!readOnly && (
                  <button
                    onClick={() => onDeleteLink(link.id)}
                    className="transition-opacity group-hover:opacity-100 xl:opacity-0"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label={`Remove ${link.displayLabel}`}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg px-2.5 py-2 text-[12px]" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)', border: '1px dashed var(--border)' }}>
            No linked context yet.
          </div>
        )}

        {showSearch && !readOnly && (
          <LinkSearchPanel type={showSearch} itemId={item.id} date={date} onClose={() => setShowSearch(null)} addLink={addLink} />
        )}
      </div>

      <div className="flex flex-wrap gap-x-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>
        <span>Created {formatSafe(item.createdAt)}</span>
        <span>Updated {formatSafe(item.updatedAt)}</span>
        {item.completedAt && <span>Completed {formatSafe(item.completedAt)}</span>}
      </div>
    </div>
  );
}

function AddButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] transition-all hover:brightness-110"
      style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
    >
      {icon} {label}
    </button>
  );
}

function formatSafe(iso: string): string {
  try {
    return format(parseISO(iso), 'MMM d, yyyy HH:mm');
  } catch {
    return iso;
  }
}
