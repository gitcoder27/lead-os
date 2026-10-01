import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, CornerDownLeft, Flag, GripVertical, Lightbulb, MessageCircleQuestion, Plus, RotateCw, X } from 'lucide-react';
import {
  useAttachOneOnOneAgendaItem,
  useDetachOneOnOneAgendaItem,
  useOneOnOneSuggestions,
  useReorderOneOnOneAgenda,
} from '@/hooks/useOneOnOne';
import { useToast } from '@/context/ToastContext';
import type { OneOnOneAgendaItem, OneOnOneSeriesDetail, OneOnOneTaskSuggestion } from '@/types';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { KeySpec } from '@/components/ui/Kbd';
import { FOCUS_RING } from '@/components/ui/focus';
import { TaskStatusGlyph } from '@/components/tasks/TaskMenus';
import { toneColor, type DateTone } from '@/components/tasks/task-detail-format';
import { getLocalIsoDate } from '@/lib/utils';
import {
  checkInSuggestionChip,
  checkInTopicTitle,
  closedSessions,
  describeAgendaTask,
  formatDay,
  formatShortDay,
  isOpenAgendaItem,
  reasonLabel,
  resolvedSinceLastSession,
} from './oneOnOneFormat';

/** Suggestions shown before "Show more". */
const SUGGESTIONS_VISIBLE = 3;

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/**
 * docs/48 §4.2 column 1. The agenda is a curated list of topics to raise with
 * the developer; each is a canonical task, so it carries from session to
 * session until it is discussed (detached) or closed. Suggestions draw on the
 * developer's blocked / overdue / high-priority / carried / quiet work.
 */
export function AgendaColumn({ detail, onOpenTask }: { detail: OneOnOneSeriesDetail; onOpenTask?: (taskKey: string) => void }) {
  const { addToast } = useToast();
  const seriesId = detail.series.id;
  const firstName = detail.series.developerName.split(' ')[0] ?? detail.series.developerName;
  const today = getLocalIsoDate();
  const attach = useAttachOneOnOneAgendaItem(seriesId);
  const reorder = useReorderOneOnOneAgenda(seriesId);
  const detach = useDetachOneOnOneAgendaItem(seriesId);
  const [draft, setDraft] = useState('');
  const [dragId, setDragId] = useState<number | null>(null);

  const openItems = useMemo(() => detail.agenda.filter(isOpenAgendaItem), [detail.agenda]);
  const lastClosedAt = useMemo(() => closedSessions(detail.sessions)[0]?.session.completedAt ?? null, [detail.sessions]);
  const resolved = useMemo(
    () => (lastClosedAt ? resolvedSinceLastSession(detail.agenda, lastClosedAt) : []),
    [detail.agenda, lastClosedAt],
  );

  const moveTo = useCallback(
    (itemIds: number[]) => {
      // The server wants a permutation of every link row, closed ones included.
      const rest = detail.agenda.filter((item) => !itemIds.includes(item.id)).map((item) => item.id);
      reorder.mutate(
        { itemIds: [...itemIds, ...rest] },
        { onError: (error) => addToast(errorMessage(error, 'Could not reorder the agenda'), 'error') },
      );
    },
    [addToast, detail.agenda, reorder],
  );

  const moveBy = useCallback(
    (itemId: number, direction: -1 | 1) => {
      const ids = openItems.map((item) => item.id);
      const index = ids.indexOf(itemId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target]!, ids[index]!];
      moveTo(ids);
    },
    [moveTo, openItems],
  );

  const submitDraft = useCallback(() => {
    const title = draft.trim();
    if (!title || attach.isPending) return;
    attach.mutate(
      { title },
      {
        onSuccess: () => setDraft(''),
        onError: (error) => addToast(errorMessage(error, 'Could not add to the agenda'), 'error'),
      },
    );
  }, [addToast, attach, draft]);

  return (
    <section className="one-on-one-column flex min-h-0 flex-col" aria-label="1:1 agenda">
      <SectionHeader as="h2" title="Agenda" count={openItems.length} />
      <p className="mb-2.5 mt-0.5 text-[12px] leading-[17px]" style={{ color: 'var(--text-muted)' }}>
        Topics to raise with {firstName}. Each one stays on the agenda until you discuss it or its task closes.
      </p>
      <form
        className="mb-2"
        onSubmit={(event) => {
          event.preventDefault();
          submitDraft();
        }}
      >
        <div
          className="flex items-center gap-2 rounded-lg pl-2.5 pr-1 transition-[border-color,box-shadow] focus-within:border-[var(--border-active)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_10%,transparent)]"
          style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}
        >
          <Plus size={13} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a topic…"
            className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--text-placeholder)]"
            style={{ color: 'var(--text-primary)' }}
            aria-label="Add to agenda"
          />
          {draft.trim() ? (
            <button type="submit" disabled={attach.isPending} className="ui-btn ui-btn-sm" aria-label="Add topic">
              <CornerDownLeft size={11} aria-hidden="true" />
              Add
            </button>
          ) : (
            <KeySpec keys="n" variant="subtle" />
          )}
        </div>
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {openItems.length > 0 ? (
          <ul data-testid="one-on-one-agenda">
            {openItems.map((item) => (
              <AgendaRow
                key={item.id}
                item={item}
                today={today}
                dragId={dragId}
                onDragStart={() => setDragId(item.id)}
                onDragEnd={() => setDragId(null)}
                onDrop={(targetId) => {
                  if (dragId === null || dragId === targetId) return;
                  const ids = openItems.map((entry) => entry.id);
                  const from = ids.indexOf(dragId);
                  const to = ids.indexOf(targetId);
                  if (from < 0 || to < 0) return;
                  ids.splice(to, 0, ...ids.splice(from, 1));
                  moveTo(ids);
                }}
                onMoveBy={moveBy}
                onDetach={(itemId) =>
                  detach.mutate(itemId, { onError: (error) => addToast(errorMessage(error, 'Could not remove the item'), 'error') })
                }
                onOpenTask={onOpenTask}
              />
            ))}
          </ul>
        ) : (
          <AgendaEmpty name={firstName} />
        )}
        {openItems.length > 1 && (
          <div className="mt-1.5 flex items-center gap-1.5 px-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Drag to reorder, or <KeySpec keys="⌥ ↑ / ⌥ ↓" variant="subtle" />
          </div>
        )}

        {resolved.length > 0 && <ResolvedGroup items={resolved} onOpenTask={onOpenTask} />}

        <Suggestions detail={detail} firstName={firstName} today={today} onOpenTask={onOpenTask} />
      </div>
    </section>
  );
}

