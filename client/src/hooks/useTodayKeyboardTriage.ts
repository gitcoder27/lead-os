import { useEffect, useMemo, useRef, useState } from 'react';
import { focusedRowId, resolveTriageKey, triageOwnsEvent } from '@/lib/today-triage';
import type { TodayActionCommand, TodayActionItem } from '@/types';

interface UseTodayKeyboardTriageOptions {
  /** Rows in display order. */
  items: TodayActionItem[];
  /** Off while a dialog/menu owns the keyboard. */
  enabled: boolean;
  onOpen: (item: TodayActionItem) => void;
  onRunCommand: (command: TodayActionCommand, preset?: 'tomorrow') => void;
  /** Returns false when there was nothing to undo. */
  onUndo: () => boolean;
}

/**
 * docs/53 U4: j/k/Enter/e/s/f/c/z on Today. The active row is tracked by id
 * so optimistic removals keep the cursor on the next row, not a stale index.
 *
 * docs/63 #3: the cursor and real focus move together. Keys act on the row
 * that has focus (else the cursor row), only from the page or the queue, and
 * Enter/Space on a focused button is left to the browser.
 */
export function useTodayKeyboardTriage({ items, enabled, onOpen, onRunCommand, onUndo }: UseTodayKeyboardTriageOptions) {
  const [activeId, setActiveId] = useState<string | undefined>();
  const lastIndex = useRef(0);

  const activeIndex = useMemo(() => {
    if (!activeId) return -1;
    return items.findIndex((item) => item.id === activeId);
  }, [activeId, items]);

  // When the active row disappears (done/snoozed), move to the row that took its place.
  useEffect(() => {
    if (activeIndex >= 0) {
      lastIndex.current = activeIndex;
      return;
    }
    if (activeId && items.length > 0) {
      setActiveId(items[Math.min(lastIndex.current, items.length - 1)]?.id);
    }
  }, [activeId, activeIndex, items]);

  const handlers = useRef({ items, onOpen, onRunCommand, onUndo, activeIndex });
  handlers.current = { items, onOpen, onRunCommand, onUndo, activeIndex };

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!triageOwnsEvent(event)) return;
      const current = handlers.current;
      // A focused row is the target, wherever the cursor was left.
      const focusedId = focusedRowId(event.target);
      const focusedIndex = focusedId === undefined ? -1 : current.items.findIndex((entry) => entry.id === focusedId);
      const index = focusedIndex >= 0 ? focusedIndex : current.activeIndex;
      // Focus on something that is not a top-level row (a group's member) acts on no row at all.
      const item = focusedId !== undefined && focusedIndex < 0 ? undefined : index >= 0 ? current.items[index] : undefined;
      const intent = resolveTriageKey(event.key, item);
      if (!intent) return;
      if (intent.type === 'move') {
        if (current.items.length === 0) return;
        event.preventDefault();
        const from = index < 0 ? (intent.delta > 0 ? -1 : current.items.length) : index;
        const next = Math.min(Math.max(from + intent.delta, 0), current.items.length - 1);
        const nextId = current.items[next]?.id;
        setActiveId(nextId);
        if (nextId) focusRow(nextId);
        return;
      }
      if (intent.type === 'undo') {
        if (current.onUndo()) event.preventDefault();
        return;
      }
      if (!item) return;
      event.preventDefault();
      if (intent.type === 'open') {
        current.onOpen(item);
        return;
      }
      current.onRunCommand(intent.command, intent.preset);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);

  return { activeId: activeIndex >= 0 ? activeId : undefined, setActiveId };
}

/** Moves real focus (and the scroll position) to a queue row's link. */
function focusRow(id: string) {
  const row = Array.from(document.querySelectorAll('[data-today-queue] [data-row-id]')).find((node) => node.getAttribute('data-row-id') === id);
  row?.querySelector<HTMLElement>('[data-row-link]')?.focus();
}
