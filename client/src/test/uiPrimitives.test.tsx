import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MenuItem, Popover } from '@/components/ui/Popover';
import { Dialog, DialogActions } from '@/components/ui/Dialog';
import { KeySpec } from '@/components/ui/Kbd';
import { DevStatusMark, STATUS_META } from '@/components/ui/DevStatus';
import { useModalFocus } from '@/hooks/useModalFocus';
import { getStatusInfo } from '@/components/my-day/status-config';

function Layer({ label, children }: { label: string; children?: React.ReactNode }) {
  const ref = useModalFocus<HTMLDivElement>();
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={label}>
      <button type="button">{label} first</button>
      <button type="button">{label} last</button>
      {children}
    </div>
  );
}

describe('ui/Dialog (docs/54 V1)', () => {
  it('focuses the first field, closes on Esc from anywhere, and submits on ⌘↵', () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(
      <Dialog title="Add check-in" onClose={onClose} onSubmit={onSubmit} footer={<DialogActions saveLabel="Save" isSaving={false} canSave onCancel={onClose} onSave={onSubmit} />}>
        <textarea aria-label="Note" />
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Add check-in' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Note')).toHaveFocus();
    fireEvent.keyDown(screen.getByLabelText('Note'), { key: 'Enter', metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves Esc to a modal layer stacked above it', () => {
    const onClose = vi.fn();
    render(<Dialog title="Lower" onClose={onClose}>body</Dialog>);
    const upper = document.createElement('div');
    upper.setAttribute('aria-modal', 'true');
    document.body.appendChild(upper);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    upper.remove();
  });
});

describe('useModalFocus stacking (docs/54 V1)', () => {
  it('lets the topmost layer own Tab', () => {
    // jsdom has no layout: report every attached element as rendered.
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return this.parentNode; } });
    render(
      <>
        <Layer label="Lower" />
        {/* A later modal layer that manages Tab itself (e.g. a Radix dialog). */}
        <div role="dialog" aria-modal="true" aria-label="Upper">
          <button type="button">Upper button</button>
        </div>
      </>,
    );
    screen.getByText('Upper button').focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    // The lower layer yields instead of pulling focus back into itself.
    expect(screen.getByText('Upper button')).toHaveFocus();
    if (original) Object.defineProperty(HTMLElement.prototype, 'offsetParent', original);
  });
});

describe('useModalFocus trap (docs/73 UXD-07)', () => {
  function Palette() {
    const ref = useModalFocus<HTMLDivElement>();
    return (
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Palette">
        <input aria-label="Search" />
        {/* A scrollable listbox Chrome makes focusable, with roving options that are not Tab stops. */}
        <div role="listbox" aria-label="Results" tabIndex={0}>
          <button type="button" role="option" aria-selected="true" tabIndex={-1}>Go to Today</button>
          <button type="button" role="option" aria-selected="false" tabIndex={-1}>Go to Tasks</button>
        </div>
      </div>
    );
  }

  it('cycles between real stops only, so Tab never escapes from a scroller or an option', () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return this.parentNode; } });
    render(<><button type="button">Outside</button><Palette /></>);
    const search = screen.getByRole('textbox', { name: 'Search' });
    const list = screen.getByRole('listbox', { name: 'Results' });
    list.focus();
    fireEvent.keyDown(list, { key: 'Tab' });
    expect(search).toHaveFocus();
    screen.getByRole('option', { name: 'Go to Today' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(list).toHaveFocus();
    fireEvent.keyDown(list, { key: 'Tab' });
    expect(search).toHaveFocus();
    if (original) Object.defineProperty(HTMLElement.prototype, 'offsetParent', original);
  });
});

describe('Popover focus return (docs/73 UXD-07)', () => {
  it('falls back to its trigger when the remembered element is the body', async () => {
    function Menu() {
      const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
      return (
        <>
          <button type="button" onClick={(event) => setAnchor(event.currentTarget)}>More</button>
          {anchor && <Popover anchor={anchor} onClose={() => setAnchor(null)} label="More"><MenuItem label="Notes" onSelect={() => setAnchor(null)} /></Popover>}
        </>
      );
    }
    render(<Menu />);
    const trigger = screen.getByRole('button', { name: 'More' });
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Notes' }), { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('KeySpec (docs/54 V9)', () => {
  it('renders one cap per key and keeps separators as text', () => {
    const { container } = render(<KeySpec keys="j / k" />);
    expect(container.querySelectorAll('kbd')).toHaveLength(2);
    expect(container).toHaveTextContent('j/k');
  });
});

describe('developer status vocabulary (docs/54 V6)', () => {
  it('uses one sentence-case label set across Team and My Day', () => {
    render(<DevStatusMark status="at_risk" />);
    expect(screen.getByText('At risk')).toBeInTheDocument();
    for (const status of Object.keys(STATUS_META) as Array<keyof typeof STATUS_META>) {
      expect(getStatusInfo(status).label).toBe(STATUS_META[status].label);
      expect(getStatusInfo(status).color).toBe(STATUS_META[status].color);
    }
    expect(getStatusInfo('done_for_today').label).toBe('Day done');
  });
});
