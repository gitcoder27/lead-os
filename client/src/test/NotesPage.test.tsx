import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotesPage } from '@/components/notes/NotesPage';
import type { DailyNoteFollowUp, DailyNoteSummary } from '@/types';

const mockAddToast = vi.fn();
const mockFollowUpMutate = vi.fn();
const editorDatesSeen = vi.hoisted(() => [] as string[]);

const savedNote = {
  id: 7,
  date: '2026-09-12',
  title: 'Saved note',
  excerpt: '',
  body: 'existing saved note text',
  revision: 1,
  createdAt: '2026-09-12T09:00:00.000Z',
  updatedAt: '2026-09-12T09:00:00.000Z',
};

const editorState = {
  body: 'existing saved note text',
  changeBody: vi.fn(),
  saveState: 'idle' as string,
  error: null as string | null,
  latest: null as typeof savedNote | null,
  conflict: null as { body: string } | null,
  followUps: [] as DailyNoteFollowUp[],
  loading: false,
  loadError: null as Error | null,
  retryLoad: vi.fn(),
  flush: vi.fn(async () => true),
  keepBoth: vi.fn(),
  useSavedVersion: vi.fn(),
  retrySave: vi.fn(),
  recoveryUnavailable: false,
};

let listNotes: DailyNoteSummary[] = [];
let listLoading = false;
let listError = false;

vi.mock('@/hooks/useDailyNoteEditor', async () => {
  const react = await import('react');
  return {
    DAILY_NOTE_MAX_LENGTH: 50000,
    useDailyNoteEditor: (date: string) => {
      react.useEffect(() => {
        editorDatesSeen.push(date);
      }, [date]);
      return editorState;
    },
  };
});

