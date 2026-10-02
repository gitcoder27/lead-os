import { useEffect, useRef } from 'react';
import { useUpdateIssue } from '@/hooks/useUpdateIssue';
import { useDevelopers } from '@/hooks/useDevelopers';
import { useToast } from '@/context/ToastContext';
import { getLocalIsoDate } from '@/lib/utils';

interface InlineEditAssigneeProps {
  issueKey: string;
  currentId?: string;
  onClose: () => void;
}

export function InlineEditAssignee({ issueKey, currentId, onClose }: InlineEditAssigneeProps) {
  const ref = useRef<HTMLSelectElement>(null);
  const { data: developers } = useDevelopers(getLocalIsoDate(), { includeUnavailable: true });
  const jiraLinkedDevelopers = developers?.filter(
    (developer) => Boolean(developer.jiraAccountId) || developer.source !== 'manual'
  ) ?? [];
  const assignmentOptions = jiraLinkedDevelopers
    .map((developer) => ({
      developer,
      value: developer.jiraAccountId ?? developer.accountId,
    }))
    .filter(({ developer, value }) =>
      developer.availability?.state !== 'inactive' || value === currentId || developer.accountId === currentId
    );
  const updateIssue = useUpdateIssue();
  const { addToast } = useToast();

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleChange = (value: string) => {
    if (value !== (currentId ?? '')) {
      updateIssue.mutate(
        { key: issueKey, update: { assigneeId: value || null } },
        {
          onError: (err) => {
            addToast({ type: 'error', title: `Failed to update ${issueKey}`, message: err.message });
          },
        }
      );
    }
    onClose();
  };

  return (
    <select
      ref={ref}
      value={currentId ?? ''}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={onClose}
      onClick={(e) => e.stopPropagation()}
      className="text-[13px] px-1.5 py-0.5 rounded cursor-pointer max-w-[110px]"
      style={{
        background: 'var(--bg-tertiary)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-active)',
        outline: 'none',
      }}
    >
      <option value="">Unassigned</option>
      {assignmentOptions.map(({ developer, value }) => (
        <option
          key={developer.accountId}
          value={value}
          disabled={developer.availability?.state === 'inactive'}
        >
          {developer.availability?.state === 'inactive'
            ? `${developer.displayName} (inactive)`
            : developer.displayName}
        </option>
      ))}
    </select>
  );
}
