/** docs/54 D3: the one keyboard focus ring for controls. */
export const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-active)]';

/** True for fields where plain-letter shortcuts must not fire. */
export function isEditable(el: Element): boolean {
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}
