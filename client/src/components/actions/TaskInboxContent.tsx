import { useState } from 'react';
import type { TaskInboxItem, TaskInboxKind } from '@/types';
import { useMarkTaskInboxRead, useTaskInbox } from '@/hooks/useTaskInbox';
import { navigateToTaskPage } from '@/lib/task-nav';
import { formatAbsoluteDateTime, formatRelativeTime } from '@/lib/utils';
import './task-inbox.css';

const labels: Record<TaskInboxKind, string> = {
  assignment: 'Assignment changed',
  instruction: 'Instruction',
  reply: 'Reply',
  blocker: 'Blocker raised',
  blocker_cleared: 'Blocker cleared',
};

export function TaskInboxContent({ onOpen }: { onOpen: () => void }) {
  const [unreadOnly, setUnreadOnly] = useState(true);
  const query = useTaskInbox(unreadOnly);
  const markRead = useMarkTaskInboxRead();
  const seen = new Set<number>();
  const items = query.isError ? [] : (query.data?.pages.flatMap((page) => page.events) ?? []).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  const unreadCount = query.data?.pages[0]?.unreadCount;
  const shownUnread = items.filter((item) => !item.readAt);
  const changeRead = (ids: number[], read: boolean) => {
    markRead.mutate({ ids, read });
  };
  const openItem = (item: TaskInboxItem) => {
    if (!item.readAt) changeRead([item.id], true);
    onOpen();
    navigateToTaskPage(item.taskKey, false, item.eventId);
  };
  if (!query.enabled) return null;
  return (
    <section className="task-inbox" aria-label="Task updates">
      <div className="task-inbox-heading">
        <h2>Updates{unreadCount !== undefined ? ` · ${unreadCount} unread` : ''}</h2>
        <div className="task-inbox-tabs" aria-label="Show updates">
          <button type="button" onClick={() => void query.refetch()}>Refresh updates</button>
          <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>
            Unread
          </button>
          <button type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>
            All
          </button>
        </div>
      </div>
      {query.isLoading ? <p aria-live="polite">Loading updates…</p> : null}
      {query.isError ? (
        <p role="alert">
          Updates unavailable.{' '}
          <button type="button" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      ) : null}
      {!query.isLoading && !query.isError && !items.length ? (
        <p>{unreadOnly ? 'No unread updates.' : 'No updates yet.'}</p>
      ) : null}
      {shownUnread.length > 0 ? (
        <button
          type="button"
          disabled={markRead.isPending}
          onClick={() =>
            changeRead(
              shownUnread.slice(0, 100).map((item) => item.id),
              true,
            )
          }
        >
          {shownUnread.length > 100 ? 'Mark first 100 shown as read' : 'Mark shown as read'}
        </button>
      ) : null}
      <ul>
        {items.map((item) => (
          <li key={item.id} data-unread={!item.readAt}>
            <a
              href={item.href}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                openItem(item);
              }}
            >
              <span className="task-inbox-meta">
                {labels[item.kind]} · {item.actorName}
                {!item.readAt ? ' · Unread' : ''}
              </span>
              <strong>
                {item.taskKey} · {item.title}
              </strong>
              <span>{item.excerpt}</span>
              <time dateTime={item.occurredAt} title={formatAbsoluteDateTime(item.occurredAt)}>
                {formatRelativeTime(item.occurredAt)}
              </time>
            </a>
            <button
              type="button"
              disabled={markRead.isPending}
              aria-label={`Mark ${item.taskKey} update ${item.readAt ? 'unread' : 'read'}`}
              onClick={() => changeRead([item.id], !item.readAt)}
            >
              {item.readAt ? 'Mark unread' : 'Mark read'}
            </button>
          </li>
        ))}
      </ul>
      {query.hasNextPage ? (
        <button type="button" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {query.isFetchingNextPage ? 'Loading…' : 'Older updates'}
        </button>
      ) : null}
    </section>
  );
}
