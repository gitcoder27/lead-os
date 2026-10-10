import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Select } from '@/components/ui/Select';
import { Disclosure } from '@/components/ui/Disclosure';

/** docs/73 UXD-05: one styled native select, one chevron disclosure, one shortcut formatter. */
describe('Select', () => {
  it('is a labelled native select that forwards its ref and change events', () => {
    const onChange = vi.fn();
    const ref = createRef<HTMLSelectElement>();
    render(
      <label>
        Cadence
        <Select ref={ref} size="sm" className="w-full" value="weekly" onChange={onChange}>
          <option value="weekly">Weekly</option>
          <option value="biweekly">Every two weeks</option>
        </Select>
      </label>,
    );
    const select = screen.getByRole('combobox', { name: 'Cadence' });
    expect(select.tagName).toBe('SELECT');
    expect(ref.current).toBe(select);
    expect(select.parentElement).toHaveClass('ui-select', 'w-full');
    expect(select.parentElement).toHaveAttribute('data-size', 'sm');
    fireEvent.change(select, { target: { value: 'biweekly' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('Disclosure', () => {
  it('toggles aria-expanded and keeps its panel mounted while closed', () => {
    render(<Disclosure summary="Examples"><input aria-label="Draft" defaultValue="kept" /></Disclosure>);
    const trigger = screen.getByRole('button', { name: 'Examples' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    expect(panel).not.toBeVisible();
    expect(screen.getByLabelText('Draft', { selector: 'input' })).toHaveValue('kept');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toBeVisible();
  });

  it('follows a controlled open state', () => {
    const onOpenChange = vi.fn();
    function Controlled() {
      const [open, setOpen] = useState(true);
      return <Disclosure summary="Project" open={open} onOpenChange={(next) => { onOpenChange(next); setOpen(next); }}>Picker</Disclosure>;
    }
    render(<Controlled />);
    const trigger = screen.getByRole('button', { name: 'Project' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('source guards (docs/73 UXD-05)', () => {
  const root = resolve(__dirname, '..');
  const walk = (dir: string): string[] => readdirSync(resolve(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (rel.includes('/landing') || rel.includes('/manager-desk')) return [];
    return statSync(resolve(root, rel)).isDirectory() ? walk(rel) : /\.tsx?$/.test(name) ? [rel] : [];
  });
  const files = [...walk('components'), ...walk('lib'), 'App.tsx'];
  const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

  it('has no bare <select> outside the Select primitive and legacy /desk', () => {
    expect(files.filter((file) => file !== 'components/ui/Select.tsx' && /<select\b/.test(read(file)))).toEqual([]);
  });

  it('has no <details> disclosure outside the documented menu exception', () => {
    expect(files.filter((file) => /<details[\s>](?!`)/.test(read(file)))).toEqual(['components/actions/ManagerActionInbox.tsx']);
  });

  it('renders ⌘ only through Kbd, KeySpec or formatShortcutKeys, so Linux and Windows read Ctrl', () => {
    const offenders = files
      .filter((file) => file !== 'lib/keyboard-shortcuts.ts' && file !== 'components/ui/Kbd.tsx')
      .flatMap((file) => read(file).split('\n').map((line, index) => ({ file, line: line.trim(), index })))
      .filter(({ line }) => line.includes('⌘'))
      .filter(({ line }) => !/^(\/\/|\*|\/\*|\{\/\*)/.test(line) && !/formatShortcutKeys\(|<KeySpec|<Kbd|keys: \[\[/.test(line))
      .map(({ file, index, line }) => `${file}:${index + 1} ${line}`);
    expect(offenders).toEqual([]);
  });
});
