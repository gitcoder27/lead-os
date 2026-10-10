import { useEffect, useRef } from 'react';
import { useUpdateIssue } from '@/hooks/useUpdateIssue';
import { PRIORITY_OPTIONS } from '@/lib/constants';
import { priorityColor } from '@/lib/utils';
import { useToast } from '@/context/ToastContext';
import { Select } from '@/components/ui/Select';

interface InlineEditPriorityProps {
  issueKey: string;
  currentValue: string;
  onClose: () => void;
}

export function InlineEditPriority({ issueKey, currentValue, onClose }: InlineEditPriorityProps) {
  const ref = useRef<HTMLSelectElement>(null);
  const updateIssue = useUpdateIssue();
  const { addToast } = useToast();

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleChange = (value: string) => {
    if (value !== currentValue) {
      updateIssue.mutate(
        { key: issueKey, update: { priorityName: value } },
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
    <Select size="sm" variant="quiet" style={{ color: priorityColor(currentValue) }}
      ref={ref}
      value={currentValue}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={onClose}
      onClick={(e) => e.stopPropagation()}
    >
      {PRIORITY_OPTIONS.map((p) => (
        <option key={p} value={p}>{p}</option>
      ))}
    </Select>
  );
}