vi.mock('@/hooks/useDailyNotes', () => ({
  useDailyNotes: () => ({
    data: { pages: [{ notes: listNotes, nextCursor: null }], pageParams: [null] },
    isLoading: listLoading,
    isError: listError,
    refetch: vi.fn(),
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  }),
  useCreateDailyNoteFollowUp: () => ({ mutate: mockFollowUpMutate, isPending: false }),
  useDailyNoteSources: () => ({ data: [] }),
  useAppendDailyNote: () => ({ mutate: vi.fn(), isPending: false }),
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

let narrowViewport = false;

function stubViewport(narrow: boolean) {
  narrowViewport = narrow;
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: narrow && query.includes('767px'),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function renderPage(props: Partial<React.ComponentProps<typeof NotesPage>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NotesPage
        date="2026-09-12"
        onDateChange={vi.fn()}
        onOpenTarget={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('NotesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    editorDatesSeen.length = 0;
    editorState.body = 'existing saved note text';
    editorState.saveState = 'idle';
    editorState.latest = savedNote;
    editorState.conflict = null;
    editorState.followUps = [];
    editorState.loading = false;
    editorState.loadError = null;
    editorState.error = null;
    editorState.flush.mockResolvedValue(true);
    listNotes = [];
    listLoading = false;
    listError = false;
    stubViewport(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the document heading and sidebar history', () => {
    listNotes = [
      { id: 1, date: '2026-09-11', title: 'First line of Friday', excerpt: 'excerpt', updatedAt: '2026-09-11T10:00:00.000Z' },
    ];

    renderPage();

    expect(screen.getByRole('heading', { name: 'Saturday, September 12' })).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('A little space to clear your head.')).toBeInTheDocument();
    expect(screen.getByText('Only you')).toBeInTheDocument();
    expect(screen.getByLabelText('Search all notes')).toBeInTheDocument();
    expect(screen.getByText('Fri, Sep 11')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Thoughts, observations, things to come back to…')).toBeInTheDocument();
  });

  it('waits for a pending save before switching days', async () => {
    const onDateChange = vi.fn();
    renderPage({ onDateChange });

    fireEvent.click(screen.getByLabelText('Previous day'));

    await waitFor(() => expect(onDateChange).toHaveBeenCalledWith('2026-09-11'));
    expect(editorState.flush).toHaveBeenCalled();
  });

  it('keeps the current editor when the flush fails', async () => {
    editorState.flush.mockResolvedValue(false);
    const onDateChange = vi.fn();
    renderPage({ onDateChange });

    fireEvent.click(screen.getByLabelText('Previous day'));

    await waitFor(() => expect(mockAddToast).toHaveBeenCalled());
    expect(onDateChange).not.toHaveBeenCalled();
  });

  it('selects a history row and the Today shortcut', async () => {
    listNotes = [
      { id: 1, date: '2026-09-10', title: 'Thursday notes', excerpt: 'excerpt', updatedAt: '2026-09-10T10:00:00.000Z' },
    ];
    const onDateChange = vi.fn();
    renderPage({ onDateChange });

    fireEvent.click(screen.getByText('Thursday notes'));
    await waitFor(() => expect(onDateChange).toHaveBeenCalledWith('2026-09-10'));
  });

  it('navigates via the date picker', async () => {
    const onDateChange = vi.fn();
    renderPage({ onDateChange });

    fireEvent.change(screen.getByLabelText('Pick a date'), { target: { value: '2026-09-01' } });

    await waitFor(() => expect(onDateChange).toHaveBeenCalledWith('2026-09-01'));
  });

  it('remounts the editor per scope and date without flashing old text', () => {
    editorState.body = 'day A text';
    const { rerender } = renderPage({ date: '2026-09-12' });
    expect(editorDatesSeen).toContain('2026-09-12');

    editorState.body = 'day B text';
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NotesPage date="2026-09-13" onDateChange={vi.fn()} onOpenTarget={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(editorDatesSeen).toContain('2026-09-13');
    expect(screen.getByLabelText(/Notes for Sunday/)).toHaveValue('day B text');
    expect(screen.queryByDisplayValue('day A text')).not.toBeInTheDocument();
  });

  it('shows the mobile history flow', async () => {
    stubViewport(true);
    renderPage();

    expect(screen.getByLabelText('Open note history')).toBeInTheDocument();
    expect(screen.getByText('Notes · Only you')).toBeInTheDocument();
    expect(screen.queryByLabelText('Note history')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Open note history'));
    expect(screen.getByLabelText('Note history')).toBeInTheDocument();
    expect(screen.getByLabelText('Back to note')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Back to note'));
    expect(screen.queryByLabelText('Note history')).not.toBeInTheDocument();
  });

  it('keeps the editor mounted while mobile history is open', () => {
    stubViewport(true);
    renderPage();

    const documentEl = document.querySelector('.notes-document') as HTMLElement;
    expect(documentEl.hidden).toBe(false);

    fireEvent.click(screen.getByLabelText('Open note history'));
    expect(document.querySelector('.notes-document')).not.toBeNull();
    expect((document.querySelector('.notes-document') as HTMLElement).hidden).toBe(true);

    fireEvent.click(screen.getByLabelText('Back to note'));
    expect((document.querySelector('.notes-document') as HTMLElement).hidden).toBe(false);
    expect(editorDatesSeen.filter((value) => value === '2026-09-12')).toHaveLength(1);
  });

  it('mobile history selection flushes the still-mounted editor before switching days', async () => {
    stubViewport(true);
    listNotes = [
      { id: 1, date: '2026-09-10', title: 'Thursday notes', excerpt: 'excerpt', updatedAt: '2026-09-10T10:00:00.000Z' },
    ];
    const onDateChange = vi.fn();
    renderPage({ onDateChange });

    fireEvent.click(screen.getByLabelText('Open note history'));
    fireEvent.click(screen.getByText('Thursday notes'));

    await waitFor(() => expect(onDateChange).toHaveBeenCalledWith('2026-09-10'));
    expect(editorState.flush).toHaveBeenCalled();
  });

  it('returns to the same editor draft when a mobile day switch fails to save', async () => {
    stubViewport(true);
    editorState.flush.mockResolvedValue(false);
    listNotes = [
      { id: 1, date: '2026-09-10', title: 'Thursday notes', excerpt: 'excerpt', updatedAt: '2026-09-10T10:00:00.000Z' },
    ];
    const onDateChange = vi.fn();
    renderPage({ onDateChange });

    fireEvent.click(screen.getByLabelText('Open note history'));
    fireEvent.click(screen.getByText('Thursday notes'));

    await waitFor(() => expect(mockAddToast).toHaveBeenCalled());
    expect(onDateChange).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Note history')).not.toBeInTheDocument();
    expect((document.querySelector('.notes-document') as HTMLElement).hidden).toBe(false);
    expect(screen.getByLabelText(/Notes for/)).toHaveValue('existing saved note text');
  });

  it('opens follow-ups as exact desk items', async () => {
    editorState.followUps = [
      { itemId: 55, date: '2026-09-12', title: 'Call back vendor', status: 'planned', followUpAt: '2026-09-13T13:00:00.000Z' },
    ];
    const onOpenTarget = vi.fn();
    renderPage({ onOpenTarget });

    expect(screen.getByText('Call back vendor')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Open follow-up'));

    expect(onOpenTarget).toHaveBeenCalledWith({
      type: 'manager_desk_item',
      view: 'desk',
      managerDeskItemId: 55,
      date: '2026-09-12',
    });
  });

  it('opens the follow-up dialog only after a successful flush', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /create follow-up/i }));
    await screen.findByRole('dialog');
    expect(screen.getByText(/sourced from your Sat, Sep 12 note/)).toBeInTheDocument();
  });

  it('creates a follow-up for the current action date sourced from the note date', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /create follow-up/i }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Chase the API review' } });
    const dueInput = screen.getByLabelText('Follow up on');
    fireEvent.change(dueInput, { target: { value: '2026-09-15T09:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Create follow-up$/ }));

    expect(mockFollowUpMutate).toHaveBeenCalledTimes(1);
    const payload = mockFollowUpMutate.mock.calls[0][0];
    expect(payload.title).toBe('Chase the API review');
    expect(payload.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload.date).toBe(new Date().toLocaleDateString('en-CA'));
    expect(payload.followUpAt).toBe(new Date('2026-09-15T09:00').toISOString());
    expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects an invalid follow-up due date', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /create follow-up/i }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Something' } });
    fireEvent.change(screen.getByLabelText('Follow up on'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Create follow-up$/ }));

    expect(mockFollowUpMutate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Choose when to follow up.');
  });

  it('prefills the follow-up title from the selected text only', async () => {
    renderPage();

    const textarea = screen.getByLabelText(/Notes for/) as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 8);
    fireEvent.select(textarea);

    fireEvent.click(screen.getByRole('button', { name: /create follow-up/i }));
    await screen.findByRole('dialog');

    expect(screen.getByLabelText('Title')).toHaveValue('existing');
  });

  it('does not open the follow-up dialog when the flush fails', async () => {
    editorState.flush.mockResolvedValue(false);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /create follow-up/i }));

    await waitFor(() => expect(editorState.flush).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('disables follow-up creation on a blank new note and during conflicts', () => {
    editorState.body = '   ';
    editorState.latest = null;
    renderPage();
    expect(screen.getByRole('button', { name: /create follow-up/i })).toBeDisabled();
  });

  it('disables follow-up creation while a conflict is unresolved', () => {
    editorState.saveState = 'conflict';
    editorState.conflict = { body: 'remote version' };
    renderPage();

    expect(screen.getByRole('button', { name: /create follow-up/i })).toBeDisabled();
    expect(screen.getByText('This note changed elsewhere')).toBeInTheDocument();
    expect(screen.getByText(/Your draft is still in the editor/)).toBeInTheDocument();
  });

  it('reuses the same request identity across a midnight retry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date('2026-09-12T23:55:00'));
      renderPage();

      fireEvent.click(screen.getByRole('button', { name: /create follow-up/i }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Ping them' } });
      fireEvent.change(screen.getByLabelText('Follow up on'), { target: { value: '2026-09-15T09:00' } });
      fireEvent.click(within(dialog).getByRole('button', { name: /^Create follow-up$/ }));

      expect(mockFollowUpMutate).toHaveBeenCalledTimes(1);
      const first = mockFollowUpMutate.mock.calls[0][0];
      expect(first.date).toBe('2026-09-12');
      act(() => {
        mockFollowUpMutate.mock.calls[0][1].onError(new Error('offline'));
      });

      vi.setSystemTime(new Date('2026-09-13T00:10:00'));
      fireEvent.click(within(dialog).getByRole('button', { name: /^Create follow-up$/ }));

      expect(mockFollowUpMutate).toHaveBeenCalledTimes(2);
      const second = mockFollowUpMutate.mock.calls[1][0];
      expect(second.requestId).toBe(first.requestId);
      expect(second.date).toBe('2026-09-12');
      expect(second.followUpAt).toBe(first.followUpAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the selected day fixed when the clock crosses midnight', () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      vi.setSystemTime(new Date('2026-09-12T23:59:00'));
      renderPage();

      expect(screen.getByRole('heading', { name: 'Saturday, September 12' })).toBeInTheDocument();

      act(() => {
        vi.setSystemTime(new Date('2026-09-13T00:05:00'));
        vi.advanceTimersByTime(61_000);
      });

      expect(screen.getByRole('heading', { name: 'Saturday, September 12' })).toBeInTheDocument();
      expect(screen.getByText('Sun, Sep 13')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
