/**
 * docs/56 UX-22: a tone colour used as small text maps to its text token, which clears 4.5:1 on
 * every surface and on the tone's own tint in both themes (themeTokens.test.ts measures them).
 * Icons, fills and borders keep the raw tone.
 */
const TEXT_TOKENS: Record<string, string> = {
  'var(--accent)': 'var(--accent-text)',
  'var(--warning)': 'var(--warning-text)',
  'var(--danger)': 'var(--task-danger-text)',
  'var(--success)': 'var(--success-text)',
  'var(--info)': 'var(--info-text)',
};

export function toneText(color: string): string {
  return TEXT_TOKENS[color] ?? color;
}
