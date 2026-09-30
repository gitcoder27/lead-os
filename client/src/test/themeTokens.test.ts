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
