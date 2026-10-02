import { useUpdateIssue } from '@/hooks/useUpdateIssue';
import { useToast } from '@/context/ToastContext';
import { IssueDateEditor } from './IssueDateEditor';

interface InlineEditDueDateProps {
  issueKey: string;
  currentValue?: string;
  onClose: () => void;
}

export function InlineEditDueDate({ issueKey, currentValue, onClose }: InlineEditDueDateProps) {
  const updateIssue = useUpdateIssue();
  const { addToast } = useToast();

  const save = (value: string | null) =>
    updateIssue.mutate(
      { key: issueKey, update: { developmentDueDate: value } },
      {
        onError: (error) =>
          addToast({
            type: 'error',
            title: `Failed to update ${issueKey}`,
            message: error.message,
            action: { label: 'Retry', onClick: () => save(value) },
          }),
      },
    );

  return (
    <IssueDateEditor
      currentValue={currentValue}
      onSave={save}
      onClose={onClose}
      label={`Due date for ${issueKey}`}
      className="text-[13px] px-1.5 py-0.5 rounded cursor-pointer font-mono"
      style={{
        background: 'var(--bg-tertiary)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-active)',
      }}
    />
  );
}
