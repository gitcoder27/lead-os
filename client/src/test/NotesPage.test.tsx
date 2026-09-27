import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotesPage } from '@/components/notes/NotesPage';
import type { DailyNoteDayContext, DailyNoteRef, DailyNoteSummary } from '@/types';

const mockAddToast = vi.fn();
const mockFollowUpMutate = vi.fn();
const mockFollowUpMutateAsync = vi.fn();
const mockTaskUpdateMutate = vi.fn();
const mockTaskCreateMutate = vi.fn();
const mockTaskCreateMutateAsync = vi.fn();
const mockAppendMutateAsync = vi.fn();
const editorDatesSeen = vi.hoisted(() => [] as string[]);
const editorCalls = vi.hoisted(() => ({
  appendMarker: [] as Array<{ source: unknown; key: string }>,
  lineEdits: [] as unknown[],
  highlighted: [] as string[][],
}));

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
  mergeNotice: null as string | null,
  offline: false,
  latest: null as typeof savedNote | null,
  conflict: null as { body: string } | null,
  baseBody: 'existing saved note text',
  followUps: [],
  refs: [] as DailyNoteRef[],
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
let dayContext: DailyNoteDayContext | undefined;

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

// CodeMirror is covered in NoteEditor.test.tsx; the page is tested against the
// editor's imperative contract with a textarea stand-in.
vi.mock('@/components/notes/editor/NoteEditor', async () => {
  const react = await import('react');
  type Props = { value: string; onChange: (value: string) => void; ariaLabel: string };
  const NoteEditor = react.forwardRef<unknown, Props>(function NoteEditorStub({ value, onChange, ariaLabel }, ref) {
    const textareaRef = react.useRef<HTMLTextAreaElement>(null);
    react.useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
      captureActionSource: () => {
        const el = textareaRef.current!;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const text =
          end > start
            ? el.value.slice(start, end)
            : el.value.slice(el.value.lastIndexOf('\n', start - 1) + 1).split('\n')[0] ?? '';
        return { text, anchorId: 1, selection: { anchor: start, head: end } };
      },
      appendMarker: (source: unknown, key: string) => editorCalls.appendMarker.push({ source, key }),
      applyLineEdits: (edits: unknown[]) => editorCalls.lineEdits.push(...edits),
      restoreSelection: () => {},
      highlightTerms: (terms: string[]) => {
        editorCalls.highlighted.push(terms);
        return true;
      },
      revealLine: () => true,
    }));
    return <textarea ref={textareaRef} aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} />;
  });
  return { NoteEditor };
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
  useDailyNoteContext: () => ({ data: dayContext }),
  useCreateDailyNoteFollowUp: () => ({ mutate: mockFollowUpMutate, mutateAsync: mockFollowUpMutateAsync, isPending: false }),
  useAddDailyNoteTaskUpdate: () => ({ mutate: mockTaskUpdateMutate, isPending: false }),
  useCreateDailyNoteTask: () => ({ mutate: mockTaskCreateMutate, mutateAsync: mockTaskCreateMutateAsync, isPending: false }),
  useDailyNoteSources: () => ({ data: [] }),
  useAppendDailyNote: () => ({ mutate: vi.fn(), mutateAsync: mockAppendMutateAsync, isPending: false }),
}));

const roster = [
  { accountId: 'dev-rohit', displayName: 'Rohit Sharma' },
  { accountId: 'dev-deepak', displayName: 'Deepak Singh' },
];

vi.mock('@/hooks/useManagerDesk', () => ({
  useManagerDeskDeveloperLookup: () => ({ data: roster, isLoading: false }),
}));

vi.mock('@/hooks/useNoteEntityLookups', () => ({
  useNoteEntityLookups: () => ({
    previewTask: vi.fn(async () => null),
    previewIssue: vi.fn(async () => null),
    searchTasks: vi.fn(async () => []),
    searchIssues: vi.fn(async () => []),
  }),
}));

