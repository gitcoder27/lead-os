import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * True while a modal layer mounted later in the document (a dialog, drawer or
 * palette portaled above `root`) is open — that layer owns Tab and Esc.
 */
export function isCoveredByLaterLayer(root: Element | null): boolean {
  if (!root || typeof document === 'undefined') return false;
  return Array.from(document.querySelectorAll('[aria-modal="true"]')).some(
    (layer) => layer !== root && !root.contains(layer)
      && Boolean(root.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
}

/**
 * Modal focus management for drawer/dialog layers (P3, §6.2; docs/54 V1):
 * while `active`, Tab and Shift+Tab cycle inside the container ref, and focus
 * returns to the element that was focused before the layer opened when it
 * deactivates/unmounts. Layers stack: while a later modal layer is mounted,
 * this one yields Tab to it. Pass `externalRef` when the caller owns the ref.
 */
export function useModalFocus<T extends HTMLElement>(active = true, externalRef?: RefObject<T>): RefObject<T> {
  const ownRef = useRef<T>(null);
  const ref = externalRef ?? ownRef;
  // Capture the opener during render: a child's autofocus effect runs before
  // this effect, so reading activeElement there would record the layer itself.
  const openerRef = useRef<HTMLElement | null>(null);
  if (active && openerRef.current === null && typeof document !== 'undefined') {
    const current = document.activeElement;
    if (current instanceof HTMLElement && current !== document.body) openerRef.current = current;
  }

  useEffect(() => {
    if (!active) return;
    const captured = openerRef.current;
    const fallback = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previous = captured ?? (fallback && !ref.current?.contains(fallback) ? fallback : null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      // Portaled popovers (menus, date pickers) own Tab while they are focused.
      if (event.target instanceof Element && event.target.closest('[data-popover-layer]')) return;
      const root = ref.current;
      if (!root || isCoveredByLaterLayer(root)) return;
      const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null && !el.closest('[aria-hidden="true"]'),
      );
      if (!focusables.length) {
        event.preventDefault();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const current = document.activeElement as HTMLElement | null;
      if (current === root) {
        // Focus parked on the container (e.g. on open): enter at either end.
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      const inside = current !== null && root.contains(current);
      if (event.shiftKey) {
        if (!inside || current === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      openerRef.current = null;
      if (previous?.isConnected) previous.focus();
    };
  }, [active, ref]);

  return ref;
}
