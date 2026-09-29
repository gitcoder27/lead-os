import { useRef, useState } from 'react';
import { ArrowUpRight, ChevronRight, ExternalLink, Globe, Link2, ListTree, Plus, Ticket, UserRound, X } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAddTaskDetailLink, useRemoveTaskDetailLink } from '@/hooks/useTaskDetail';
import { useCaptureTask } from '@/hooks/useCapture';
import type { TaskChildRef, TaskDetailResponse, TaskLink } from '@/types';
import { JiraIssueLink } from '@/components/JiraIssueLink';
import { TaskStatusGlyph } from './TaskMenus';
import { MenuItem, TaskPopover } from '@/components/ui/Popover';
import { Avatar, FOCUS_RING, SectionHeader } from './TaskDetailPrimitives';
import type { TaskDetailMode, TaskPeople } from './TaskDetailFields';
import { isHttpUrl, prettyUrl } from './task-detail-format';

type LinkKind = TaskLink['kind'];

const LINK_KINDS: { kind: LinkKind; label: string; key: string; Icon: typeof Link2; placeholder: string }[] = [
  { kind: 'jira', label: 'Jira issue', key: 'j', Icon: Ticket, placeholder: 'PROJ-123' },
  { kind: 'person', label: 'Developer', key: 'd', Icon: UserRound, placeholder: '' },
  { kind: 'external', label: 'External link', key: 'e', Icon: Globe, placeholder: 'https://… or a short label' },
  { kind: 'task', label: 'Task', key: 't', Icon: Link2, placeholder: 'T-42' },
];

function kindMeta(kind: LinkKind) {
  return LINK_KINDS.find((entry) => entry.kind === kind) ?? LINK_KINDS[2]!;
}

// ── Links ───────────────────────────────────────────────────────────

