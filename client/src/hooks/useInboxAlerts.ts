import { authEpoch } from '@/lib/auth-epoch';
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
 * A notification click arrives while the window is still coming back from the background. Changing the page
 * (a route change, a focus move, a scroll) in that moment is when browsers are least able to paint it, so wait
 * until the tab is visible and a frame can run, with a short fallback in case visibility never reports.
 */
function whenVisible(run: () => void) {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    document.removeEventListener('visibilitychange', onChange);
    window.clearTimeout(fallback);
    window.setTimeout(run, 0);
  };
  const onChange = () => {
    if (document.visibilityState === 'visible') go();
  };
  const fallback = window.setTimeout(go, 1500);
  if (document.visibilityState === 'visible') go();
  else document.addEventListener('visibilitychange', onChange);
}

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
    const epoch = authEpoch(qc);
    const isCurrent = () => authEpoch(qc) === epoch && seen.current?.scope === scope;
    const open = (item: TaskInboxItem, fromNotification = false) => {
      if (!isCurrent()) return;
      mark.mutate({ ids: [item.id], read: true });
      const go = () => { if (isCurrent()) navigateToTaskPage(item.taskKey, false, item.eventId); };
      if (fromNotification) whenVisible(go);
      else go();
    };

    if (!isAway()) {
      const first = fresh[0]!;
      if (fresh.length === 1) {
        const { title, body } = describeInboxAlert(first);
        toast({ type: 'info', title, message: body.split('\n')[0], duration: 7000, action: { label: 'Open', onClick: () => open(first) } });
      } else {
        toast({ type: 'info', title: `${fresh.length} new updates`, duration: 7000, action: { label: 'View', onClick: () => { if (isCurrent()) window.dispatchEvent(new Event(OPEN_INBOX_EVENT)); } } });
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
        if (!isCurrent()) return;
        // Clicking the notification is the acknowledgement; no "while you were away" line after it.
        missed.current = [];
        if (single) open(single, true);
        else whenVisible(() => { if (isCurrent()) window.dispatchEvent(new Event(OPEN_INBOX_EVENT)); });
      },
    });
  }, [items, qc, scope]);

  // Coming back: refresh what the page shows and say, once, what was missed.
  useEffect(() => {
    let lastBack = 0;
    let timer: number | undefined;
    const back = () => {
      if (isAway()) return;
      // Focus and visibility both fire on the way back; treat them as one return.
      const now = Date.now();
      if (now - lastBack < 1000) return;
      lastBack = now;
      void qc.invalidateQueries({ queryKey: ['task-inbox'] });
      void qc.invalidateQueries({ queryKey: ['my-day'] });
      // A click on the desktop notification lands just after the window does; give it the chance to
      // acknowledge the update before a "while you were away" line talks over the page it is opening.
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
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
      }, 700);
    };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
    };
  }, [qc]);

  // The count in the tab title and a dot on the icon. The title is re-asserted from the inbox on every render and
  // on the way back to the tab, so a stale count (a title written by someone else, a tab that slept) heals itself.
  const unreadRef = useRef(unread);
  unreadRef.current = unread;
  useEffect(() => {
    const wanted = titleWithUnread(document.title, unread);
    if (document.title !== wanted) document.title = wanted;
  });
  useEffect(() => {
    void setFaviconBadge(unread > 0);
  }, [unread]);
  useEffect(() => {
    const sync = () => {
      const wanted = titleWithUnread(document.title, unreadRef.current);
      if (document.title !== wanted) document.title = wanted;
    };
    window.addEventListener('focus', sync);
    window.addEventListener('pageshow', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('pageshow', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  useEffect(() => () => {
    document.title = titleWithUnread(document.title, 0);
    void setFaviconBadge(false);
  }, []);
}
