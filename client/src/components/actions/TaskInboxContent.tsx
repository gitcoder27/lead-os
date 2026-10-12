import { useState } from 'react';
import { CalendarClock, CheckCheck, CircleCheck, Flag, Inbox, MessageSquare, OctagonAlert, RefreshCw, Reply, UserPlus, type LucideIcon } from 'lucide-react';
import type { TaskInboxItem, TaskInboxKind } from '@/types';
import { useMarkTaskInboxRead, useTaskInbox } from '@/hooks/useTaskInbox';
import { compactAge, inboxSummary, INBOX_KIND_LABELS as labels } from '@/lib/inbox-alerts';
import { navigateToTaskPage } from '@/lib/task-nav';
import { formatAbsoluteDateTime } from '@/lib/utils';
import { DesktopAlertsSwitch } from './DesktopAlertsControls';
import './task-inbox.css';

const icons: Record<TaskInboxKind, LucideIcon> = {
  assignment: UserPlus,
  instruction: MessageSquare,
  reply: Reply,
  blocker: OctagonAlert,
  blocker_cleared: CircleCheck,
  schedule: CalendarClock,
  priority: Flag,
};

export function TaskInboxContent({ onOpen }: { onOpen: () => void }) {
  const [unreadOnly, setUnreadOnly] = useState(true);
  const query = useTaskInbox(unreadOnly);
  const markRead = useMarkTaskInboxRead();
  const seen = new Set<number>();
  const items = (query.data?.pages.flatMap((page) => page.events) ?? []).filter((item) => {
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
      <div className="task-inbox-toolbar">
        <div className="task-inbox-heading">
          <h2 aria-label={`Updates${unreadCount !== undefined ? ` · ${unreadCount} unread` : ''}`}>
            Updates
            {unreadCount ? <span className="task-inbox-count" aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
          </h2>
          <div className="task-inbox-tools">
            <button
              type="button"
              className="task-inbox-icon-button"
              aria-label="Refresh updates"
              title="Refresh updates"
              disabled={query.isRefreshing}
              onClick={() => void query.refetch()}
            >
              <RefreshCw size={14} className={query.isRefreshing ? 'task-inbox-spin' : undefined} aria-hidden="true" />
            </button>
            {shownUnread.length > 0 ? (
              <button
                type="button"
                className="task-inbox-text-button"
                aria-label={shownUnread.length > 100 ? 'Mark first 100 shown as read' : 'Mark shown as read'}
                disabled={markRead.isPending}
                onClick={() => changeRead(shownUnread.slice(0, 100).map((item) => item.id), true)}
              >
                <CheckCheck size={14} aria-hidden="true" />
                Mark all read
              </button>
            ) : null}
          </div>
        </div>
        <div className="task-inbox-tabs" role="group" aria-label="Show updates">
          <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>
            Unread
          </button>
          <button type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>
            All
          </button>
        </div>
      </div>
      {query.isLoading ? (
        <div className="task-inbox-skeleton" aria-live="polite">
          <span className="sr-only">Loading updates…</span>
          <span /><span /><span />
        </div>
      ) : null}
      {query.latestError ? (
        <p className="task-inbox-note" role="alert">
          {query.data ? 'Could not refresh latest updates.' : 'Updates unavailable.'}{' '}
          <button type="button" disabled={query.isRefreshing} onClick={() => void query.retryLatest()}>
            {query.data ? 'Retry latest updates' : 'Retry'}
          </button>
        </p>
      ) : null}
      {query.historyError ? (
        <p className="task-inbox-note" role="alert">
          Could not load older updates.{' '}
          <button type="button" disabled={query.isFetchingNextPage} onClick={() => void query.retryOlder()}>Retry older updates</button>
        </p>
      ) : null}
      {query.isFetchingNextPage ? <p className="task-inbox-note" role="status">Loading older updates…</p> : null}
      {query.isRefreshing && !query.isLoading ? <p className="sr-only" role="status">Refreshing latest updates…</p> : null}
      {!query.isLoading && !query.isError && !items.length ? (
        <div className="task-inbox-empty">
          <Inbox size={20} aria-hidden="true" />
          <p>{unreadOnly ? 'No unread updates.' : 'No updates yet.'}</p>
          <span>{unreadOnly ? 'You’re all caught up.' : 'Changes to your tasks will show up here.'}</span>
        </div>
      ) : null}
      <ul className="task-inbox-list">
        {items.map((item) => {
          const Icon = icons[item.kind];
          const unread = !item.readAt;
          return (
            <li key={item.id} className="task-inbox-item" data-unread={unread} data-kind={item.kind}>
              <a
                href={item.href}
                className="task-inbox-link"
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  openItem(item);
                }}
              >
                <span className="task-inbox-icon" aria-hidden="true" title={labels[item.kind]}>
                  <Icon size={14} />
                </span>
                <span className="task-inbox-main">
                  <span className="sr-only">{unread ? 'Unread. ' : ''}{labels[item.kind]} from {item.actorName}. </span>
                  <span className="task-inbox-head">
                    <span className="task-inbox-key">{item.taskKey}</span>
                    <span className="task-inbox-title">{item.title}</span>
                  </span>
                  <span className="task-inbox-detail" title={inboxSummary(item)}>{inboxSummary(item)}</span>
                </span>
                <time className="task-inbox-time" dateTime={item.occurredAt} title={formatAbsoluteDateTime(item.occurredAt)}>
                  {compactAge(item.occurredAt)}
                </time>
              </a>
              <button
                type="button"
                className="task-inbox-read"
                disabled={markRead.isPending}
                aria-label={`Mark ${item.taskKey} update ${item.readAt ? 'unread' : 'read'}`}
                title={item.readAt ? 'Mark unread' : 'Mark read'}
                onClick={() => changeRead([item.id], !item.readAt)}
              >
                <span aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {query.hasNextPage && !query.historyError && !query.accessLost ? (
        <button type="button" className="task-inbox-more" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {query.isFetchingNextPage ? 'Loading…' : 'Older updates'}
        </button>
      ) : null}
      <DesktopAlertsSwitch />
    </section>
  );
}
