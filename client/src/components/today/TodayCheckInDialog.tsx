import { useId, useState } from 'react';
import { TaskPicker, taskKeysForSubmit, type TaskPickerTask } from '@/components/tasks/TaskPicker';
import { TodayDialog, TodayDialogActions, TodayDialogError } from './TodayDialog';

interface TodayCheckInDialogProps {
  developerName: string;
  defaultSummary?: string;
  /** docs/53 F15: the row's signal as a hint, never a pre-filled value. */
  placeholder?: string;
  /** docs/56 P1-04: for someone who does not check in this is a manager note. */
  note?: boolean;
  /** Tasks that can be tagged on this check-in (developer's current + planned work). */
  tasks?: TaskPickerTask[];
  /** docs/53 F2: task keys pre-selected from the action's target context. */
  initialTaskKeys?: string[];
  isSaving: boolean;
  /** docs/53 F9: surfaced inline when the save mutation fails. */
  errorMessage?: string;
  onClose: () => void;
  onSave: (summary: string, taskKeys: string[]) => void;
}

export function TodayCheckInDialog({
  developerName,
  defaultSummary = '',
  placeholder = 'What did you hear?',
  note = false,
  tasks = [],
  initialTaskKeys = [],
  isSaving,
  errorMessage,
  onClose,
  onSave,
}: TodayCheckInDialogProps) {
  const [summary, setSummary] = useState(defaultSummary);
  const [taskKeys, setTaskKeys] = useState<string[]>(initialTaskKeys);
  const fieldId = useId();
  // docs/53 F2: pre-selected context tasks may be absent from the day's
  // candidate list (e.g. the item rolled off the plan) — render them anyway so
  // the chip survives taskKeysForSubmit's known-key filter.
  const pickerTasks = initialTaskKeys.length
    ? [...tasks, ...initialTaskKeys.filter((key) => !tasks.some((task) => task.taskKey === key)).map((taskKey) => ({ taskKey, title: taskKey }))]
    : tasks;
  const canSave = summary.trim().length > 0 && !isSaving;
  const save = () => {
    if (canSave) onSave(summary, taskKeysForSubmit(taskKeys, summary, pickerTasks));
  };

  return (
    <TodayDialog
      title={note ? 'Add note' : 'Add check-in'}
      subtitle={developerName}
      onClose={onClose}
      onSubmit={save}
      footer={<TodayDialogActions saveLabel={note ? 'Save note' : 'Save check-in'} submitKey="enter" isSaving={isSaving} canSave={canSave} onCancel={onClose} onSave={save} />}
    >
      <label htmlFor={fieldId} className="ui-field-label">{note ? 'Note' : 'Check-in note'}</label>
      <textarea
        id={fieldId}
        data-autofocus
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        onKeyDown={(event) => {
          // docs/54 K3: a check-in composer posts on Enter everywhere (⇧↵ newline).
          if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            save();
          }
        }}
        rows={4}
        className="ui-field"
        placeholder={placeholder}
      />
      {pickerTasks.length > 0 && (
        <div className="mt-3">
          <TaskPicker tasks={pickerTasks} text={summary} selected={taskKeys} onChange={setTaskKeys} />
        </div>
      )}
      <TodayDialogError message={errorMessage} />
    </TodayDialog>
  );
}
