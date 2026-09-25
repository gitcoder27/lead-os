import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { format, parseISO } from 'date-fns';
import { ListPlus, SquarePlus, X } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAddDailyNoteTaskUpdate, useCreateDailyNoteTask } from '@/hooks/useDailyNotes';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { DeveloperPicker } from '@/components/capture/DeveloperPicker';
import { TaskPicker, parseTaskKeys, taskKeysForSubmit, type TaskPickerTask } from '@/components/tasks/TaskPicker';
import type { ManagerDeskDeveloperLookupItem } from '@/types/manager-desk';

export type NotesTaskActionMode = 'update' | 'create';

interface NotesTaskActionDialogProps {
  open: boolean;
  mode: NotesTaskActionMode;
  noteDate: string;
  selectedText: string;
  onClose: () => void;
}

const TITLE_MAX = 500;
const TEXT_MAX = 4000;

const EVENT_TYPES = [
  { value: 'update', label: 'Update' },
  { value: 'instruction', label: 'Instruction' },
  { value: 'decision', label: 'Decision' },
] as const;

function firstLine(text: string, max: number): string {
  return (text.trim().split('\n')[0] ?? '').slice(0, max);
}

export function NotesTaskActionDialog({ open, mode, noteDate, selectedText, onClose }: NotesTaskActionDialogProps) {
  const { addToast } = useToast();
  const addUpdate = useAddDailyNoteTaskUpdate(noteDate);
  const createTask = useCreateDailyNoteTask(noteDate);

  const [text, setText] = useState('');
  const [taskQuery, setTaskQuery] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [eventType, setEventType] = useState<'update' | 'instruction' | 'decision'>('update');
  const [visibility, setVisibility] = useState<'shared' | 'private'>('private');
  const [title, setTitle] = useState('');
  const [developer, setDeveloper] = useState<ManagerDeskDeveloperLookupItem | null>(null);
  const [jiraKey, setJiraKey] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const requestKeyRef = useRef<{ key: string; id: string } | null>(null);

  const search = useGlobalSearch(taskQuery, { enabled: open && mode === 'update' });

  const taskCandidates = useMemo<TaskPickerTask[]>(() => {
    const seen = new Map<string, TaskPickerTask>();
    for (const task of search.data?.tasks ?? []) {
      if (task.taskKey && !seen.has(task.taskKey)) {
        seen.set(task.taskKey, { taskKey: task.taskKey, title: task.title });
      }
    }
    // A T-n token typed into the search box or the update text resolves
    // server-side even when search has no match, so offer it as a candidate.
    for (const key of [...parseTaskKeys(taskQuery), ...parseTaskKeys(text)]) {
      if (!seen.has(key)) {
        seen.set(key, { taskKey: key, title: 'Typed in text' });
      }
    }
    return [...seen.values()];
  }, [search.data, taskQuery, text]);

  const sourceLabel = useMemo(() => {
    try {
      return format(parseISO(noteDate), 'EEE, MMM d');
    } catch {
      return noteDate;
    }
  }, [noteDate]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const trimmed = selectedText.trim();
    setText(trimmed.slice(0, TEXT_MAX));
    setTaskQuery('');
    setSelectedKeys([]);
    setEventType('update');
    setVisibility('private');
    setTitle(firstLine(trimmed, TITLE_MAX));
    setDeveloper(null);
    setJiraKey('');
    setFormError(null);
    requestKeyRef.current = null;
  }, [open, selectedText, mode]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      onClose();
    }
  };

  const handleSubmitUpdate = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setFormError('Add the update text.');
      return;
    }
    const keys = taskKeysForSubmit(selectedKeys, `${taskQuery} ${text}`, taskCandidates);
    if (keys.length !== 1) {
      setFormError(keys.length === 0 ? 'Pick a task for this update.' : 'Pick a single task for this update.');
      return;
    }
    if (addUpdate.isPending) {
      return;
    }

    const key = JSON.stringify(['update', keys[0], trimmed, eventType, visibility]);
    if (!requestKeyRef.current || requestKeyRef.current.key !== key) {
      requestKeyRef.current = { key, id: crypto.randomUUID() };
    }

    addUpdate.mutate(
      {
        taskKey: keys[0]!,
        text: trimmed,
        type: eventType,
        visibility,
        requestId: requestKeyRef.current.id,
      },
      {
        onSuccess: () => {
          addToast(`Update added to ${keys[0]}`, 'success');
          requestKeyRef.current = null;
          onClose();
        },
        onError: (error) => setFormError(error.message),
      },
    );
  };

  const handleSubmitCreate = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError('Add a title for the task.');
      return;
    }
    if (createTask.isPending) {
      return;
    }

    const context = text.trim() || undefined;
    const key = JSON.stringify(['create', trimmedTitle, developer?.accountId ?? null, jiraKey.trim(), context ?? null]);
    if (!requestKeyRef.current || requestKeyRef.current.key !== key) {
      requestKeyRef.current = { key, id: crypto.randomUUID() };
    }

    createTask.mutate(
      {
        title: trimmedTitle,
        developerAccountId: developer?.accountId,
        jiraKey: jiraKey.trim() || undefined,
        context,
        requestId: requestKeyRef.current.id,
      },
      {
        onSuccess: (task) => {
          addToast(
            task.taskKey ? `Task ${task.taskKey} created` : 'Task created',
            'success',
          );
          requestKeyRef.current = null;
          onClose();
        },
        onError: (error) => setFormError(error.message),
      },
    );
  };

  const isPending = addUpdate.isPending || createTask.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[90]"
          style={{ background: 'rgba(4, 8, 14, 0.5)', backdropFilter: 'blur(4px)' }}
        />
        <Dialog.Content className="notes-dialog fixed z-[91] rounded-2xl border p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {mode === 'update' ? 'Add as task update' : 'Create task'}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {mode === 'update'
                  ? `Adds a timeline update sourced from your ${sourceLabel} note.`
                  : `Creates a task sourced from your ${sourceLabel} note.`}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Close task dialog"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          {mode === 'update' ? (
            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="note-task-update-text" className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Update text
                </label>
                <textarea
                  id="note-task-update-text"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  maxLength={TEXT_MAX}
                  rows={4}
                  placeholder="What should land on the task timeline?"
                  className="w-full resize-none rounded-lg px-3 py-2 text-[13px] leading-5 outline-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label htmlFor="note-task-update-search" className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Task
                </label>
                <input
                  id="note-task-update-search"
                  type="text"
                  value={taskQuery}
                  onChange={(event) => setTaskQuery(event.target.value)}
                  placeholder="Search tasks or type a key like T-12"
                  className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                />
                <div className="mt-2">
                  <TaskPicker
                    tasks={taskCandidates}
                    text={`${taskQuery} ${text}`}
                    selected={selectedKeys}
                    onChange={setSelectedKeys}
                  />
                  {taskCandidates.length === 0 && taskQuery.trim().length >= 2 ? (
                    <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {search.isLoading ? 'Searching…' : 'No tasks matched — type a task key like T-12.'}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div>
                  <label htmlFor="note-task-update-type" className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Type
                  </label>
                  <select
                    id="note-task-update-type"
                    value={eventType}
                    onChange={(event) => setEventType(event.target.value as typeof eventType)}
                    className="rounded-lg px-2.5 py-1.5 text-[13px] outline-none"
                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                  >
                    {EVENT_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <fieldset className="min-w-0">
                  <legend className="mb-1 text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Visibility
                  </legend>
                  <div className="flex items-center gap-3 text-[13px]" style={{ color: 'var(--text-primary)' }}>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="note-task-update-visibility"
                        checked={visibility === 'private'}
                        onChange={() => setVisibility('private')}
                      />
                      Only me
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="note-task-update-visibility"
                        checked={visibility === 'shared'}
                        onChange={() => setVisibility('shared')}
                      />
                      Shared with developer
                    </label>
                  </div>
                </fieldset>
              </div>
              {formError ? (
                <p className="text-[12px]" style={{ color: 'var(--danger)' }} role="alert">
                  {formError}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="note-task-title" className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Title
                </label>
                <input
                  id="note-task-title"
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={TITLE_MAX}
                  placeholder="What needs to happen?"
                  className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <span className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Assign to
                </span>
                <DeveloperPicker
                  date={noteDate}
                  selected={developer}
                  onSelect={setDeveloper}
                  onClear={() => setDeveloper(null)}
                />
                <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Leave unassigned to send the task to your Manager Desk inbox.
                </p>
              </div>
              <div>
                <label htmlFor="note-task-jira" className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Jira key <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
                </label>
                <input
                  id="note-task-jira"
                  type="text"
                  value={jiraKey}
                  onChange={(event) => setJiraKey(event.target.value)}
                  placeholder="AM-123"
                  className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label htmlFor="note-task-context" className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Context <span style={{ color: 'var(--text-muted)' }}>(private first update)</span>
                </label>
                <textarea
                  id="note-task-context"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  maxLength={TEXT_MAX}
                  rows={3}
                  placeholder="Context lands on the task timeline as a private update"
                  className="w-full resize-none rounded-lg px-3 py-2 text-[13px] leading-5 outline-none"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                />
              </div>
              {formError ? (
                <p className="text-[12px]" style={{ color: 'var(--danger)' }} role="alert">
                  {formError}
                </p>
              ) : null}
            </div>
          )}

          <div className="mt-5 flex items-center justify-end gap-2">
            <Dialog.Close asChild>
              <button type="button" className="notes-button secondary">
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={mode === 'update' ? handleSubmitUpdate : handleSubmitCreate}
              disabled={isPending}
              className="notes-button"
              style={{ background: 'var(--accent)', color: '#fff', border: '1px solid transparent' }}
            >
              {mode === 'update' ? <ListPlus size={12} /> : <SquarePlus size={12} />}
              {isPending
                ? mode === 'update'
                  ? 'Adding…'
                  : 'Creating…'
                : mode === 'update'
                  ? 'Add update'
                  : 'Create task'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
