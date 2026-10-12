import { useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Bell } from 'lucide-react';
import { OPEN_INBOX_EVENT } from '@/hooks/useInboxAlerts';
import { useTaskInboxLatest } from '@/hooks/useTaskInbox';
import { TaskInboxContent } from './TaskInboxContent';

/** The developer's personal inbox; it never queries manager attention endpoints. */
export function TaskInboxPopover() {
  const [open, setOpen] = useState(false);
  const query = useTaskInboxLatest();
  const count = query.data?.unreadCount ?? 0;
  const [ping, setPing] = useState(false);
  const previous = useRef<number | null>(null);
  // Ring when the count goes up while the page is open, never for what was already waiting.
  useEffect(() => {
    const before = previous.current;
    previous.current = count;
    if (before === null || count <= before) return;
    setPing(true);
    const timer = window.setTimeout(() => setPing(false), 1200);
    return () => window.clearTimeout(timer);
  }, [count]);
  // "View" on a toast or a clicked desktop notification brings the person here.
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_INBOX_EVENT, show);
    return () => window.removeEventListener(OPEN_INBOX_EVENT, show);
  }, []);
  if (!query.enabled) return null;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="task-inbox-bell"
          data-ping={ping}
          data-unread={count > 0}
          title="Updates"
          aria-label={`Updates${count ? `, ${count} unread` : ''}${query.isError ? ', unavailable' : ''}`}
        >
          <Bell size={16} aria-hidden="true" />
          {count > 0 ? <span aria-hidden="true">{count > 99 ? '99+' : count}</span> : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={10}
          aria-label="Updates inbox"
          className="task-inbox-popover z-popover"
        >
          <TaskInboxContent onOpen={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