function AgendaEmpty({ name }: { name: string }) {
  return (
    <div className="rounded-xl px-3.5 py-3.5" style={{ background: 'color-mix(in srgb, var(--bg-tertiary) 55%, transparent)' }} data-testid="one-on-one-agenda-empty">
      <p className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
        Nothing on the agenda yet
      </p>
      <ul className="mt-1.5 space-y-1 text-[12px] leading-[17px]" style={{ color: 'var(--text-muted)' }}>
        <li>Type a topic above: a question, feedback, or something to follow up on.</li>
        <li>Add a suggestion below, pulled from {name}&apos;s blocked, late, or quiet work.</li>
        <li>From the team board, hover a task in {name}&apos;s drawer and choose “Add to 1:1 agenda”.</li>
      </ul>
    </div>
  );
}

function AgendaRow({
  item,
  today,
  dragId,
  onDragStart,
  onDragEnd,
  onDrop,
  onMoveBy,
  onDetach,
  onOpenTask,
}: {
  item: OneOnOneAgendaItem;
  today: string;
  dragId: number | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: (targetId: number) => void;
  onMoveBy: (itemId: number, direction: -1 | 1) => void;
  onDetach: (itemId: number) => void;
  onOpenTask?: (taskKey: string) => void;
}) {
  const live = describeAgendaTask(item.task, today);
  const high = item.task.priority === 'high';
  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(item.id);
      }}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) {
          event.preventDefault();
          onOpenTask?.(item.task.taskKey);
          return;
        }
        if (!event.altKey) return;
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          onMoveBy(item.id, -1);
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          onMoveBy(item.id, 1);
        }
      }}
      // docs/54 D2/D3: the shared list-row idiom — hairline dividers, tint on
      // hover, keyboard ring on focus.
      className="group flex min-h-[40px] items-start gap-2 border-b px-1.5 py-2 outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_70%,transparent)] ui-row-focus"
      style={{
        borderColor: 'color-mix(in srgb, var(--border) 70%, transparent)',
        background: dragId === item.id ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : undefined,
        opacity: dragId === item.id ? 0.6 : 1,
      }}
      data-testid={`agenda-item-${item.id}`}
    >
      <GripVertical size={12} className="mt-[3px] shrink-0 cursor-grab opacity-0 transition-opacity group-hover:opacity-60 [@media(hover:none)]:opacity-40" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
      <span className="mt-[1px] shrink-0">
        <TaskStatusGlyph status={item.task.status} size={14} />
      </span>
      <button
        type="button"
        tabIndex={-1}
        className="min-w-0 flex-1 text-left"
        onClick={() => onOpenTask?.(item.task.taskKey)}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate text-[13px] leading-[18px]" style={{ color: 'var(--text-primary)' }}>
            {item.task.title}
          </span>
          {high && <Flag size={11} className="shrink-0 self-center" style={{ color: 'var(--danger)' }} aria-label="High priority" />}
        </span>
        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] leading-4" style={{ color: 'var(--text-muted)' }}>
          <span className="font-mono tabular-nums" style={{ color: 'var(--text-disabled)' }}>{item.task.taskKey}</span>
          {live.status && <MetaText tone={live.status.tone}>{live.status.label}</MetaText>}
          {live.date && <MetaText tone={live.date.tone}>{live.date.label}</MetaText>}
          {item.carriedFrom && (
            <span className="inline-flex items-center gap-1" title={`Carried from the ${formatDay(item.carriedFrom, today)} session`}>
              <RotateCw size={10} aria-hidden="true" />
              carried from {formatShortDay(item.carriedFrom, today)}
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onDetach(item.id)}
        className="ui-icon-btn h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
        aria-label={`Remove ${item.task.taskKey} from agenda`}
        title="Discussed — remove from agenda (the task stays open)"
      >
        <X size={11} />
      </button>
    </li>
  );
}

