import type { TrackerWorkItem } from '@/types';

export interface TaskPickerTask {
  taskKey: string;
  title: string;
}

const TASK_TOKEN_PATTERN = /\b[Tt]-(\d{1,9})\b/g;

/** Uppercased, de-duplicated T-n tokens found in free text. */
export function parseTaskKeys(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(TASK_TOKEN_PATTERN)) {
    found.add(`T-${match[1]}`);
  }
  return [...found];
}

/**
 * Keys to send with a check-in: manually picked keys plus tokens typed into the
 * text that match a known task (unknown tokens stay text-only — the server
 * ignores them rather than rejecting the check-in).
 */
export function taskKeysForSubmit(selected: string[], text: string, tasks: TaskPickerTask[]): string[] {
  const known = new Set(tasks.map((task) => task.taskKey));
  const keys = new Set(selected.filter((key) => known.has(key)));
  for (const token of parseTaskKeys(text)) {
    if (known.has(token)) {
      keys.add(token);
    }
  }
  return [...keys];
}

/** Flatten a day's item lists into picker candidates. */
export function tasksFromItems(
  ...groups: Array<TrackerWorkItem[] | undefined>
): TaskPickerTask[] {
  const seen = new Map<string, TaskPickerTask>();
  for (const group of groups) {
    for (const item of group ?? []) {
      if (item.taskKey && !seen.has(item.taskKey)) {
        seen.set(item.taskKey, { taskKey: item.taskKey, title: item.title });
      }
    }
  }
  return [...seen.values()];
}

interface TaskPickerProps {
  tasks: TaskPickerTask[];
  /** Free text being composed — typed T-n tokens are highlighted. */
  text?: string;
  selected: string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
}

export function TaskPicker({ tasks, text = '', selected, onChange, disabled }: TaskPickerProps) {
  const parsed = parseTaskKeys(text);
  const knownKeys = new Set(tasks.map((task) => task.taskKey));
  const unknownTokens = parsed.filter((token) => !knownKeys.has(token));
  const selectedSet = new Set(selected);

  if (tasks.length === 0 && unknownTokens.length === 0) {
    return null;
  }

  const toggle = (key: string) => {
    if (disabled) return;
    onChange(selectedSet.has(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>
        about:
      </span>
      {tasks.map((task) => {
        const mentioned = parsed.includes(task.taskKey);
        const active = selectedSet.has(task.taskKey) || mentioned;
        return (
          <button
            key={task.taskKey}
            type="button"
            onClick={() => toggle(task.taskKey)}
            disabled={disabled}
            className="rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold transition-colors disabled:opacity-50"
            style={{
              background: active ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--bg-tertiary)',
              color: active ? 'var(--accent)' : 'var(--text-muted)',
              border: `1px solid ${active ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : 'var(--border)'}`,
            }}
            title={`${task.title}${mentioned ? ' — mentioned in text' : ''}`}
            aria-pressed={active}
          >
            {task.taskKey}
          </button>
        );
      })}
      {unknownTokens.map((token) => (
        <span
          key={token}
          className="rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold"
          style={{
            color: 'var(--text-muted)',
            border: '1px dashed var(--border-strong)',
          }}
          title="Typed in the note — links if this task exists"
        >
          {token}
        </span>
      ))}
    </div>
  );
}