export function TaskLinksSection({ task, mode, readOnly, onNavigateTask, people }: {
  task: TaskDetailResponse;
  mode: TaskDetailMode;
  readOnly: boolean;
  onNavigateTask: (taskKey: string) => void;
  people: TaskPeople;
}) {
  const { addToast } = useToast();
  const addLink = useAddTaskDetailLink(task.taskKey);
  const removeLink = useRemoveTaskDetailLink(task.taskKey);
  const editable = mode === 'manager' && !readOnly;
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ kind: 'kinds' | 'person'; anchor: HTMLElement } | null>(null);
  const [adding, setAdding] = useState<Exclude<LinkKind, 'person'> | null>(null);
  const [draft, setDraft] = useState('');

  const create = (kind: LinkKind, ref: string) => {
    const value = ref.trim();
    if (!value) return;
    addLink.mutate(
      { kind, ref: value, ...(kind === 'jira' ? { role: 'related' as const } : {}) },
      {
        onSuccess: () => { setAdding(null); setDraft(''); },
        onError: (err) => addToast(err.message, 'error'),
      },
    );
  };

  const chooseKind = (kind: LinkKind) => {
    const anchor = menu?.anchor ?? addButtonRef.current;
    if (kind === 'person' && anchor) {
      setMenu({ kind: 'person', anchor });
      return;
    }
    setMenu(null);
    setAdding(kind as Exclude<LinkKind, 'person'>);
    setDraft('');
  };

  if (!editable && task.links.length === 0) return null;

  const openKinds = (anchor: HTMLElement) => setMenu(menu ? null : { kind: 'kinds', anchor });

  return (
    <section aria-labelledby={`links-${task.taskKey}`} className="space-y-2">
      <SectionHeader
        id={`links-${task.taskKey}`}
        icon={<Link2 size={14} />}
        title="Links"
        count={task.links.length || undefined}
        action={editable && (
          <button
            ref={addButtonRef}
            type="button"
            onClick={(event) => openKinds(event.currentTarget)}
            aria-haspopup="menu"
            aria-expanded={menu?.kind === 'kinds'}
            className={`flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
            style={{ color: 'var(--text-secondary)' }}
          >
            <Plus size={13} />
            Add link
          </button>
        )}
      />

      {task.links.length > 0 && (
        <ul className="space-y-0.5">
          {task.links.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              people={people}
              onNavigateTask={onNavigateTask}
              onRemove={editable ? () => removeLink.mutate(link.id, { onError: (err) => addToast(err.message, 'error') }) : undefined}
            />
          ))}
        </ul>
      )}

      {task.links.length === 0 && !adding && editable && (
        <button
          type="button"
          onClick={(event) => openKinds(event.currentTarget)}
          className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[12.5px] transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
          style={{ color: 'var(--text-muted)', border: '1px dashed var(--border)' }}
        >
          <Link2 size={13} />
          Connect a Jira issue, teammate, URL or related task
        </button>
      )}

      {adding && (
        <form
          className="flex items-center gap-1.5 rounded-xl p-1 pl-2.5"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-active)' }}
          onSubmit={(event) => {
            event.preventDefault();
            create(adding, draft);
          }}
        >
          {(() => {
            const { Icon } = kindMeta(adding);
            return <Icon size={14} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />;
          })()}
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setAdding(null);
                setDraft('');
              }
            }}
            placeholder={kindMeta(adding).placeholder}
            className="min-w-0 flex-1 bg-transparent py-1 text-[13px] outline-none placeholder:text-[var(--text-placeholder)]"
            style={{ color: 'var(--text-primary)' }}
            aria-label={`${adding} link`}
          />
          <button
            type="submit"
            disabled={!draft.trim() || addLink.isPending}
            className={`h-7 rounded-lg px-2.5 text-[12px] font-semibold disabled:opacity-40 ${FOCUS_RING}`}
            style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAdding(null); setDraft(''); }}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
            style={{ color: 'var(--text-muted)' }}
            aria-label="Cancel adding link"
          >
            <X size={13} />
          </button>
        </form>
      )}

      {menu?.kind === 'kinds' && (
        <TaskPopover
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          label="Add link"
          width={200}
          onAccelerator={(key) => {
            const entry = LINK_KINDS.find((candidate) => candidate.key === key.toLowerCase());
            if (!entry) return false;
            chooseKind(entry.kind);
            return true;
          }}
        >
          {LINK_KINDS.map(({ kind, label, key, Icon }) => (
            <MenuItem key={kind} icon={<Icon size={13} />} label={label} hint={key} onSelect={() => chooseKind(kind)} />
          ))}
        </TaskPopover>
      )}
      {menu?.kind === 'person' && (
        <PersonPicker
          anchor={menu.anchor}
          people={people.developers.filter((dev) => !task.links.some((link) => link.kind === 'person' && link.ref === dev.accountId))}
          onClose={() => setMenu(null)}
          onSelect={(accountId) => {
            setMenu(null);
            create('person', accountId);
          }}
        />
      )}
    </section>
  );
}

function LinkRow({ link, people, onNavigateTask, onRemove }: {
  link: TaskLink;
  people: TaskPeople;
  onNavigateTask: (taskKey: string) => void;
  onRemove?: () => void;
}) {
  const { Icon, label: kindLabel } = kindMeta(link.kind);
  const personName = link.kind === 'person' ? people.nameFor(link.ref) ?? link.ref : '';
  const rowClass = 'min-w-0 flex-1 truncate text-left text-[13px] font-medium';

  let body: React.ReactNode;
  if (link.kind === 'jira') {
    body = (
      <JiraIssueLink issueKey={link.ref} className={`${rowClass} font-mono hover:underline`} style={{ color: 'var(--text-primary)' }}>
        {link.ref}
      </JiraIssueLink>
    );
  } else if (link.kind === 'task') {
    body = (
      <button type="button" onClick={() => onNavigateTask(link.ref)} className={`${rowClass} font-mono hover:underline ${FOCUS_RING} rounded`} style={{ color: 'var(--accent)' }}>
        {link.ref}
      </button>
    );
  } else if (link.kind === 'external' && isHttpUrl(link.ref)) {
    body = (
      <a href={link.ref} target="_blank" rel="noopener noreferrer" className={`${rowClass} hover:underline ${FOCUS_RING} rounded`} style={{ color: 'var(--text-primary)' }} title={link.ref}>
        {prettyUrl(link.ref)}
        <ExternalLink size={11} className="ml-1 inline align-[-1px] opacity-50" />
      </a>
    );
  } else {
    body = <span className={rowClass} style={{ color: 'var(--text-primary)' }}>{link.kind === 'person' ? personName : link.ref}</span>;
  }

  return (
    <li className="group flex min-h-[36px] items-center gap-2.5 rounded-lg px-2 transition-colors hover:bg-[var(--bg-secondary)]">
      {link.kind === 'person' ? (
        <Avatar name={personName} seed={link.ref} size={22} />
      ) : (
        <span
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md"
          style={{ background: 'var(--bg-tertiary)', color: link.kind === 'task' ? 'var(--accent)' : 'var(--text-muted)' }}
          aria-hidden="true"
        >
          <Icon size={12} />
        </span>
      )}
      {body}
      {link.role === 'primary' && (
        <span className="shrink-0 rounded-full px-1.5 text-[11px] font-semibold leading-[18px]" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
          Primary
        </span>
      )}
      <span className="shrink-0 text-[12px]" style={{ color: 'var(--text-muted)' }}>{kindLabel}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-opacity hover:bg-[var(--bg-tertiary)] group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:hover)]:opacity-0 ${FOCUS_RING}`}
          style={{ color: 'var(--text-muted)' }}
          aria-label={`Remove link ${link.ref}`}
        >
          <X size={12} />
        </button>
      )}
    </li>
  );
}

