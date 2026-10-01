import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');

/**
 * docs/56 P7-05. Text on an accent fill must use `--on-accent` (white in light, near-black in dark,
 * so it stays readable on both accents). A literal `#fff` reads fine in light and fails in dark.
 * Source scan: it catches the regression without rendering every surface in both themes.
 */
describe('accent surfaces use theme tokens (docs/56 P7-05)', () => {
  const accentFiles = [
    'App.tsx',
    'components/settings/SettingsPanel.tsx',
    'components/settings/TeamModeSection.tsx',
    'components/settings/AssistantSection.tsx',
    'components/settings/TagManagementSection.tsx',
  ];
  // Text on a danger or success fill uses its own token (docs/56 P7-05 review).
  const statusFiles = [
    ['components/tasks/TaskDrawer.tsx', null],
    ['components/actions/ManagerActionInbox.tsx', 'var(--on-danger)'],
    ['components/table/DismissCell.tsx', 'var(--on-success)'],
  ] as const;

  it.each(accentFiles)('%s has no hard-coded white', (file) => {
    const source = src(file);
    expect(source).not.toMatch(/#fff\b/i);
    expect(source).not.toMatch(/#ffffff\b/i);
    expect(source).toContain('var(--on-accent)');
  });

  it.each(statusFiles)('%s has no hard-coded white on a status fill', (file, token) => {
    const source = src(file);
    expect(source).not.toMatch(/#fff\b|#ffffff\b|text-white/i);
    if (token) expect(source).toContain(token);
  });

  it('the solid danger button and the status tokens are themed, not literal', () => {
    const css = src('index.css');
    expect(css).toMatch(/\.ui-btn-danger-solid \{[^}]*color: var\(--on-danger\)/);
    expect(css.match(/--on-danger:/g)).toHaveLength(2);
    expect(css.match(/--on-success:/g)).toHaveLength(2);
  });

  it('the Copilot dock shadow comes from the shared overlay token', () => {
    const dock = src('components/assistant/AssistantDock.tsx');
    expect(dock).toContain('var(--overlay-shadow)');
    expect(dock).not.toContain('rgba(0,0,0,0.45)');
  });

  it('defines --on-accent for both themes', () => {
    const css = src('index.css');
    expect(css.match(/--on-accent:/g)).toHaveLength(2);
  });
});

/**
 * docs/63 #3: measured contrast. Reads the real tokens out of index.css, composites the 12% chip tint
 * over each surface and applies the WCAG formula, so a token change that breaks contrast fails here.
 */
describe('contrast of text, chips and focus (docs/63 #3)', () => {
  type Rgb = [number, number, number];
  const css = src('index.css');

  function block(selector: RegExp): Record<string, string> {
    const body = css.match(selector)?.[1] ?? '';
    return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]));
  }
  const light = block(/:root \{([\s\S]*?)\n\}/);
  const dark = { ...light, ...block(/\n\.dark \{([\s\S]*?)\n\}/) };

  const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
  const mix = (front: Rgb, back: Rgb, frontShare: number): Rgb => front.map((v, i) => v * frontShare + back[i]! * (1 - frontShare)) as Rgb;
  const luminance = ([r, g, b]: Rgb) => {
    const channel = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (a: Rgb, b: Rgb) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };

  const themes = [['light', light], ['dark', dark]] as const;
  const surfaces = ['--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-elevated'];

  it.each(themes)('%s: accent text clears 4.5:1 on every surface', (_name, tokens) => {
    for (const surface of surfaces) expect(ratio(rgb(tokens['--accent-text']!), rgb(tokens[surface]!))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(themes)('%s: warning text clears 4.5:1 on every surface', (_name, tokens) => {
    for (const surface of surfaces) expect(ratio(rgb(tokens['--warning-text']!), rgb(tokens[surface]!))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(themes)('%s: chip text clears 4.5:1 on its own tint for every tone and surface', (_name, tokens) => {
    // Mirrors `.ui-chip`: text = tone 45% into --text-primary; fill = tone at 12% over the surface.
    for (const tone of ['--danger', '--warning', '--success', '--info', '--accent', '--text-muted']) {
      const toneColor = rgb(tokens[tone]!);
      const text = mix(toneColor, rgb(tokens['--text-primary']!), 0.45);
      for (const surface of surfaces) {
        const fill = mix(toneColor, rgb(tokens[surface]!), 0.12);
        expect(ratio(text, fill), `${tone} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(themes)('%s: the focus ring clears 3:1 on every surface', (_name, tokens) => {
    for (const surface of surfaces) expect(ratio(rgb(tokens['--focus-ring']!), rgb(tokens[surface]!))).toBeGreaterThanOrEqual(3);
  });

  it('every focus outline and the Today keyboard cursor use the opaque ring, not the translucent border', () => {
    expect(css).toMatch(/\.ui-chip \{[^}]*color-mix\(in srgb, var\(--tone, var\(--text-secondary\)\) 45%, var\(--text-primary\)\)/);
    const today = src('components/today/today.css');
    expect(today).toMatch(/data-keyboard-active='true'\] \{\s*box-shadow: inset 0 0 0 2px var\(--focus-ring\)/);
    for (const file of ['index.css', 'components/today/today.css', 'components/notes/notes.css', 'components/review/review.css']) {
      expect(src(file)).not.toMatch(/outline: 2px solid var\(--border-active\)/);
    }
  });
});
