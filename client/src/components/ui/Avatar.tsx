/**
 * docs/54 V8: one avatar for a person everywhere — a hue-hashed initials disc
 * seeded by account id, so the same person is the same colour on Tasks,
 * Standup, the Team board and Today. `tone` adds a status ring (Today's
 * people rows); `ring` marks the current/selected person (Standup rail).
 */

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : parts[0]!.charAt(1);
  return `${first}${last}`.toUpperCase();
}

/** Stable hue per person so avatars are recognisable across the app. */
export function avatarHue(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  return Math.abs(hash) % 360;
}

export function Avatar({ name, seed, size = 20, muted = false, tone, ring = false }: {
  name: string;
  /** Account id where known — keeps the hue stable when display names change. */
  seed?: string;
  size?: number;
  muted?: boolean;
  /** CSS colour for a status ring, e.g. `var(--tone)` or `var(--warning)`. */
  tone?: string;
  /** Accent ring for the current/selected person. */
  ring?: boolean;
}) {
  const hue = avatarHue(seed ?? name);
  const shadows = [
    tone ? `0 0 0 1.5px color-mix(in srgb, ${tone} 70%, transparent)` : null,
    ring ? '0 0 0 2px var(--bg-secondary), 0 0 0 3.5px var(--accent)' : null,
  ].filter(Boolean);
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.4)),
        background: muted ? 'var(--bg-tertiary)' : `hsl(${hue} 70% 50% / 0.18)`,
        color: muted ? 'var(--text-muted)' : `hsl(${hue} 65% var(--avatar-text-l))`,
        border: `1px solid ${muted ? 'var(--border)' : `hsl(${hue} 70% 55% / 0.35)`}`,
        boxShadow: shadows.length ? shadows.join(', ') : undefined,
      }}
    >
      {initials(name)}
    </span>
  );
}
