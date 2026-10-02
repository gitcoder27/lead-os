import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Bell } from 'lucide-react';
import { useTaskInbox } from '@/hooks/useTaskInbox';
import { TaskInboxContent } from './TaskInboxContent';

/** The developer's personal inbox; it never queries manager attention endpoints. */
export function TaskInboxPopover() {
  const [open, setOpen] = useState(false);
  const query = useTaskInbox();
  if (!query.enabled) return null;
  const count = query.data?.pages[0]?.unreadCount ?? 0;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="task-inbox-trigger"
          aria-label={`Updates${count ? `, ${count} unread` : ''}${query.isError ? ', unavailable' : ''}`}
        >
          <Bell size={16} />
          {count > 0 ? <span>{count > 99 ? '99+' : count}</span> : null}
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