function MetaText({ tone, children }: { tone: DateTone; children: React.ReactNode }) {
  return (
    <span className="font-medium" style={{ color: tone === 'muted' || tone === 'default' ? 'var(--text-muted)' : toneColor(tone) }}>
      {children}
    </span>
  );
}

/** Topics whose tasks closed since the last session — quiet, collapsed, still clickable. */
function ResolvedGroup({ items, onOpenTask }: { items: OneOnOneAgendaItem[]; onOpenTask?: (taskKey: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
        style={{ color: 'var(--text-muted)' }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Closed since last 1:1
        <span className="tabular-nums">· {items.length}</span>
      </button>
      {open && (
        <ul className="mt-0.5">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpenTask?.(item.task.taskKey)}
                className={`flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
              >
                <TaskStatusGlyph status={item.task.status} size={13} />
                <span className="min-w-0 truncate text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>{item.task.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Suggestions ──

function Suggestions({
  detail,
  firstName,
  today,
  onOpenTask,
}: {
  detail: OneOnOneSeriesDetail;
  firstName: string;
  today: string;
  onOpenTask?: (taskKey: string) => void;
}) {
  const { addToast } = useToast();
  const suggestions = useOneOnOneSuggestions(detail.series.id);
  const attach = useAttachOneOnOneAgendaItem(detail.series.id);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState(false);

  const taskRows = (suggestions.data?.tasks ?? []).filter((entry) => !dismissed.has(entry.task.taskKey));
  const checkIn = suggestions.data?.checkIn && !dismissed.has('check-in') ? suggestions.data.checkIn : null;
  const total = taskRows.length + (checkIn ? 1 : 0);
  if (suggestions.isLoading || total === 0) return null;

  const visibleTasks = expanded ? taskRows : taskRows.slice(0, Math.max(0, SUGGESTIONS_VISIBLE - (checkIn ? 1 : 0)));
  const hidden = taskRows.length - visibleTasks.length;

  const add = (key: string, body: { taskId: number } | { title: string }) => {
    setPendingKey(key);
    attach.mutate(body, {
      onSettled: () => setPendingKey(null),
      onError: (error) => addToast(errorMessage(error, 'Could not add to the agenda'), 'error'),
    });
  };
  const dismiss = (key: string) => setDismissed((current) => new Set(current).add(key));

  return (
    <div className="mt-4" data-testid="one-on-one-suggestions">
      <div className="mb-1 flex items-center gap-1.5 px-1.5">
        <Lightbulb size={12} aria-hidden="true" style={{ color: 'var(--warning)' }} />
        <h3 className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
          Suggested from {firstName}&apos;s work
        </h3>
      </div>
      <ul>
        {checkIn && (
          <SuggestionRow
            glyph={<MessageCircleQuestion size={14} style={{ color: 'var(--text-muted)' }} />}
            title={checkInTopicTitle(checkIn, today)}
            chips={[
              {
                label: checkInSuggestionChip(checkIn),
                tone: 'warning',
              },
            ]}
            pending={pendingKey === 'check-in'}
            onAdd={() => add('check-in', { title: checkInTopicTitle(checkIn, today) })}
            onDismiss={() => dismiss('check-in')}
          />
        )}
        {visibleTasks.map((entry) => (
          <TaskSuggestionRow
            key={entry.task.taskKey}
            entry={entry}
            pending={pendingKey === entry.task.taskKey}
            onAdd={() => add(entry.task.taskKey, { taskId: entry.task.taskId })}
            onDismiss={() => dismiss(entry.task.taskKey)}
            onOpenTask={onOpenTask}
          />
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={`mt-0.5 rounded-md px-1.5 py-1 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
          style={{ color: 'var(--accent)' }}
        >
          Show {hidden} more
        </button>
      )}
    </div>
  );
}

function TaskSuggestionRow({
  entry,
  pending,
  onAdd,
  onDismiss,
  onOpenTask,
}: {
  entry: OneOnOneTaskSuggestion;
  pending: boolean;
  onAdd: () => void;
  onDismiss: () => void;
  onOpenTask?: (taskKey: string) => void;
}) {
  return (
    <SuggestionRow
      glyph={<TaskStatusGlyph status={entry.task.status} size={14} />}
      title={entry.task.title}
      taskKey={entry.task.taskKey}
      chips={entry.reasons.slice(0, 2).map(reasonLabel)}
      pending={pending}
      onAdd={onAdd}
      onDismiss={onDismiss}
      onOpen={onOpenTask ? () => onOpenTask(entry.task.taskKey) : undefined}
    />
  );
}

function SuggestionRow({
  glyph,
  title,
  taskKey,
  chips,
  pending,
  onAdd,
  onDismiss,
  onOpen,
}: {
  glyph: React.ReactNode;
  title: string;
  taskKey?: string;
  chips: Array<{ label: string; tone: DateTone }>;
  pending: boolean;
  onAdd: () => void;
  onDismiss: () => void;
  onOpen?: () => void;
}) {
  return (
    <li className="group flex items-start gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_70%,transparent)]">
      <span className="mt-[1px] shrink-0 opacity-70">{glyph}</span>
      <div className="min-w-0 flex-1">
        {onOpen ? (
          <button type="button" onClick={onOpen} className={`block max-w-full truncate rounded text-left text-[12.5px] leading-[18px] ${FOCUS_RING}`} style={{ color: 'var(--text-secondary)' }}>
            {title}
          </button>
        ) : (
          <span className="block truncate text-[12.5px] leading-[18px]" style={{ color: 'var(--text-secondary)' }}>{title}</span>
        )}
        <span className="mt-0.5 flex flex-wrap items-center gap-1">
          {taskKey && (
            <span className="mr-0.5 font-mono text-[11px] tabular-nums" style={{ color: 'var(--text-disabled)' }}>{taskKey}</span>
          )}
          {chips.map((chip) => (
            <span key={chip.label} className="ui-chip" style={{ ['--tone' as string]: toneColor(chip.tone) }}>
              {chip.label}
            </span>
          ))}
        </span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="ui-icon-btn h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
        aria-label={`Dismiss suggestion: ${title}`}
        title="Not now"
      >
        <X size={11} />
      </button>
      <button
        type="button"
        onClick={onAdd}
        disabled={pending}
        className="ui-btn ui-btn-sm shrink-0"
        aria-label={`Add to agenda: ${title}`}
      >
        <Plus size={11} aria-hidden="true" />
        {pending ? 'Adding…' : 'Add'}
      </button>
    </li>
  );
}