function PersonPicker({ anchor, people, onClose, onSelect }: {
  anchor: HTMLElement;
  people: { accountId: string; displayName: string }[];
  onClose: () => void;
  onSelect: (accountId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const visible = needle ? people.filter((dev) => dev.displayName.toLowerCase().includes(needle)) : people;
  return (
    <TaskPopover anchor={anchor} onClose={onClose} label="Link a developer" width={230}>
      <input
        data-autofocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && visible[0]) {
            event.preventDefault();
            onSelect(visible[0].accountId);
          }
        }}
        placeholder="Link a developer…"
        aria-label="Filter developers"
        className="mb-1 w-full rounded-lg px-2 py-1.5 text-[12.5px] outline-none"
        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
      />
      {visible.map((dev) => (
        <MenuItem key={dev.accountId} icon={<Avatar name={dev.displayName} seed={dev.accountId} size={18} />} label={dev.displayName} onSelect={() => onSelect(dev.accountId)} />
      ))}
      {visible.length === 0 && <p className="px-2 py-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>No match</p>}
    </TaskPopover>
  );
}

// ── Children (subtasks / action items) ──────────────────────────────

export function TaskChildrenSection({ task, mode, readOnly, onNavigateTask, people }: {
  task: TaskDetailResponse;
  mode: TaskDetailMode;
  readOnly: boolean;
  onNavigateTask: (taskKey: string) => void;
  people: TaskPeople;
}) {
  const { addToast } = useToast();
  const createChild = useCaptureTask();
  const [draft, setDraft] = useState('');
  const isMeeting = task.kind === 'meeting';
  const canAdd = isMeeting && mode === 'manager' && !readOnly;
  const done = task.children.filter((child) => child.status === 'done' || child.status === 'dropped').length;

  if (!task.children.length && !canAdd) return null;

  // docs/57 §3 (P3-05): an action item is a capture with this task as its parent —
  // `@dev` is the owner, `!fri` the date, and the server reports anything it can't resolve.
  const submit = async () => {
    const text = draft.trim();
    if (!text || createChild.isPending) return;
    try {
      const { warnings } = await createChild.create({ text, defaults: { parentKey: task.taskKey } });
      setDraft('');
      if (warnings.length) addToast(warnings.map((warning) => warning.message).join(' '), 'warning');
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Could not add the action item', 'error');
    }
  };

  const total = task.children.length;
  return (
    <section aria-labelledby={`children-${task.taskKey}`} className="space-y-2">
      <SectionHeader
        id={`children-${task.taskKey}`}
        icon={<ListTree size={14} />}
        title={isMeeting ? 'Action items' : 'Subtasks'}
        count={total ? `${done}/${total}` : undefined}
        action={total > 0 && (
          <span className="h-1 w-16 overflow-hidden rounded-full" style={{ background: 'var(--bg-tertiary)' }} aria-hidden="true">
            <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${(done / total) * 100}%`, background: 'var(--success)' }} />
          </span>
        )}
      />
      {total > 0 && (
        <ul className="space-y-0.5">
          {task.children.map((child) => (
            <ChildRow key={child.id} child={child} people={people} onOpen={onNavigateTask} />
          ))}
        </ul>
      )}
      {canAdd && (
        <form
          className="flex items-center gap-2 rounded-lg px-2 transition-colors focus-within:bg-[var(--bg-secondary)]"
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
        >
          <Plus size={14} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add an action item — @dev for owner, !fri for a date…"
            className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none placeholder:text-[var(--text-placeholder)]"
            style={{ color: 'var(--text-primary)' }}
            aria-label="New action item"
          />
          {draft.trim() && (
            <button
              type="submit"
              disabled={createChild.isPending}
              className={`h-7 rounded-lg px-2.5 text-[12px] font-semibold disabled:opacity-40 ${FOCUS_RING}`}
              style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
            >
              Add
            </button>
          )}
        </form>
      )}
    </section>
  );
}

function ChildRow({ child, people, onOpen }: { child: TaskChildRef; people: TaskPeople; onOpen: (key: string) => void }) {
  const closed = child.status === 'done' || child.status === 'dropped';
  const owner = child.ownerId ? people.nameFor(child.ownerId) : undefined;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(child.taskKey)}
        className={`group flex min-h-[36px] w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-[var(--bg-secondary)] ${FOCUS_RING}`}
      >
        <TaskStatusGlyph status={child.status} size={14} />
        <span className="shrink-0 font-mono text-[12px] font-semibold" style={{ color: 'var(--text-muted)' }}>{child.taskKey}</span>
        <span
          className={`min-w-0 flex-1 truncate text-[13px] ${closed ? 'line-through decoration-[var(--text-disabled)]' : ''}`}
          style={{ color: closed ? 'var(--text-muted)' : 'var(--text-primary)' }}
        >
          {child.title}
        </span>
        {owner && <span title={owner}><Avatar name={owner} seed={child.ownerId ?? undefined} size={18} /></span>}
        <ChevronRight size={13} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60" style={{ color: 'var(--text-muted)' }} />
      </button>
    </li>
  );
}

/** Compact "↑ parent" crumb for the detail header. */
export function ParentCrumb({ parent, onOpen }: { parent: TaskChildRef; onOpen: (key: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(parent.taskKey)}
      className={`flex min-w-0 max-w-[260px] items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] transition-colors hover:bg-[var(--bg-tertiary)] ${FOCUS_RING}`}
      style={{ color: 'var(--text-muted)' }}
      title={`Parent: ${parent.taskKey} ${parent.title}`}
      aria-label={`Open parent task ${parent.taskKey}`}
    >
      <ArrowUpRight size={12} className="shrink-0" />
      <span className="shrink-0 font-mono font-semibold">{parent.taskKey}</span>
      <span className="truncate">{parent.title}</span>
    </button>
  );
}
