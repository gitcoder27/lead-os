import { useEffect, useRef, useState } from 'react';
import { Link2, Plus, Search, UserCircle, X } from 'lucide-react';
import { useAddManagerDeskLink, useManagerDeskDeveloperLookup, useManagerDeskIssueLookup } from '@/hooks/useManagerDesk';

export function LinkSearchPanel({
  type,
  itemId,
  date,
  onClose,
  addLink,
}: {
  type: 'issue' | 'developer' | 'external';
  itemId: number;
  date?: string;
  onClose: () => void;
  addLink: ReturnType<typeof useAddManagerDeskLink>;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: issues } = useManagerDeskIssueLookup(query, type === 'issue');
  const { data: developers } = useManagerDeskDeveloperLookup(query, date, type === 'developer');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const addIssue = (jiraKey: string) => {
    addLink.mutate({ itemId, linkType: 'issue', issueKey: jiraKey } as Parameters<typeof addLink.mutate>[0]);
    onClose();
  };

  const addDeveloper = (accountId: string) => {
    addLink.mutate(
      { itemId, linkType: 'developer', developerAccountId: accountId } as Parameters<typeof addLink.mutate>[0],
    );
    onClose();
  };

  const addExternal = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    addLink.mutate(
      { itemId, linkType: 'external_group', externalLabel: trimmed } as Parameters<typeof addLink.mutate>[0],
    );
    onClose();
  };

  return (
    <div
      className="overflow-hidden rounded-[18px]"
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid color-mix(in srgb, var(--md-accent) 50%, var(--border) 50%)',
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Link2 size={12} style={{ color: 'var(--md-accent)' }} />
        <Search size={12} style={{ color: 'var(--text-muted)' }} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && type === 'external') addExternal();
          }}
          placeholder={placeholderByType[type]}
          className="flex-1 bg-transparent text-[13px] outline-none"
          style={{ color: 'var(--text-primary)' }}
        />
        <button onClick={onClose} style={{ color: 'var(--text-muted)' }} aria-label="Close link search">
          <X size={12} />
        </button>
      </div>

      {type === 'issue' ? (
        <IssueResults issues={issues ?? []} onSelect={addIssue} />
      ) : type === 'developer' ? (
        <DeveloperResults developers={developers ?? []} onSelect={addDeveloper} />
      ) : query.trim() ? (
        <ExternalAction query={query.trim()} onAdd={addExternal} />
      ) : null}
    </div>
  );
}

const placeholderByType = {
  issue: 'Search issues...',
  developer: 'Search developers...',
  external: 'Type external group name and press Enter...',
} as const;

function IssueResults({
  issues,
  onSelect,
}: {
  issues: Array<{ jiraKey: string; summary: string }>;
  onSelect: (jiraKey: string) => void;
}) {
  if (issues.length === 0) return null;

  return (
    <div className="max-h-40 overflow-y-auto border-t" style={{ borderColor: 'var(--border)' }}>
      {issues.map((issue) => (
        <button
          key={issue.jiraKey}
          onClick={() => onSelect(issue.jiraKey)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:opacity-80"
          style={{ background: 'transparent' }}
        >
          <span className="text-[12px] font-mono font-bold" style={{ color: 'var(--accent)' }}>
            {issue.jiraKey}
          </span>
          <span className="flex-1 truncate text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            {issue.summary}
          </span>
        </button>
      ))}
    </div>
  );
}

function DeveloperResults({
  developers,
  onSelect,
}: {
  developers: Array<{
    accountId: string;
    displayName: string;
    email?: string;
    availability?: import('@/types').DeveloperAvailability;
  }>;
  onSelect: (accountId: string) => void;
}) {
  if (developers.length === 0) return null;

  return (
    <div className="max-h-40 overflow-y-auto border-t" style={{ borderColor: 'var(--border)' }}>
      {developers.map((developer) => (
        <button
          key={developer.accountId}
          onClick={() => onSelect(developer.accountId)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:opacity-80"
          style={{ background: 'transparent' }}
        >
          <UserCircle size={14} style={{ color: 'var(--info)' }} />
          <span className="text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
            {developer.displayName}
          </span>
          {developer.availability?.state === 'inactive' ? (
            <span
              className="rounded-full px-1.5 py-0.5 text-[11px] font-bold uppercase"
              style={{ background: 'rgba(245, 158, 11, 0.12)', color: 'var(--warning)' }}
            >
              Inactive
            </span>
          ) : null}
          {developer.email ? (
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {developer.email}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function ExternalAction({
  query,
  onAdd,
}: {
  query: string;
  onAdd: () => void;
}) {
  return (
    <div className="border-t px-3 py-2" style={{ borderColor: 'var(--border)' }}>
      <button
        onClick={onAdd}
        className="flex items-center gap-1.5 text-[12px] font-medium transition-colors"
        style={{ color: 'var(--md-accent)' }}
      >
        <Plus size={11} /> Add "{query}"
      </button>
    </div>
  );
}
