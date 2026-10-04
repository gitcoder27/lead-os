import { useEffect, useMemo, useRef, useState } from 'react';
import { ListPlus, SquarePlus } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAddDailyNoteTaskUpdate } from '@/hooks/useDailyNotes';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { CaptureBox } from '@/components/capture/CaptureBox';
import { Dialog } from '@/components/ui/Dialog';
import { TaskPicker, parseTaskKeys, taskKeysForSubmit, type TaskPickerTask } from '@/components/tasks/TaskPicker';
import { lineContent, prettyNoteDate, splitTitleAndContext, stripMention } from '@/lib/note-markdown';
import type { ManagerDeskDeveloperLookupItem } from '@/types/manager-desk';
import type { DailyNoteKind } from '@/types';
import type { CaptureDefaults } from 'shared/capture-grammar';
import {
  NOTES_INPUT_CLASS,
  NOTES_INPUT_STYLE,
  NotesDialogShell,
  NotesField,
  NotesFormError,
  NotesSubmitButton,
  noteSourceLabel,
} from './NotesDialogPrimitives';

export type NotesTaskActionMode = 'update' | 'create';

export interface NotesTaskActionInference {
  taskKey?: string | null;
  developer?: ManagerDeskDeveloperLookupItem | null;
  jiraKey?: string | null;
}

interface NotesTaskActionDialogProps {
  open: boolean;
  mode: NotesTaskActionMode;
  noteDate: string;
  noteKind?: DailyNoteKind;
  selectedText: string;
  /** F8: targets pre-picked from what the line says. */
  inference?: NotesTaskActionInference;
  onClose: () => void;
  /** Called with the task the text landed on, so the note can mark the line (F7). */
  onDone?: (result: { taskKey: string }) => void;
}

const TITLE_MAX = 500;
const TEXT_MAX = 4000;

const EVENT_TYPES = [
  { value: 'update', label: 'Update' },
  { value: 'instruction', label: 'Instruction' },
  { value: 'decision', label: 'Decision' },
] as const;

/** Update body: every line's content, markers and list syntax stripped. */
function updateText(text: string): string {
  return text
    .split('\n')
    .map(lineContent)
    .filter((line) => line.length > 0)
    .join('\n')
    .slice(0, TEXT_MAX);
}

export function NotesTaskActionDialog(props: NotesTaskActionDialogProps) {
  // docs/56 UX-10: "Create task" is the shared capture box; only updates keep their own form.
  return props.mode === 'create' ? <NotesCreateTaskDialog {...props} /> : <NotesTaskUpdateDialog {...props} />;
}

/**
 * docs/56 UX-10: the line becomes a capture. The inferred person is the owner pill (and their
 * `@mention` leaves the title), and the note source, a Jira key and the rest of the selection ride
 * as `defaults`, so the server writes the same task the old form did.
 */
function NotesCreateTaskDialog({ open, noteDate, noteKind, selectedText, inference, onClose, onDone }: NotesTaskActionDialogProps) {
  const { title, context } = useMemo(() => splitTitleAndContext(selectedText, TITLE_MAX), [selectedText]);
  const developer = inference?.developer ?? null;
  const jiraKey = inference?.jiraKey ?? null;
  const prefill = developer ? stripMention(title, developer) : title;
  const contextNote = context.slice(0, TEXT_MAX);
  const defaults = useMemo<CaptureDefaults>(() => ({
    ...(contextNote ? { contextNote } : {}),
    ...(jiraKey ? { links: { jiraKeys: [jiraKey] } } : {}),
    source: { type: 'note', noteDate, ...(noteKind ? { noteKind } : {}) },
  }), [contextNote, jiraKey, noteDate, noteKind]);
  if (!open) return null;
  const extraLines = contextNote ? contextNote.split('\n').length : 0;
  const hints = [
    extraLines ? `${extraLines} more ${extraLines === 1 ? 'line becomes' : 'lines become'} a private first update` : null,
    jiraKey ? `Links ${jiraKey}` : null,
  ].filter(Boolean);
  return (
    <Dialog
      title="Create task"
      subtitle={noteSourceLabel(prettyNoteDate(noteDate, 'EEE, MMM d'))}
      icon={<SquarePlus size={14} />}
      flush
      onClose={onClose}
    >
      {hints.length > 0 && (
        <p className="px-4 pt-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>{hints.join(' · ')}</p>
      )}
      <CaptureBox
        prefill={prefill}
        assignee={developer ? { accountId: developer.accountId, displayName: developer.displayName } : undefined}
        defaults={defaults}
        onClose={onClose}
        onCaptured={({ taskKey }) => { if (taskKey) onDone?.({ taskKey }); }}
      />
    </Dialog>
  );
}

