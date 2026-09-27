import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { addDays, format, parseISO } from 'date-fns';
import { CheckCheck, X } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAppendDailyNote, useCreateDailyNoteFollowUp, useCreateDailyNoteTask } from '@/hooks/useDailyNotes';
import { followUpPresets } from '@/components/tasks/task-detail-format';
import { getLocalIsoDate } from '@/lib/utils';
import {
  appendProvenance,
  carryText,
  dropLine,
  inferFromText,
  prettyNoteDate,
  type NoteDeveloper,
  type WrapUpCandidate,
} from '@/lib/note-markdown';
import type { NoteLineEdit } from './editor/NoteEditor';

export type WrapUpChoice = 'task' | 'follow-up' | 'carry' | 'drop';

const CHOICES: Array<{ value: WrapUpChoice; label: string; key: string }> = [
  { value: 'task', label: 'Task', key: 't' },
  { value: 'follow-up', label: 'Follow-up', key: 'f' },
  { value: 'carry', label: 'Carry', key: 'c' },
  { value: 'drop', label: 'Drop', key: 'd' },
];

/** Where carried lines go: the day after the note, but never into the past. */
export function carryTargetDate(noteDate: string, today: string): string {
  if (noteDate < today) return today;
  return format(addDays(parseISO(noteDate), 1), 'yyyy-MM-dd');
}

function carryTargetLabel(target: string, today: string): string {
  if (target === today) return 'today';
  if (target === format(addDays(parseISO(today), 1), 'yyyy-MM-dd')) return 'tomorrow';
  return prettyNoteDate(target, 'EEE, MMM d');
}

interface NotesWrapUpDialogProps {
  open: boolean;
  noteDate: string;
  today: string;
  candidates: WrapUpCandidate[];
  developers: NoteDeveloper[];
  onClose: () => void;
  /** Line rewrites for everything that landed (markers, strikes). Applied even on partial failure. */
  onApplyEdits: (edits: NoteLineEdit[]) => void;
}

/**
 * docs/52 §5 — the EOD ritual. Every open checkbox and unconverted list item
 * gets one decision: Task · Follow-up · Carry · Drop (or nothing — it stays).
 * Request ids are stable per row+choice for the life of the dialog, so a
 * retry after a partial failure never creates duplicates.
 */
