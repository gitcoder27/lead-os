import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TodayTextCaptureDialog } from '@/components/today/TodayTextCaptureDialog';
import type { TodayCaptureExtras } from '@/components/today/TodayTextCaptureDialog';

it.each([false, true])('retains a dialog request identity across uncertain retries and edits (meeting=%s)', (meeting) => {
  const save = vi.fn();
  const props = { title: 'Capture', label: 'Text', saveLabel: 'Save', isSaving: false, onClose: vi.fn(), onSave: save, ...(meeting ? { nextActionOwners: [{ accountId: 'dev-1', displayName: 'Developer' }] } : {}) };
  const view = render(<TodayTextCaptureDialog {...props} />);
  fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Original text' } });
  if (meeting) fireEvent.change(screen.getByLabelText('Next action (optional)'), { target: { value: 'Child action' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  const first = save.mock.calls[0]![1] as TodayCaptureExtras;
  expect(first.requestId).toMatch(/^[\da-f-]{36}$/);
  view.rerender(<TodayTextCaptureDialog {...props} errorMessage="Response was lost" />);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(save.mock.calls[1]![1]).toEqual(first);
  fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Edited text' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  // The server rejects incompatible reuse if the uncertain original committed.
  expect((save.mock.calls[2]![1] as TodayCaptureExtras).requestId).toBe(first.requestId);
  view.unmount();
  render(<TodayTextCaptureDialog {...props} defaultValue="Intentional new submission" />);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((save.mock.calls[3]![1] as TodayCaptureExtras).requestId).not.toBe(first.requestId);
});