function NotesTaskUpdateDialog({ open, noteDate, noteKind, selectedText, inference, onClose, onDone }: NotesTaskActionDialogProps) {
  const { addToast } = useToast();
  const addUpdate = useAddDailyNoteTaskUpdate(noteDate);

  const [text, setText] = useState('');
  const [taskQuery, setTaskQuery] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [eventType, setEventType] = useState<'update' | 'instruction' | 'decision'>('update');
  const [visibility, setVisibility] = useState<'shared' | 'private'>('private');
  const [formError, setFormError] = useState<string | null>(null);
  const requestKeyRef = useRef<{ key: string; id: string } | null>(null);

  const search = useGlobalSearch(taskQuery, { enabled: open });

  const inferredKey = inference?.taskKey ?? null;

  const taskCandidates = useMemo<TaskPickerTask[]>(() => {
    const seen = new Map<string, TaskPickerTask>();
    if (inferredKey) {
      seen.set(inferredKey, { taskKey: inferredKey, title: 'Mentioned in this line' });
    }
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
  }, [inferredKey, search.data, taskQuery, text]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setText(updateText(selectedText));
    setTaskQuery('');
    setSelectedKeys(inference?.taskKey ? [inference.taskKey] : []);
    setEventType('update');
    setVisibility('private');
    setFormError(null);
    requestKeyRef.current = null;
  }, [open, selectedText, inference]);

  const sourceLabel = noteSourceLabel(prettyNoteDate(noteDate, 'EEE, MMM d'));

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
    const taskKey = keys[0]!;

    addUpdate.mutate(
      {
        taskKey,
        text: trimmed,
        type: eventType,
        visibility,
        requestId: requestKeyRef.current.id,
        kind: noteKind,
      },
      {
        onSuccess: () => {
          addToast(`Update added to ${taskKey}`, 'success');
          requestKeyRef.current = null;
          onDone?.({ taskKey });
          onClose();
        },
        onError: (error) => setFormError(error.message),
      },
    );
  };

  const isPending = addUpdate.isPending;

  return (
    <NotesDialogShell
      open={open}
      onClose={onClose}
      title="Add as task update"
      sourceLabel={sourceLabel}
      footer={
        <NotesSubmitButton onClick={handleSubmitUpdate} disabled={isPending}>
          <ListPlus size={12} />
          {isPending ? 'Adding…' : 'Add update'}
        </NotesSubmitButton>
      }
    >
      <NotesField label="Update text" htmlFor="note-task-update-text">
        <textarea
          id="note-task-update-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={TEXT_MAX}
          rows={4}
          placeholder="What should land on the task timeline?"
          className={`${NOTES_INPUT_CLASS} resize-none`}
          style={NOTES_INPUT_STYLE}
        />
      </NotesField>
      <NotesField label="Task" htmlFor="note-task-update-search">
        <input
          id="note-task-update-search"
          type="text"
          value={taskQuery}
          onChange={(event) => setTaskQuery(event.target.value)}
          placeholder="Search tasks or type a key like T-12"
          className={NOTES_INPUT_CLASS}
          style={NOTES_INPUT_STYLE}
        />
        <div className="mt-2">
          <TaskPicker tasks={taskCandidates} text={`${taskQuery} ${text}`} selected={selectedKeys} onChange={setSelectedKeys} />
          {taskCandidates.length === 0 && taskQuery.trim().length >= 2 ? (
            <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {search.isLoading ? 'Searching…' : 'No tasks matched — type a task key like T-12.'}
            </p>
          ) : null}
        </div>
      </NotesField>
      {/* F8: type + visibility collapse into one quiet row. */}
      <div className="notes-quiet-row">
        <label className="sr-only" htmlFor="note-task-update-type">
          Type
        </label>
        <select
          id="note-task-update-type"
          value={eventType}
          onChange={(event) => setEventType(event.target.value as typeof eventType)}
          className="notes-quiet-select"
        >
          {EVENT_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span aria-hidden="true">·</span>
        <label className="sr-only" htmlFor="note-task-update-visibility">
          Visibility
        </label>
        <select
          id="note-task-update-visibility"
          value={visibility}
          onChange={(event) => setVisibility(event.target.value as typeof visibility)}
          className="notes-quiet-select"
        >
          <option value="private">Only me</option>
          <option value="shared">Shared with developer</option>
        </select>
      </div>
      <NotesFormError message={formError} />
    </NotesDialogShell>
  );
}
