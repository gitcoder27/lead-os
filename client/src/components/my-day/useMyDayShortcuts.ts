import { useEffect, useRef } from 'react';

export interface MyDayShortcutHandlers {
  onFocusUpdate?: () => void;
  onAddTask?: () => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Single-key shortcuts for the ten-second visit: U update, N new task,
 * [ ] step days, T today. Never fires while typing or with modifiers, so it
 * can't collide with the browser or the text you're writing.
 */
export function useMyDayShortcuts(handlers: MyDayShortcutHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

      const h = handlersRef.current;
      const action =
        event.key === 'u' || event.key === 'U'
          ? h.onFocusUpdate
          : event.key === 'n' || event.key === 'N'
            ? h.onAddTask
            : event.key === '['
              ? h.onPrevDay
              : event.key === ']'
                ? h.onNextDay
                : event.key === 't' || event.key === 'T'
                  ? h.onToday
                  : undefined;
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
