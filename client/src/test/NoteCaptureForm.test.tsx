import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteCaptureForm } from '@/components/capture/NoteCaptureForm';
import {
  readDailyNoteCaptureDraft,
  writeDailyNoteCaptureDraft,
} from '@/lib/daily-note-drafts';
import { TestWrapper } from './wrapper';

const mockAppendMutate = vi.fn();
const mockAddToast = vi.fn();
let appendPending = false;

vi.mock('@/hooks/useDailyNotes', () => ({
  useAppendDailyNote: () => ({ mutate: mockAppendMutate, isPending: appendPending }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuthScopeKey: () => 'ws-1:manager-a:manager:',
  useAuth: () => ({
    user: { username: 'manager-a', accountId: 'manager-a', workspaceId: 'ws-1', role: 'manager' },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

const SCOPE = 'ws-1:manager-a:manager:';

function renderForm(props: Partial<React.ComponentProps<typeof NoteCaptureForm>> = {}) {
  return render(
    <TestWrapper>
      <NoteCaptureForm
        date="2026-04-28"
        formattedDate="Tuesday, Apr 28"
        onClose={vi.fn()}
        onOpenNotes={vi.fn()}
        {...props}
      />
    </TestWrapper>,
  );
}

describe('NoteCaptureForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appendPending = false;
    window.sessionStorage.clear();
  });

  it('appends to the daily note with a stable request id', () => {
    renderForm();

    fireEvent.change(screen.getByLabelText('Quick note'), { target: { value: 'remember the deploy freeze' } });
    fireEvent.click(screen.getByRole('button', { name: /add to note/i }));

    expect(mockAppendMutate).toHaveBeenCalledTimes(1);
    const [variables] = mockAppendMutate.mock.calls[0];
    expect(variables.date).toBe('2026-04-28');
    expect(variables.text).toBe('remember the deploy freeze');
    expect(variables.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reuses the same request id across remounts for unchanged text', () => {
    const first = renderForm();
    fireEvent.change(screen.getByLabelText('Quick note'), { target: { value: 'persist me' } });
    fireEvent.click(screen.getByRole('button', { name: /add to note/i }));
    const firstRequestId = mockAppendMutate.mock.calls[0][0].requestId;
    first.unmount();

    mockAppendMutate.mockClear();
    renderForm();

    expect(screen.getByLabelText('Quick note')).toHaveValue('persist me');
    fireEvent.click(screen.getByRole('button', { name: /add to note/i }));
    expect(mockAppendMutate.mock.calls[0][0].requestId).toBe(firstRequestId);
  });

  it('gets a new request id when the content changes', () => {
    renderForm();
    const input = screen.getByLabelText('Quick note');

    fireEvent.change(input, { target: { value: 'first version' } });
    fireEvent.click(screen.getByRole('button', { name: /add to note/i }));
    const firstId = mockAppendMutate.mock.calls[0][0].requestId;
    act(() => {
      mockAppendMutate.mock.calls[0][1].onError(new Error('offline'));
    });

    fireEvent.change(input, { target: { value: 'first version plus edits' } });
    fireEvent.click(screen.getByRole('button', { name: /add to note/i }));
    const secondId = mockAppendMutate.mock.calls[1][0].requestId;

    expect(secondId).not.toBe(firstId);
  });

  it('locks editing while an append is pending and sends exactly one request', () => {
    renderForm();
    const input = screen.getByLabelText('Quick note');

    fireEvent.change(input, { target: { value: 'single send' } });
    fireEvent.click(screen.getByRole('button', { name: /add to note/i }));
    fireEvent.click(screen.getByRole('button', { name: /adding/i }));

    expect(mockAppendMutate).toHaveBeenCalledTimes(1);
    expect(input).toBeDisabled();

    act(() => {
      mockAppendMutate.mock.calls[0][1].onError(new Error('offline'));
    });
    expect(screen.getByLabelText('Quick note')).not.toBeDisabled();
    expect(screen.getByLabelText('Quick note')).toHaveValue('single send');
  });

  it('ignores malformed stored drafts instead of retrying a bad request id', () => {
    window.sessionStorage.setItem(
      `lead-os:daily-note-draft:${encodeURIComponent(SCOPE)}:quick-capture`,
      JSON.stringify({ date: 'not-a-date', text: 'stale', requestId: 'not-a-uuid' }),
    );
    renderForm();
    expect(screen.getByLabelText('Quick note')).toHaveValue('');

    window.sessionStorage.setItem(
      `lead-os:daily-note-draft:${encodeURIComponent(SCOPE)}:quick-capture`,
      JSON.stringify({ date: '2026-04-28', text: 'stale', requestId: 'also-bad' }),
    );
    renderForm();
    expect(screen.getByLabelText('Quick note')).toHaveValue('');
  });

  it('warns when draft persistence is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    try {
      renderForm();
      fireEvent.change(screen.getByLabelText('Quick note'), { target: { value: 'ephemeral' } });
      expect(screen.getByText(/Draft recovery unavailable/)).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps a newer draft when an older append resolves late', () => {
    const onClose = vi.fn();
    renderForm({ onClose });

    fireEvent.change(screen.getByLabelText('Quick note'), { target: { value: 'first send' } });
    fireEvent.click(screen.getByRole('button', { name: /add to note/i }));
    const [variables, options] = mockAppendMutate.mock.calls[0];

    writeDailyNoteCaptureDraft(SCOPE, {
      date: '2026-04-28',
      text: 'brand new text',
      requestId: '22222222-2222-4222-8222-222222222222',
    });

    options.onSuccess({ note: null, followUps: [] }, variables);

    expect(onClose).toHaveBeenCalled();
    expect(readDailyNoteCaptureDraft(SCOPE)?.text).toBe('brand new text');
  });

  it('keeps the text on screen and in the draft after a failed append', () => {
    const onClose = vi.fn();
    renderForm({ onClose });

    fireEvent.change(screen.getByLabelText('Quick note'), { target: { value: 'do not lose this' } });
    fireEvent.click(screen.getByRole('button', { name: /add to note/i }));

    const [, options] = mockAppendMutate.mock.calls[0];
    options.onError(new Error('offline'));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Quick note')).toHaveValue('do not lose this');
    expect(readDailyNoteCaptureDraft(SCOPE)?.text).toBe('do not lose this');
  });

  it('clears the draft and closes on success', () => {
    const onClose = vi.fn();
    renderForm({ onClose });

    fireEvent.change(screen.getByLabelText('Quick note'), { target: { value: 'ship it' } });
    fireEvent.click(screen.getByRole('button', { name: /add to note/i }));

    const [, options] = mockAppendMutate.mock.calls[0];
    options.onSuccess({ note: null, followUps: [] }, mockAppendMutate.mock.calls[0][0]);

    expect(onClose).toHaveBeenCalled();
    expect(readDailyNoteCaptureDraft(SCOPE)).toBeNull();
    expect(mockAddToast).toHaveBeenCalledWith('Added to your note', 'success');
  });

  it('shows the privacy caption and Open Notes action', () => {
    const onClose = vi.fn();
    const onOpenNotes = vi.fn();
    renderForm({ onClose, onOpenNotes });

    expect(screen.getByText('Added to your private daily note')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Open Notes'));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenNotes).toHaveBeenCalledWith('2026-04-28');
  });

  it('opens the restored draft date when Open Notes is clicked', () => {
    writeDailyNoteCaptureDraft(SCOPE, {
      date: '2026-04-20',
      text: 'older day draft',
      requestId: '33333333-3333-4333-8333-333333333333',
    });
    const onOpenNotes = vi.fn();
    renderForm({ onOpenNotes });

    expect(screen.getByLabelText('Quick note')).toHaveValue('older day draft');
    fireEvent.click(screen.getByText('Open Notes'));
    expect(onOpenNotes).toHaveBeenCalledWith('2026-04-20');
  });
});
