/**
 * Marks the manager's own roster row ("This is me"). Plain text on a soft tint, so it reads as a label
 * beside the name rather than a status.
 */
export function YouTag({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span
      className="ml-1.5 shrink-0 rounded-full px-1.5 py-px align-middle text-[11px] font-semibold"
      style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent-text, var(--accent))' }}
    >
      You
    </span>
  );
}
