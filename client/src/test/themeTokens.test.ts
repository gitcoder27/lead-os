import { readdirSync, readFileSync, statSync } from 'node:fs';
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

  it.each(themes)('%s: Tasks warning/danger text clears 4.5:1 on normal, hover, focus, selected and severity fills', (_name, tokens) => {
    const rgba = tokens['--accent-glow']!.match(/[\d.]+/g)!.map(Number);
    for (const surface of surfaces) {
      const base = rgb(tokens[surface]!);
      const states = [base, mix(rgb(tokens['--bg-tertiary']!), base, 0.7), mix(rgb(tokens['--bg-tertiary']!), base, 0.55), mix(rgba.slice(0, 3) as Rgb, base, rgba[3]!)];
      for (const tone of ['warning', 'danger']) {
        const text = rgb(tokens[`--task-${tone}-text`]!);
        for (const state of states) {
          for (const share of [0, 0.12, 0.16, 0.2]) {
            const background = mix(rgb(tokens[`--${tone}`]!), state, share);
            expect(ratio(text, background), `${tone} on ${surface}, tint ${share}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
      // The key itself retains the existing colour and passes on its unselected surface.
      if (surface === '--bg-primary') expect(ratio(rgb(tokens['--text-disabled']!), base), `key on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

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

  it.each(themes)('%s: accent text clears 4.5:1 on the active nav, rail and pill tints (UX-22)', (_name, tokens) => {
    for (const surface of surfaces) {
      for (const share of [0.12, 0.15, 0.22]) {
        const tint = mix(rgb(tokens['--accent']!), rgb(tokens[surface]!), share);
        expect(ratio(rgb(tokens['--accent-text']!), tint), `${surface} at ${share}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(themes)('%s: success and info text tokens clear 4.5:1 on every surface and on their 8% tile tint (UX-22)', (_name, tokens) => {
    for (const tone of ['success', 'info', 'warning', 'accent']) {
      const text = rgb(tokens[`--${tone}-text`]!);
      for (const surface of surfaces) {
        expect(ratio(text, rgb(tokens[surface]!)), `${tone} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(text, mix(rgb(tokens[`--${tone}`]!), rgb(tokens[surface]!), 0.08)), `${tone} on its tint over ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(themes)('%s: count badges are readable: on-danger over the solid danger fill clears 4.5:1 (UX-22)', (_name, tokens) => {
    expect(ratio(rgb(tokens['--on-danger']!), rgb(tokens['--danger-solid']!))).toBeGreaterThanOrEqual(4.5);
  });

  it('small accent and status text uses the text tokens, not the raw tone (UX-22)', () => {
    expect(src('components/layout/WorkspaceNavLink.tsx')).toContain('toneText(');
    expect(src('components/tasks/TaskViewRail.tsx')).not.toMatch(/color: selected \? 'var\(--accent\)'/);
    expect(src('components/actions/ManagerActionInbox.tsx')).toContain("background: 'var(--danger-solid)'");
    expect(src('components/work/WorkFocusStrip.tsx')).toContain('toneText(');
    expect(src('components/notes/notes.css')).not.toMatch(/\.notes-day-row\.selected \.notes-day-row-date \{\s*color: var\(--accent\);/);
  });

  it.each(themes)('%s: the focus ring clears 3:1 on every surface', (_name, tokens) => {
    for (const surface of surfaces) expect(ratio(rgb(tokens['--focus-ring']!), rgb(tokens[surface]!))).toBeGreaterThanOrEqual(3);
  });

  it('every remaining focus outline uses the opaque ring, not the translucent border; chip text is mixed toward the text colour', () => {
    expect(css).toMatch(/\.ui-chip \{[^}]*color-mix\(in srgb, var\(--tone, var\(--text-secondary\)\) 45%, var\(--text-primary\)\)/);
    for (const file of ['index.css', 'components/today/today.css', 'components/notes/notes.css', 'components/review/review.css']) {
      expect(src(file)).not.toMatch(/outline: 2px solid var\(--border-active\)/);
    }
  });

  it('no list row is selected or focused with a ring around the whole row; they share one tint-and-bar idiom', () => {
    const walk = (dir: string): string[] => readdirSync(resolve(__dirname, '..', dir)).flatMap((name) => {
      const rel = `${dir}/${name}`;
      return statSync(resolve(__dirname, '..', rel)).isDirectory() ? walk(rel) : /\.(css|tsx)$/.test(name) ? [rel] : [];
    });
    const offenders = walk('components').filter((file) => /inset 0 0 0 2px|inset_0_0_0_2px/.test(src(file)));
    expect(offenders).toEqual([]);
    const css = src('index.css');
    expect(css).toMatch(/\.ui-row-focus:focus-visible \{[^}]*outline: none;[^}]*box-shadow: inset 3px 0 0 var\(--accent\)/);
    for (const file of ['components/tasks/TaskListRow.tsx', 'components/team-tracker/TrackerRosterBoard.tsx', 'components/team-tracker/one-on-one/AgendaColumn.tsx']) {
      expect(src(file)).toContain('ui-row-focus');
    }
    expect(src('components/today/today.css')).toMatch(/data-keyboard-active='true'\] \{[^}]*inset 3px 0 0 var\(--accent\)/);
  });
});
