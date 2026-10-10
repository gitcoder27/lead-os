import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

/**
 * docs/73 UXD-02: one type scale. Six sizes (11/12/13/15/19/24px) at weights 400/500/600,
 * as `--fs-*` tokens and the Tailwind names text-meta … text-display. The landing page is exempt.
 */
const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');
const walk = (dir: string): string[] => readdirSync(resolve(root, dir)).flatMap((name) => {
  const rel = `${dir}/${name}`;
  if (rel.includes('/landing') || rel.startsWith('test')) return [];
  return statSync(resolve(root, rel)).isDirectory() ? walk(rel) : [rel];
});
const files = [...walk('components'), ...walk('lib'), ...walk('hooks'), 'App.tsx', 'index.css'];
const tsx = files.filter((file) => /\.tsx?$/.test(file));
const css = files.filter((file) => file.endsWith('.css'));

describe('type scale (docs/73 UXD-02)', () => {
  it('defines the six size tokens and maps them in Tailwind', () => {
    const index = read('index.css');
    for (const px of [11, 12, 13, 15, 19, 24]) expect(index).toContain(`--fs-${px}: ${px}px;`);
    const tailwind = readFileSync(resolve(root, '..', 'tailwind.config.ts'), 'utf8');
    for (const name of ['meta', 'ui', 'body', "'title-sm'", 'title', 'display']) expect(tailwind).toMatch(new RegExp(`${name}: 'var\\(--fs-\\d+\\)'`));
  });

  it('uses no arbitrary or default Tailwind font sizes outside the landing page', () => {
    const offenders = tsx.flatMap((file) => [...read(file).matchAll(/(?<![\w-])text-(\[\d[\d.]*px\]|xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/g)].map((match) => `${file}: ${match[0]}`));
    expect(offenders).toEqual([]);
  });

  it('sets CSS font sizes only from the scale (em-relative editor content is allowed)', () => {
    const offenders = css.flatMap((file) => [...read(file).matchAll(/font-size:\s*([^;]+);/g)]
      .map((match) => match[1]!.trim())
      .filter((value) => !/^var\(--fs-(11|12|13|15|19|24|input-touch)\)$/.test(value) && !/^[\d.]+em$/.test(value) && value !== 'inherit')
      .map((value) => `${file}: ${value}`));
    expect(offenders).toEqual([]);
  });

  it('uses only weights 400, 500 and 600', () => {
    const tsxOffenders = tsx.filter((file) => /\bfont-(bold|extrabold|black|light|thin)\b/.test(read(file)));
    const cssOffenders = css.flatMap((file) => [...read(file).matchAll(/font-weight:\s*([^;]+);/g)].map((match) => match[1]!.trim()).filter((value) => !['400', '500', '600', 'inherit', 'normal'].includes(value)).map((value) => `${file}: ${value}`));
    expect([...tsxOffenders, ...cssOffenders]).toEqual([]);
  });

  it('keeps labels in sentence case: uppercase only for palette and menu group headings (docs/73 UXD-03)', () => {
    const allowed = ['components/ui/Popover.tsx', 'components/palette/CommandPalette.tsx', 'components/table/DefectTable.tsx'];
    const offenders = [...tsx, ...css]
      .filter((file) => !file.includes('/manager-desk/'))
      .flatMap((file) => [...read(file).matchAll(/(?<![\w-])uppercase(?![\w:)-])/g)].map(() => file))
      .filter((file) => !allowed.includes(file));
    expect(offenders).toEqual([]);
    // The allowed files carry exactly their group heading (DefectTable: the status-filter menu).
    for (const file of allowed) expect(read(file).match(/(?<![\w-])uppercase(?![\w:)-])/g)).toHaveLength(1);
  });

  it('cn() treats the scale names as sizes, so a colour class does not drop them', () => {
    expect(cn('text-ui', 'text-text-primary')).toBe('text-ui text-text-primary');
    expect(cn('text-body', 'text-meta')).toBe('text-meta');
  });
});
