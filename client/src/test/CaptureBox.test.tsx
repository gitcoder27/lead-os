import { act, render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureResponseBody } from 'shared/capture-grammar';
import { CaptureBox } from '@/components/capture/CaptureBox';
import { TestWrapper } from './wrapper';
import { getLocalIsoDate } from '@/lib/utils';

const mockMutate = vi.fn();
const mockAddToast = vi.fn();

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@/hooks/useCapture', () => ({
  useCapture: () => ({ mutate: mockMutate, isPending: false }),
}));

vi.mock('@/hooks/useDevelopers', () => ({
  useDevelopers: () => ({
    data: [
      { accountId: 'dev-1', displayName: 'Alice Smith' },
      { accountId: 'dev-4', displayName: 'Alice Chen' },
      { accountId: 'dev-2', displayName: 'Bob Jones' },
    ],
  }),
}));

function renderBox(prefill = '') {
  const onClose = vi.fn();
  const utils = render(
    <TestWrapper>
      <CaptureBox prefill={prefill} onClose={onClose} />
    </TestWrapper>,
  );
  const input = screen.getByLabelText('Capture');
  return { onClose, input, ...utils };
}

function lastBody() {
  return mockMutate.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

function succeed(body: Record<string, unknown>) {
  // Simulate the default server response: a created task.
  const options = mockMutate.mock.calls.at(-1)?.[1] as {
    onSuccess: (res: CaptureResponseBody) => void;
  };
  act(() => options.onSuccess({
    intent: 'create',
    diagnostics: [],
    confirmRequired: false,
    blocked: false,
    task: { taskKey: 'T-5', title: String(body.text).split(' ').pop() ?? 'T-5' } as CaptureResponseBody['task'],
  }));
}

describe('CaptureBox (P3-D8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a live summary of parsed tokens', () => {
    const { input } = renderBox('@dev-1 !fri +urgent Ship the login fix');
    fireEvent.change(input, { target: { value: '@dev-1 !fri +urgent Ship the login fix' } });

    const summary = screen.getByTestId('capture-summary');
    expect(summary.textContent).toContain('Alice Smith');
    expect(summary.textContent).toContain('urgent');
    expect(summary.textContent).toMatch(/\w{3}, \w{3} \d+/); // formatted date chip
  });

  it('blocks submit on an unknown person token', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: '@nobody check this' } });

    expect(screen.getByTestId('capture-diagnostics').textContent).toMatch(/Nobody matches @nobody/i);
    const button = screen.getByRole('button', { name: /capture/i });
    expect(button).toBeDisabled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('offers a candidate chooser for an ambiguous person token', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: '@alice pair on the release' } });

    const diagnostics = screen.getByTestId('capture-diagnostics');
    expect(diagnostics.textContent).toMatch(/ambiguous/i);
    // Both candidate buttons are rendered.
    const aliceSmith = screen.getByRole('button', { name: 'Alice Smith' });
    expect(screen.getByRole('button', { name: 'Alice Chen' })).toBeTruthy();

    fireEvent.click(aliceSmith);
    expect((input as HTMLTextAreaElement).value).toBe('@dev-1 pair on the release');
    expect(screen.queryByTestId('capture-diagnostics')).toBeNull();
  });

  it('rejects /later combined with a date', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: '/later !fri Park this thought' } });

    expect(screen.getByTestId('capture-diagnostics').textContent).toMatch(/later/i);
    expect(screen.getByRole('button', { name: /capture/i })).toBeDisabled();
  });

  it('shows the update intent for a task update', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: 'T-9: shipped the fix' } });

    expect(screen.getByTestId('capture-summary').textContent).toContain('Update T-9');
    expect(screen.getByText('Logs a shared update on the task')).toBeTruthy();
  });

  it('shows the note intent for /note', () => {
    const { input } = renderBox('/note ');
    fireEvent.change(input, { target: { value: '/note shipped the release notes' } });

    expect(screen.getByTestId('capture-summary').textContent).toMatch(/Today.s note/);
    expect(screen.getByText(/Appends to today.s daily note/)).toBeTruthy();
  });

  it('submits the text with the client date and closes on success', () => {
    const { input, onClose } = renderBox();
    fireEvent.change(input, { target: { value: 'Ship the release @dev-1' } });
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const body = lastBody();
    expect(body.text).toBe('Ship the release @dev-1');
    expect(body.clientToday).toBe(getLocalIsoDate());
    expect(String(body.requestId)).toMatch(/^[0-9a-f-]{36}$/);

    succeed(body);
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', title: expect.stringContaining('T-5') }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('arms a confirm for past dates and retries with confirm on the second press', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: '!2020-01-01 Retro note' } });
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));

    const firstOptions = mockMutate.mock.calls.at(-1)?.[1] as {
      onSuccess: (res: CaptureResponseBody) => void;
    };
    act(() =>
      firstOptions.onSuccess({
        intent: 'create',
        blocked: false,
        confirmRequired: true,
        diagnostics: [{ severity: 'warning', code: 'past-date', message: 'Date is in the past.' }],
      } as CaptureResponseBody),
    );

    // Second press sends confirm: true.
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(lastBody().confirm).toBe(true);
  });

  it('shows server diagnostics when the server blocks', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: 'T-999: hello' } });
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));

    const options = mockMutate.mock.calls.at(-1)?.[1] as {
      onSuccess: (res: CaptureResponseBody) => void;
    };
    act(() =>
      options.onSuccess({
        intent: 'update',
        blocked: true,
        confirmRequired: false,
        diagnostics: [{ severity: 'error', code: 'unknown-task', message: 'Task T-999 was not found.' }],
      } as CaptureResponseBody),
    );

    expect(screen.getByTestId('capture-diagnostics').textContent).toContain('Task T-999 was not found');
  });

  it('prefills developer and issue context as tokens', () => {
    const { input } = renderBox('@dev-1 #PROJ-221 ');
    const value = (input as HTMLTextAreaElement).value;
    expect(value).toBe('@dev-1 #PROJ-221 ');
    // Owner resolves immediately in the preview.
    expect(screen.getByTestId('capture-summary').textContent).toContain('Alice Smith');
  });
});
