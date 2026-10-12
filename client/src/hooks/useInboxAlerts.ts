import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useDesktopAlerts } from '@/hooks/useDesktopAlerts';
import { useMarkTaskInboxRead, useTaskInboxLatest } from '@/hooks/useTaskInbox';
import { showDesktopAlert } from '@/lib/desktop-alerts';
import { describeInboxAlert, describeInboxBatch, setFaviconBadge, titleWithUnread } from '@/lib/inbox-alerts';
import { navigateToTaskPage } from '@/lib/task-nav';
import type { TaskInboxItem } from '@/types';

export const OPEN_INBOX_EVENT = 'leados-open-inbox';

/** The window is on screen and in use: a toast is seen. Otherwise the person is elsewhere. */
const isAway = () => document.visibilityState === 'hidden' || !document.hasFocus();

/**
 * Tells the person when their updates change, wherever they are:
 *  - in the tab: a short toast and the bell pulses;
 *  - in another tab or window: a desktop notification (when they allowed it), the tab title carries the count;
 *  - back from being away: one line saying what they missed.
 * Updates already waiting when the page opens are the bell's job, not an alert's.
 */
export function useInboxAlerts() {
  const scope = useAuthScopeKey();
  const qc = useQueryClient();
  const { addToast } = useToast();
  const latest = useTaskInboxLatest();
  const markRead = useMarkTaskInboxRead();
  const desktop = useDesktopAlerts();
  const seen = useRef<{ scope: string; highWater: number } | null>(null);
  const missed = useRef<TaskInboxItem[]>([]);
  const latestRef = useRef({ markRead, desktop, addToast });
  latestRef.current = { markRead, desktop, addToast };

  const unread = latest.enabled ? latest.data?.unreadCount ?? 0 : 0;
  const items = latest.enabled ? latest.data?.events : undefined;

  useEffect(() => {
    if (!items) return;
    const highWater = items.reduce((max, item) => Math.max(max, item.id), 0);
    if (seen.current?.scope !== scope) {
      seen.current = { scope, highWater };
      missed.current = [];
      return;
    }
    const fresh = items.filter((item) => item.id > seen.current!.highWater && !item.readAt).reverse();
    seen.current.highWater = Math.max(seen.current.highWater, highWater);
    if (!fresh.length) return;

    // The page behind the alert should already be current when the person arrives.
    void qc.invalidateQueries({ queryKey: ['my-day'] });
    const { markRead: mark, desktop: alerts, addToast: toast } = latestRef.current;
    const open = (item: TaskInboxItem) => {
      mark.mutate({ ids: [item.id], read: true });
      navigateToTaskPage(item.taskKey, false, item.eventId);
    };

    if (!isAway()) {
      const first = fresh[0]!;
      if (fresh.length === 1) {
        const { title, body } = describeInboxAlert(first);
        toast({ type: 'info', title, message: body.split('\n')[0], duration: 7000, action: { label: 'Open', onClick: () => open(first) } });
      } else {
        toast({ type: 'info', title: `${fresh.length} new updates`, duration: 7000, action: { label: 'View', onClick: () => window.dispatchEvent(new Event(OPEN_INBOX_EVENT)) } });
      }
      return;
    }

    missed.current = [...missed.current, ...fresh];
    if (!alerts.enabled) return;
    const single = fresh.length === 1 ? fresh[0]! : undefined;
    const text = single ? describeInboxAlert(single) : describeInboxBatch(fresh);
    showDesktopAlert({
      ...text,
      tag: single ? `leados-${single.taskKey}` : 'leados-updates',
      onClick: () => {
        // Clicking the notification is the acknowledgement; no "while you were away" line after it.
        missed.current = [];
        if (single) open(single);
        else window.dispatchEvent(new Event(OPEN_INBOX_EVENT));
      },
    });
  }, [items, qc, scope]);

  // Coming back: refresh what the page shows and say, once, what was missed.
  useEffect(() => {
    const back = () => {
      if (isAway()) return;
      void qc.invalidateQueries({ queryKey: ['task-inbox'] });
      void qc.invalidateQueries({ queryKey: ['my-day'] });
      const waiting = missed.current;
      missed.current = [];
      if (!waiting.length) return;
      const only = waiting.length === 1 ? waiting[0]! : undefined;
      latestRef.current.addToast({
        type: 'info',
        title: only ? describeInboxAlert(only).title : `${waiting.length} updates while you were away`,
        message: only ? describeInboxAlert(only).body.split('\n')[0] : undefined,
        duration: 8000,
        action: {
          label: only ? 'Open' : 'View',
          onClick: () => {
            if (only) {
              latestRef.current.markRead.mutate({ ids: [only.id], read: true });
              navigateToTaskPage(only.taskKey, false, only.eventId);
            } else window.dispatchEvent(new Event(OPEN_INBOX_EVENT));
          },
        },
      });
    };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => {
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
    };
  }, [qc]);

  // The count in the tab title and a dot on the icon.
  useEffect(() => {
    document.title = titleWithUnread(document.title, unread);
    void setFaviconBadge(unread > 0);
  }, [unread]);
  useEffect(() => () => {
    document.title = titleWithUnread(document.title, 0);
    void setFaviconBadge(false);
  }, []);
}
