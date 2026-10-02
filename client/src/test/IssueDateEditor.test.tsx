import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { IssueDateEditor } from '@/components/table/IssueDateEditor';
describe('Jira date editing', () => {
  it('keeps typing local, then commits once on Enter followed by blur', () => {
    const save = vi.fn(),
      close = vi.fn();
    render(<IssueDateEditor currentValue="2026-10-02" onSave={save} onClose={close} />);
    const input = screen.getByLabelText('Due date');
    fireEvent.change(input, { target: { value: '2026-10-05' } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(save).toHaveBeenCalledExactlyOnceWith('2026-10-05');
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('clears with null on blur and cancels changed dates with Escape', () => {
    const save = vi.fn(),
      close = vi.fn();
    const { unmount } = render(<IssueDateEditor currentValue="2026-10-02" onSave={save} onClose={close} />);
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '' } });
    fireEvent.blur(screen.getByLabelText('Due date'));
    expect(save).toHaveBeenCalledWith(null);
    unmount();
    save.mockClear();
    render(<IssueDateEditor currentValue="2026-10-02" onSave={save} onClose={close} />);
    const input = screen.getByLabelText('Due date');
    fireEvent.change(input, { target: { value: '2026-10-05' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(save).not.toHaveBeenCalled();
  });
});