export function NotesWrapUpDialog({ open, noteDate, today, candidates, developers, onClose, onApplyEdits }: NotesWrapUpDialogProps) {
  const { addToast } = useToast();
  const createTask = useCreateDailyNoteTask(noteDate);
  const createFollowUp = useCreateDailyNoteFollowUp(noteDate);
  const appendNote = useAppendDailyNote();
  const [choices, setChoices] = useState<Record<number, WrapUpChoice | undefined>>({});
  const [landed, setLanded] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIds = useRef(new Map<string, string>());

  useEffect(() => {
    if (!open) return;
    setChoices({});
    setLanded(new Set());
    setError(null);
    requestIds.current = new Map();
  }, [open]);

  const target = carryTargetDate(noteDate, today);
  const targetLabel = carryTargetLabel(target, today);
  const pending = candidates.filter((candidate) => !landed.has(candidate.line));
  const decided = pending.filter((candidate) => choices[candidate.line]);

  const counts = useMemo(() => {
    const out: Record<WrapUpChoice, number> = { task: 0, 'follow-up': 0, carry: 0, drop: 0 };
    for (const candidate of pending) {
      const choice = choices[candidate.line];
      if (choice) out[choice] += 1;
    }
    return out;
  }, [choices, pending]);

  const requestId = (candidate: WrapUpCandidate, choice: string) => {
    const key = `${candidate.line}:${choice}:${candidate.text}`;
    let id = requestIds.current.get(key);
    if (!id) {
      id = crypto.randomUUID();
      requestIds.current.set(key, id);
    }
    return id;
  };

  const choose = (line: number, choice: WrapUpChoice) =>
    setChoices((prev) => ({ ...prev, [line]: prev[line] === choice ? undefined : choice }));

  const chooseAll = (choice: WrapUpChoice) =>
    setChoices((prev) => {
      const next = { ...prev };
      for (const candidate of pending) if (!next[candidate.line]) next[candidate.line] = choice;
      return next;
    });

  const apply = async () => {
    if (running || decided.length === 0) return;
    setRunning(true);
    setError(null);
    const edits: NoteLineEdit[] = [];
    const done = new Set(landed);
    let failure: string | null = null;
    const followUpAt = followUpPresets()[0]?.value ?? new Date().toISOString();

    for (const candidate of decided) {
      const choice = choices[candidate.line];
      try {
        if (choice === 'task') {
          const inferred = inferFromText(candidate.raw, developers);
          const task = await createTask.mutateAsync({
            title: candidate.text.slice(0, 500),
            developerAccountId: inferred.developer?.accountId,
            jiraKey: inferred.jiraKey ?? undefined,
            requestId: requestId(candidate, 'task'),
          });
          edits.push({ line: candidate.line, raw: candidate.raw, next: appendProvenance(candidate.raw, task.taskKey) });
          done.add(candidate.line);
        } else if (choice === 'follow-up') {
          const created = await createFollowUp.mutateAsync({
            date: getLocalIsoDate(),
            title: candidate.text.slice(0, 500),
            followUpAt,
            requestId: requestId(candidate, 'follow-up'),
          });
          if (created?.taskKey) {
            edits.push({ line: candidate.line, raw: candidate.raw, next: appendProvenance(candidate.raw, created.taskKey) });
          }
          done.add(candidate.line);
        } else if (choice === 'drop') {
          edits.push({ line: candidate.line, raw: candidate.raw, next: dropLine(candidate.raw) });
          done.add(candidate.line);
        }
      } catch (err) {
        failure = err instanceof Error ? err.message : 'Something went wrong';
        break;
      }
    }

    // Carry is one append into the target day's note (idempotent by request id).
    const carried = failure ? [] : decided.filter((candidate) => choices[candidate.line] === 'carry');
    if (carried.length > 0) {
      try {
        const id = requestId({ line: -1, raw: '', text: carried.map((c) => c.line).join(','), kind: 'item' }, `carry:${target}`);
        await appendNote.mutateAsync({ date: target, text: carryText(carried.map((c) => c.text), noteDate), requestId: id });
        for (const candidate of carried) {
          edits.push({ line: candidate.line, raw: candidate.raw, next: appendProvenance(candidate.raw, target) });
          done.add(candidate.line);
        }
      } catch (err) {
        failure = err instanceof Error ? err.message : 'Could not carry lines forward';
      }
    }

    if (edits.length > 0) onApplyEdits(edits);
    setLanded(done);
    setRunning(false);

    if (failure) {
      setError(`${failure} — finished items are marked in your note; retry the rest.`);
      return;
    }
    const parts = [
      counts.task ? `${counts.task} task${counts.task === 1 ? '' : 's'}` : null,
      counts['follow-up'] ? `${counts['follow-up']} follow-up${counts['follow-up'] === 1 ? '' : 's'}` : null,
      counts.carry ? `${counts.carry} carried to ${targetLabel}` : null,
      counts.drop ? `${counts.drop} dropped` : null,
    ].filter(Boolean);
    addToast(`Day wrapped up — ${parts.join(', ')}`, 'success');
    onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (!next && !running ? onClose() : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90]" style={{ background: 'rgba(4, 8, 14, 0.5)', backdropFilter: 'blur(4px)' }} />
        <Dialog.Content className="notes-dialog notes-dialog-wide fixed z-[91] rounded-2xl border p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                Wrap up {prettyNoteDate(noteDate, 'EEEE')}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {pending.length === 0
                  ? 'Nothing loose — every list item is done or converted.'
                  : `${pending.length} open item${pending.length === 1 ? '' : 's'}. Decide what happens to each; anything left undecided stays in the note.`}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ color: 'var(--text-muted)' }} aria-label="Close wrap-up">
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          {pending.length > 0 ? (
            <>
              <div className="notes-wrapup-bulk" role="group" aria-label="Apply to all undecided">
                <span>All undecided:</span>
                <button type="button" onClick={() => chooseAll('carry')}>
                  Carry to {targetLabel}
                </button>
                <button type="button" onClick={() => chooseAll('drop')}>
                  Drop
                </button>
                <button type="button" onClick={() => setChoices({})}>
                  Clear
                </button>
              </div>
              <ul className="notes-wrapup-list">
                {pending.map((candidate) => {
                  const current = choices[candidate.line];
                  return (
                    <li
                      key={candidate.line}
                      className="notes-wrapup-row"
                      tabIndex={-1}
                      onKeyDown={(event) => {
                        if (event.metaKey || event.ctrlKey || event.altKey) return;
                        const match = CHOICES.find((choice) => choice.key === event.key.toLowerCase());
                        if (match) {
                          event.preventDefault();
                          choose(candidate.line, match.value);
                        }
                      }}
                    >
                      <span className={`notes-wrapup-kind ${candidate.kind}`} aria-hidden="true" />
                      <span className="notes-wrapup-text">{candidate.text}</span>
                      <div className="notes-wrapup-choices" role="group" aria-label={`What happens to “${candidate.text}”`}>
                        {CHOICES.map((choice) => (
                          <button
                            key={choice.value}
                            type="button"
                            aria-pressed={current === choice.value}
                            className={current === choice.value ? `active ${choice.value}` : undefined}
                            onClick={() => choose(candidate.line, choice.value)}
                            title={`${choice.value === 'carry' ? `Carry to ${targetLabel}` : choice.label} (${choice.key.toUpperCase()})`}
                          >
                            {choice.label}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          {error ? (
            <p className="mt-3 text-[12px]" style={{ color: 'var(--danger)' }} role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex items-center justify-between gap-2">
            <p className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
              Keys on a row: T · F · C · D
            </p>
            <div className="flex items-center gap-2">
              <Dialog.Close asChild>
                <button type="button" className="notes-button secondary" disabled={running}>
                  {pending.length === 0 ? 'Close' : 'Not now'}
                </button>
              </Dialog.Close>
              {pending.length > 0 ? (
                <button type="button" className="notes-button primary" onClick={() => void apply()} disabled={running || decided.length === 0}>
                  <CheckCheck size={12} />
                  {running ? 'Applying…' : decided.length === 0 ? 'Choose to apply' : `Apply ${decided.length}`}
                </button>
              ) : null}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