vi.mock('@/components/tasks/TaskDrawer', () => ({
  TaskDrawer: ({ taskKey }: { taskKey: string | null }) => (taskKey ? <div data-testid="task-drawer">{taskKey}</div> : null),
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

function stubViewport(narrow: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: narrow && query.includes('767px'),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function wrap(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function renderPage(props: Partial<React.ComponentProps<typeof NotesPage>> = {}) {
  return render(wrap(<NotesPage date="2026-09-12" onDateChange={vi.fn()} onOpenTarget={vi.fn()} {...props} />));
}

function editorEl() {
  return screen.getByLabelText(/Notes for/) as HTMLTextAreaElement;
}

function selectInEditor(start: number, end: number) {
  const textarea = editorEl();
  textarea.setSelectionRange(start, end);
}

async function openTurnInto(label: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: /turn into/i }));
  fireEvent.click(await screen.findByRole('menuitem', { name: label }));
}

describe('NotesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    editorDatesSeen.length = 0;
    editorCalls.appendMarker.length = 0;
    editorCalls.lineEdits.length = 0;
    editorCalls.highlighted.length = 0;
    editorState.body = 'existing saved note text';
    editorState.baseBody = 'existing saved note text';
    editorState.saveState = 'idle';
    editorState.latest = savedNote;
    editorState.conflict = null;
    editorState.refs = [];
    editorState.loading = false;
    editorState.loadError = null;
    editorState.error = null;
    editorState.flush.mockResolvedValue(true);
    listNotes = [];
    listLoading = false;
    listError = false;
    dayContext = undefined;
    stubViewport(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Layout, history, navigation ──────────────────────────────────────

  it('renders a one-line heading, trimmed sidebar chrome, and the editor', () => {
    listNotes = [
      { id: 1, date: '2026-09-11', title: 'First line of Friday', excerpt: 'excerpt', updatedAt: '2026-09-11T10:00:00.000Z' },
    ];

    renderPage();

    expect(screen.getByRole('heading', { name: 'Saturday, September 12' })).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.queryByText('A little space to clear your head.')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /only you can see your notes/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Search all notes')).toBeInTheDocument();
    expect(screen.getByText('Fri, Sep 11')).toBeInTheDocument();
    expect(editorEl()).toHaveValue('existing saved note text');
    expect(screen.getByText(/^Saved · /)).toBeInTheDocument();
  });

  it('labels today in the list instead of a duplicate Today row', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date('2026-09-12T10:00:00'));
      listNotes = [{ id: 1, date: '2026-09-12', title: 'Standup notes', excerpt: '', updatedAt: '2026-09-12T10:00:00.000Z' }];
      renderPage();
      const heading = screen.getByRole('heading', { name: /Saturday, September 12/ });
      expect(within(heading).getByText('Today')).toHaveClass('notes-today-pill');
      expect(screen.getByText('Today · Sat, Sep 12')).toBeInTheDocument();
      expect(screen.queryByText('Start writing')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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

  it('selects a history row', async () => {
    listNotes = [
      { id: 1, date: '2026-09-10', title: 'Thursday notes', excerpt: 'excerpt', updatedAt: '2026-09-10T10:00:00.000Z' },
    ];
    const onDateChange = vi.fn();
    renderPage({ onDateChange });

    fireEvent.click(screen.getByText('Thursday notes'));
    await waitFor(() => expect(onDateChange).toHaveBeenCalledWith('2026-09-10'));
  });

  it('navigates via the app date popover', async () => {
    const onDateChange = vi.fn();
    renderPage({ onDateChange });

    fireEvent.click(screen.getByRole('button', { name: 'Pick a date' }));
    const popover = await screen.findByRole('dialog', { name: 'Go to day' });
    fireEvent.change(within(popover).getByLabelText('Pick a date'), { target: { value: '2026-09-01' } });
    fireEvent.click(within(popover).getByRole('button', { name: /apply go to day/i }));

    await waitFor(() => expect(onDateChange).toHaveBeenCalledWith('2026-09-01'));
  });

  it('remounts the editor per scope and date without flashing old text', () => {
    editorState.body = 'day A text';
    const { rerender } = renderPage({ date: '2026-09-12' });
    expect(editorDatesSeen).toContain('2026-09-12');

    editorState.body = 'day B text';
    rerender(wrap(<NotesPage date="2026-09-13" onDateChange={vi.fn()} onOpenTarget={vi.fn()} />));

    expect(editorDatesSeen).toContain('2026-09-13');
    expect(screen.getByLabelText(/Notes for Sunday/)).toHaveValue('day B text');
    expect(screen.queryByDisplayValue('day A text')).not.toBeInTheDocument();
  });

  it('shows the mobile history flow and keeps the editor mounted', () => {
    stubViewport(true);
    renderPage();

    expect(screen.getByLabelText('Open note history')).toBeInTheDocument();
    expect(screen.getByText('Notes · Only you')).toBeInTheDocument();
    expect(screen.queryByLabelText('Note history')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Open note history'));
    expect(screen.getByLabelText('Note history')).toBeInTheDocument();
    expect((document.querySelector('.notes-document') as HTMLElement).hidden).toBe(true);

    fireEvent.click(screen.getByLabelText('Back to note'));
    expect(screen.queryByLabelText('Note history')).not.toBeInTheDocument();
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
    expect(editorEl()).toHaveValue('existing saved note text');
  });

  it('keeps the selected day fixed when the clock crosses midnight', () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      vi.setSystemTime(new Date('2026-09-12T23:59:00'));
      renderPage();

      expect(screen.getByRole('heading', { name: /Saturday, September 12/ })).toBeInTheDocument();

      act(() => {
        vi.setSystemTime(new Date('2026-09-13T00:05:00'));
        vi.advanceTimersByTime(61_000);
      });

      expect(screen.getByRole('heading', { name: 'Saturday, September 12' })).toBeInTheDocument();
      expect(screen.getByText('Today · Sun, Sep 13')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Keyboard (F14) ──────────────────────────────────────────────────

  it('steps days with ⌥↑/⌥↓ and jumps to today with ⌥T, flushing first', async () => {
    const onDateChange = vi.fn();
    renderPage({ onDateChange });

    fireEvent.keyDown(editorEl(), { key: '∆', code: 'ArrowUp', altKey: true });
    await waitFor(() => expect(onDateChange).toHaveBeenCalledWith('2026-09-11'));
    fireEvent.keyDown(window, { key: 'ArrowDown', code: 'ArrowDown', altKey: true });
    await waitFor(() => expect(onDateChange).toHaveBeenCalledWith('2026-09-13'));
    fireEvent.keyDown(window, { key: '†', code: 'KeyT', altKey: true });
    await waitFor(() => expect(onDateChange).toHaveBeenCalledWith(new Date().toLocaleDateString('en-CA')));
    expect(editorState.flush).toHaveBeenCalledTimes(3);
  });

  it('focuses note search with ⌘⇧F', () => {
    renderPage();
    fireEvent.keyDown(editorEl(), { key: 'f', code: 'KeyF', metaKey: true, shiftKey: true });
    expect(screen.getByLabelText('Search all notes')).toHaveFocus();
  });

  it('leaves page keys alone while a modal layer is open', async () => {
    const onDateChange = vi.fn();
    renderPage({ onDateChange });
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    try {
      fireEvent.keyDown(window, { key: 'ArrowUp', code: 'ArrowUp', altKey: true });
      await Promise.resolve();
      expect(editorState.flush).not.toHaveBeenCalled();
      expect(onDateChange).not.toHaveBeenCalled();
    } finally {
      modal.remove();
    }
  });

  it('opens the shortcut legend with ? outside text fields only', () => {
    renderPage();
    fireEvent.keyDown(editorEl(), { key: '?' });
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: '?' });
    const legend = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(legend).getByText('Turn line into a task')).toBeInTheDocument();
    expect(within(legend).getByText('⌘⇧E')).toBeInTheDocument();
  });

  // ── Search (F12) ────────────────────────────────────────────────────

  it('highlights snippet matches and lands the opened note at the match', async () => {
    listNotes = [
      {
        id: 1,
        date: '2026-09-10',
        title: 'Thursday',
        excerpt: 'x',
        snippet: '…the ⟦vendor⟧ is late',
        updatedAt: '2026-09-10T10:00:00.000Z',
      },
    ];
    const onDateChange = vi.fn();
    const { rerender } = renderPage({ onDateChange });

    fireEvent.change(screen.getByLabelText('Search all notes'), { target: { value: 'vendor' } });
    expect(screen.getByText('vendor', { selector: 'mark' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Thursday'));
    await waitFor(() => expect(onDateChange).toHaveBeenCalledWith('2026-09-10'));

    rerender(wrap(<NotesPage date="2026-09-10" onDateChange={onDateChange} onOpenTarget={vi.fn()} />));
    await waitFor(() => expect(editorCalls.highlighted).toEqual([['vendor']]));
  });

  // ── From this note (F9) ─────────────────────────────────────────────

  it('groups refs as Created · Updated · Mentioned and opens them', () => {
    editorState.refs = [
      { taskKey: 'T-84', relation: 'created_from', title: 'Ship the API review', status: 'in_progress', owner: 'Rohit Sharma' },
      { taskKey: 'T-84', relation: 'mentioned', title: 'Ship the API review', status: 'in_progress' },
      { taskKey: 'T-12', relation: 'update_from', title: 'Hiring loop', status: 'planned' },
      { itemId: 55, relation: 'mentioned', title: 'Vendor call', status: 'waiting' },
    ];
    const onOpenTarget = vi.fn();
    renderPage({ onOpenTarget });

    const section = screen.getByRole('region', { name: /From this note/ });
    expect(within(section).getByText('Created')).toBeInTheDocument();
    expect(within(section).getByText('Updated')).toBeInTheDocument();
    expect(within(section).getByText('Mentioned')).toBeInTheDocument();
    // T-84 appears once, under its strongest relation.
    expect(within(section).getAllByText('Ship the API review')).toHaveLength(1);

    fireEvent.click(within(section).getByText('Ship the API review'));
    expect(screen.getByTestId('task-drawer')).toHaveTextContent('T-84');

    fireEvent.click(within(section).getByText('Vendor call'));
    expect(onOpenTarget).toHaveBeenCalledWith({ type: 'manager_desk_item', view: 'desk', managerDeskItemId: 55 });
  });

  // ── Day context (§5) ────────────────────────────────────────────────

  it('shows a collapsed day-context line that expands into linked chips', () => {
    dayContext = {
      standup: { endedAt: '2026-09-12T04:10:00.000Z', reviewed: 5, flagged: 2 },
      carriedFrom: 3,
      followUpsDue: 2,
      oneOnOnes: 1,
      oneOnOneWith: [{ accountId: 'dev-deepak', name: 'Deepak Singh' }],
    };
    const onOpenTarget = vi.fn();
    renderPage({ onOpenTarget });

    const toggle = screen.getByRole('button', {
      name: /Standup done, 2 flagged\s*3 carried in\s*2 follow-ups due\s*1:1 with Deepak/,
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);

    fireEvent.click(screen.getByRole('button', { name: '2 follow-ups due' }));
    expect(onOpenTarget).toHaveBeenCalledWith({ type: 'view', view: 'follow-ups' });
    fireEvent.click(screen.getByRole('button', { name: '1:1 with Deepak Singh' }));
    expect(onOpenTarget).toHaveBeenCalledWith({
      type: 'developer',
      view: 'team',
      developerAccountId: 'dev-deepak',
      panel: 'one-on-one',
    });
    expect(screen.getByRole('button', { name: /Standup done at .* · 5 reviewed · 2 flagged/ })).toBeInTheDocument();
    expect(editorEl().value).not.toContain('Standup');
  });

  // ── Turn into… (F8/F10/F7) ──────────────────────────────────────────

  it('opens the follow-up dialog only after a successful flush, labelled with its source', async () => {
    renderPage();

    await openTurnInto(/follow-up/i);
    await screen.findByRole('dialog', { name: 'Create follow-up' });
    expect(editorState.flush).toHaveBeenCalled();
    expect(screen.getByText('from Sat, Sep 12 note')).toBeInTheDocument();
  });

  it('creates a follow-up and marks the source line with its key', async () => {
    renderPage();

    await openTurnInto(/follow-up/i);
    const dialog = await screen.findByRole('dialog', { name: 'Create follow-up' });

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Chase the API review' } });
    fireEvent.change(screen.getByLabelText('Follow up on'), { target: { value: '2026-09-15T09:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Create follow-up$/ }));

    expect(mockFollowUpMutate).toHaveBeenCalledTimes(1);
    const payload = mockFollowUpMutate.mock.calls[0][0];
    expect(payload.title).toBe('Chase the API review');
    expect(payload.date).toBe(new Date().toLocaleDateString('en-CA'));
    expect(payload.followUpAt).toBe(new Date('2026-09-15T09:00').toISOString());
    expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/);

    act(() => mockFollowUpMutate.mock.calls[0][1].onSuccess({ itemId: 9, taskKey: 'T-77' }));
    expect(editorCalls.appendMarker).toEqual([{ source: expect.objectContaining({ anchorId: 1 }), key: 'T-77' }]);
  });

  it('rejects an invalid follow-up due date', async () => {
    renderPage();

    await openTurnInto(/follow-up/i);
    const dialog = await screen.findByRole('dialog', { name: 'Create follow-up' });

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Something' } });
    fireEvent.change(screen.getByLabelText('Follow up on'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Create follow-up$/ }));

    expect(mockFollowUpMutate).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose when to follow up.');
  });

  it('uses the first line as the follow-up title and keeps the rest in the note', async () => {
    editorState.body = '- [ ] Chase vendor → T-3\nthey owe us the contract';
    renderPage();
    selectInEditor(0, editorState.body.length);

    await openTurnInto(/follow-up/i);
    await screen.findByRole('dialog', { name: 'Create follow-up' });

    expect(screen.getByLabelText('Title')).toHaveValue('Chase vendor');
    expect(screen.getByText(/the rest stays in your note/)).toBeInTheDocument();
  });

  it('does not open a dialog when the flush fails', async () => {
    editorState.flush.mockResolvedValue(false);
    renderPage();

    await openTurnInto(/^Task/);

    await waitFor(() => expect(editorState.flush).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: 'Create task' })).not.toBeInTheDocument();
  });

  it('disables line actions with a reason on a blank new note', () => {
    editorState.body = '   ';
    editorState.latest = null;
    renderPage();
    const button = screen.getByRole('button', { name: /turn into/i });
    expect(button).toBeDisabled();
    expect(button.parentElement).toHaveAttribute('title', 'Write something first');
    expect(screen.getByText(/Type/, { selector: '.notes-teach' })).toHaveTextContent('for commands');
  });

  it('pre-picks the task mentioned on the caret line and posts the update to it', async () => {
    editorState.body = 'tell them T-12 slipped a day';
    renderPage();
    selectInEditor(3, 3);

    await openTurnInto(/update/i);
    const dialog = await screen.findByRole('dialog', { name: 'Add as task update' });

    expect(within(dialog).getByLabelText('Update text')).toHaveValue('tell them T-12 slipped a day');
    fireEvent.change(within(dialog).getByLabelText('Visibility'), { target: { value: 'shared' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Add update$/ }));

    expect(mockTaskUpdateMutate).toHaveBeenCalledTimes(1);
    expect(mockTaskUpdateMutate.mock.calls[0][0]).toMatchObject({
      taskKey: 'T-12',
      text: 'tell them T-12 slipped a day',
      type: 'update',
      visibility: 'shared',
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    act(() => mockTaskUpdateMutate.mock.calls[0][1].onSuccess());
    expect(editorCalls.appendMarker.at(-1)?.key).toBe('T-12');
  });

  it('creates a task from a selection with @person pre-picked as assignee', async () => {
    editorState.body = 'Ask @Rohit to own the rollout\nneeds a runbook first';
    renderPage();
    selectInEditor(0, editorState.body.length);

    await openTurnInto(/^Task/);
    const dialog = await screen.findByRole('dialog', { name: 'Create task' });

    expect(within(dialog).getByLabelText('Title')).toHaveValue('Ask @Rohit to own the rollout');
    expect(within(dialog).getByLabelText(/Context/)).toHaveValue('needs a runbook first');
    expect(within(dialog).getByText('Rohit Sharma')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /^Create task$/ }));
    expect(mockTaskCreateMutate.mock.calls[0][0]).toMatchObject({
      title: 'Ask @Rohit to own the rollout',
      developerAccountId: 'dev-rohit',
      context: 'needs a runbook first',
    });
    act(() => mockTaskCreateMutate.mock.calls[0][1].onSuccess({ taskKey: 'T-90' }));
    expect(editorCalls.appendMarker.at(-1)?.key).toBe('T-90');
  });

  it('reuses the same request identity across a midnight retry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date('2026-09-12T23:55:00'));
      renderPage();

      await openTurnInto(/follow-up/i);
      const dialog = await screen.findByRole('dialog', { name: 'Create follow-up' });
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Ping them' } });
      fireEvent.change(screen.getByLabelText('Follow up on'), { target: { value: '2026-09-15T09:00' } });
      fireEvent.click(within(dialog).getByRole('button', { name: /^Create follow-up$/ }));

      const first = mockFollowUpMutate.mock.calls[0][0];
      expect(first.date).toBe('2026-09-12');
      act(() => {
        mockFollowUpMutate.mock.calls[0][1].onError(new Error('offline'));
      });

      vi.setSystemTime(new Date('2026-09-13T00:10:00'));
      fireEvent.click(within(dialog).getByRole('button', { name: /^Create follow-up$/ }));

      const second = mockFollowUpMutate.mock.calls[1][0];
      expect(second.requestId).toBe(first.requestId);
      expect(second.date).toBe('2026-09-12');
      expect(second.followUpAt).toBe(first.followUpAt);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Conflict (U5) ───────────────────────────────────────────────────

  it('shows only the conflicting hunks and blocks line actions', () => {
    editorState.saveState = 'conflict';
    editorState.baseBody = 'intro\nshared line\noutro';
    editorState.body = 'intro\nmy edit\noutro';
    editorState.conflict = { body: 'intro\ntheir edit\noutro' };
    renderPage();

    expect(screen.getByText('This note changed in another tab or device')).toBeInTheDocument();
    expect(screen.getByText('my edit')).toBeInTheDocument();
    expect(screen.getByText('their edit')).toBeInTheDocument();
    expect(screen.queryByText(/^intro/, { selector: 'pre' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /turn into/i })).toBeDisabled();
    expect(screen.getByText('Needs your review')).toBeInTheDocument();
  });

  // ── Wrap-up (§5) ────────────────────────────────────────────────────

  it('wraps up the day: task, carry, and drop each land and mark their lines', async () => {
    editorState.body = ['- [ ] call vendor', '- ask @Rohit about the hiring loop', '- [ ] old idea', '- just a thought', 'prose'].join('\n');
    mockTaskCreateMutateAsync.mockResolvedValue({ taskKey: 'T-101' });
    mockAppendMutateAsync.mockResolvedValue({});
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /wrap up/i }));
    const dialog = await screen.findByRole('dialog', { name: /Wrap up Saturday/ });
    expect(within(dialog).getByText('3 open items. Decide what happens to each; anything left undecided stays in the note.')).toBeInTheDocument();

    const row = (text: string) => within(dialog).getByText(text).closest('li') as HTMLElement;
    fireEvent.click(within(row('call vendor')).getByRole('button', { name: 'Task' }));
    fireEvent.click(within(row('ask @Rohit about the hiring loop')).getByRole('button', { name: 'Carry' }));
    fireEvent.keyDown(within(row('old idea')).getByRole('button', { name: 'Task' }), { key: 'd' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply 3' }));

    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Day wrapped up'), 'success'));
    expect(mockTaskCreateMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ title: 'call vendor' }));
    const append = mockAppendMutateAsync.mock.calls[0][0];
    // A past note carries into today, never into the past.
    expect(append.date).toBe(new Date().toLocaleDateString('en-CA'));
    expect(append.text).toBe('- [ ] ask @Rohit about the hiring loop ↩ from 2026-09-12');
    expect(editorCalls.lineEdits).toEqual([
      { line: 0, raw: '- [ ] call vendor', next: '- [ ] call vendor → T-101' },
      { line: 2, raw: '- [ ] old idea', next: '- ~~old idea~~' },
      { line: 1, raw: '- ask @Rohit about the hiring loop', next: `- ask @Rohit about the hiring loop → ${append.date}` },
    ]);
  });

  it('keeps finished wrap-up items marked when a later one fails, and retries with the same request id', async () => {
    editorState.body = ['- [ ] first', '- [ ] second'].join('\n');
    mockTaskCreateMutateAsync.mockResolvedValueOnce({ taskKey: 'T-1' }).mockRejectedValueOnce(new Error('offline'));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /wrap up/i }));
    const dialog = await screen.findByRole('dialog', { name: /Wrap up/ });
    for (const button of within(dialog).getAllByRole('button', { name: 'Task' })) fireEvent.click(button);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply 2' }));

    await within(dialog).findByRole('alert');
    expect(editorCalls.lineEdits).toEqual([{ line: 0, raw: '- [ ] first', next: '- [ ] first → T-1' }]);
    expect(within(dialog).queryByText('first')).not.toBeInTheDocument();

    const failedId = mockTaskCreateMutateAsync.mock.calls[1][0].requestId;
    mockTaskCreateMutateAsync.mockResolvedValueOnce({ taskKey: 'T-2' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply 1' }));
    await waitFor(() => expect(mockTaskCreateMutateAsync).toHaveBeenCalledTimes(3));
    expect(mockTaskCreateMutateAsync.mock.calls[2][0].requestId).toBe(failedId);
  });

  it('does not offer a wrap-up for plain bullet notes', () => {
    editorState.body = ['testing new notes system', '- there is 1 point', '- 2 pointers', '1. this is num', '2. 2nd point'].join('\n');
    renderPage();
    expect(screen.queryByRole('button', { name: /wrap up/i })).not.toBeInTheDocument();
  });

  it('groups history by week and shows what each day produced', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date('2026-09-27T10:00:00'));
      listNotes = [
        { id: 1, date: '2026-09-25', title: 'Friday', excerpt: '', updatedAt: '', produced: { tasks: 2, carried: 1 } },
        { id: 2, date: '2026-09-16', title: 'Mid September', excerpt: '', updatedAt: '' },
        { id: 4, date: '2026-09-08', title: 'Early September', excerpt: '', updatedAt: '' },
        { id: 3, date: '2026-08-30', title: 'Late summer', excerpt: '', updatedAt: '' },
      ];
      renderPage({ date: '2026-09-25' });
      const history = screen.getByRole('list', { name: 'Recent notes' });
      expect(within(history).getByText('This week')).toBeInTheDocument();
      expect(within(history).getByText('Last week')).toBeInTheDocument();
      expect(within(history).getByText('September')).toBeInTheDocument();
      expect(within(history).getByText('August')).toBeInTheDocument();
      expect(within(history).getByText('2 tasks · 1 carried')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
