import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { QuickActionsProvider } from '@/context/QuickActionsContext';
import { ToastProvider } from '@/context/ToastContext';
import { WeeklyReviewMode } from '@/components/review/WeeklyReviewMode';
import { LOOK_BACK_STEP, type ReviewStepEntry } from '@/components/review/review-steps';
import type { WeeklyReviewResponse, WeeklyReviewSavedState, WeeklyReviewTaskRow } from '@/types';

const apiGet = vi.fn();
const apiPut = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (url: string, options?: unknown) => apiGet(url, options),
    put: (url: string, body: unknown) => apiPut(url, body),
  },
}));
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => 'scope', useAuth: () => ({ user: { accountId: 'me' } }) }));
vi.mock('@/hooks/useDevelopers', () => ({
  useDevelopers: () => ({ data: [{ accountId: 'dev-1', displayName: 'Priya Nair' }] }),
}));

function row(id: number, title: string, extra: Partial<WeeklyReviewTaskRow> = {}): WeeklyReviewTaskRow {
  return {
    id,
    taskKey: `T-${id}`,
    title,
    details: null,
    kind: 'task',
    status: 'done',
    ownerType: 'manager',
    ownerId: 'me',
    priority: 'normal',
    scheduledOn: null,
    dueAt: null,
    startsAt: null,
    endsAt: null,
    participants: null,
    outcome: null,
    createdByType: 'manager',
    createdById: 'me',
    createdAt: '2026-09-20T09:00:00.000Z',
    updatedAt: '2026-09-30T09:00:00.000Z',
    closedAt: '2026-09-30T09:00:00.000Z',
    deletedAt: null,
    links: [],
    later: false,
    trackedByManagerId: 'me',
    parentId: null,
    labels: [],
    nextAction: null,
    followUpAt: null,
    schedulePosition: null,
    signals: { overdue: false, overdueDays: null, overdueSource: null, stale: false, staleDays: null, drift: false, followUpDue: false },
    closedDay: '2026-09-30',
    ...extra,
  } as WeeklyReviewTaskRow;
}

function makeReview(overrides: Partial<WeeklyReviewResponse> = {}, closed: WeeklyReviewTaskRow[] = defaultClosed()): WeeklyReviewResponse {
  return {
    today: '2026-10-02',
    timeZone: 'UTC',
    range: { start: '2026-09-28', end: '2026-10-04', nextStart: '2026-10-05', nextEnd: '2026-10-11' },
    defaultedToLastWeek: false,
    nextWorkday: '2026-10-05',
    teamMode: 'solo',
    rosterSize: 2,
    oneOnOneEnabled: false,
    sections: [
      { id: 'closed', status: 'ready', rows: closed },
      { id: 'slipped', status: 'ready', rows: [row(9, 'Slipped one', { status: 'open', closedAt: null })] },
    ],
    nextWorkdayTop3: [],
    saved: null,
    ...overrides,
  };
}

function defaultClosed(): WeeklyReviewTaskRow[] {
  return [
    row(1, 'Ship the retry flow', { closedDay: '2026-09-30' }),
    row(2, 'Retire the old wiki', { status: 'dropped', closedDay: '2026-09-29' }),
    row(3, 'Weekly staff sync', { kind: 'meeting', closedDay: '2026-09-29' }),
    row(4, 'Fix flaky e2e suite', { ownerType: 'developer', ownerId: 'dev-1', closedDay: '2026-09-30' }),
  ];
}

function saved(overrides: Partial<WeeklyReviewSavedState> = {}): WeeklyReviewSavedState {
  return { weekStart: '2026-09-28', step: 'look_back', decisions: {}, excluded: [], reportMarkdown: null, startedAt: 'x', completedAt: null, dismissedAt: null, updatedAt: 'x', ...overrides };
}

function stubStep(id: ReviewStepEntry['id'], label: string, withInput = false): ReviewStepEntry {
  return {
    id,
    label,
    heading: `${label} heading`,
    summary: () => '',
    count: () => null,
    keys: [],
    Component: () => (withInput ? <input aria-label="Note" /> : <p>{label} body</p>),
  };
}

const steps = [LOOK_BACK_STEP, stubStep('waiting', 'Waiting', true), stubStep('send', 'Send update')];
const onExit = vi.fn();
const onWeekChange = vi.fn();
const openTask = vi.fn();

function renderMode(props: { week?: string; steps?: ReviewStepEntry[] } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <QuickActionsProvider value={{ openCapture: vi.fn(), openCommandPalette: vi.fn(), openTask }}>{children}</QuickActionsProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
  return render(<WeeklyReviewMode week={props.week} steps={props.steps ?? steps} onExit={onExit} onWeekChange={onWeekChange} />, { wrapper });
}

const lastPutBody = () => apiPut.mock.calls.at(-1)?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockReset();
  apiPut.mockReset();
  apiGet.mockResolvedValue(makeReview());
  apiPut.mockResolvedValue({ saved: saved() });
});

describe('WeeklyReviewMode (docs/59 §5)', () => {
  it('draws the header and rail at once, then the closed tasks with sensible defaults', async () => {
    renderMode();
    expect(screen.getByRole('heading', { level: 1, name: /Weekly review/ })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Review steps' })).toBeInTheDocument();
    expect(screen.getByLabelText('Loading your week')).toBeInTheDocument();

    expect(await screen.findByRole('heading', { level: 2, name: 'What closed this week' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('28 Sep – 2 Oct');
    expect(screen.getByText('3 done · 1 dropped · 1 slipped')).toBeInTheDocument();
    // Done work is in the update; dropped work and meetings are not.
    expect(screen.getByRole('checkbox', { name: 'Ship the retry flow' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Fix flaky e2e suite' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Retire the old wiki' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Weekly staff sync' })).not.toBeChecked();
    // Delegated rows name the person.
    expect(screen.getByText('Closed Wed · Priya')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Mine/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Delegated/ })).toBeInTheDocument();
    // Progress is a real progressbar, and the rail is an ordered list with the current step marked.
    expect(screen.getAllByRole('progressbar', { name: 'Review progress' })[0]).toHaveAttribute('aria-valuenow', '1');
    expect(within(screen.getByRole('navigation', { name: 'Review steps' })).getByRole('button', { name: /Look back/ })).toHaveAttribute('aria-current', 'step');
  });

  it('moves focus to the step heading, and steps with ] [ and the digits', async () => {
    renderMode();
    const first = await screen.findByRole('heading', { level: 2, name: 'What closed this week' });
    await waitFor(() => expect(first).toHaveFocus());

    fireEvent.keyDown(document.body, { key: ']' });
    const waiting = await screen.findByRole('heading', { level: 2, name: 'Waiting heading' });
    await waitFor(() => expect(waiting).toHaveFocus());
    expect(screen.getAllByRole('progressbar')[0]).toHaveAttribute('aria-valuenow', '2');

    fireEvent.keyDown(document.body, { key: '3' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Send update heading' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: ']' }); // no step after the last
    expect(screen.getByRole('heading', { level: 2, name: 'Send update heading' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: '9' }); // no such step
    expect(screen.getByRole('heading', { level: 2, name: 'Send update heading' })).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: '[' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Waiting heading' })).toBeInTheDocument();
    // Leaving a step marks it done in the rail, and the step is saved.
    const rail = screen.getByRole('navigation', { name: 'Review steps' });
    expect(within(rail).getByRole('button', { name: /Look back, done/ })).toBeInTheDocument();
    await waitFor(() => expect(lastPutBody()).toEqual({ step: 'waiting' }));
    expect(apiPut.mock.calls.at(-1)?.[0]).toBe('/review/week/2026-09-28');
  });

  it('opens a step from the rail and from the footer buttons named after the neighbours', async () => {
    renderMode();
    await screen.findByRole('heading', { level: 2, name: 'What closed this week' });
    expect(screen.queryByRole('button', { name: /^Look back$/ })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Review steps' })).getByRole('button', { name: /Waiting/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Waiting heading' })).toBeInTheDocument();
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('button', { name: /Look back/ })).toBeInTheDocument();
    fireEvent.click(within(footer).getByRole('button', { name: /Send update/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Send update heading' })).toBeInTheDocument();
  });

  it('resumes from the saved step', async () => {
    apiGet.mockResolvedValue(makeReview({ saved: saved({ step: 'waiting' }) }));
    renderMode();
    expect(await screen.findByRole('heading', { level: 2, name: 'Waiting heading' })).toBeInTheDocument();
    const rail = screen.getByRole('navigation', { name: 'Review steps' });
    expect(within(rail).getByRole('button', { name: /Look back, done/ })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: /Waiting/ })).toHaveAttribute('aria-current', 'step');
  });

  it('saves a tick as an exclusion, and a default-out line ticked in as an inclusion (debounced into one write)', async () => {
    renderMode();
    await screen.findByRole('heading', { level: 2, name: 'What closed this week' });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Ship the retry flow' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Retire the old wiki' }));
    expect(screen.getByRole('checkbox', { name: 'Ship the retry flow' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Retire the old wiki' })).toBeChecked();
    expect(apiPut).not.toHaveBeenCalled();
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(lastPutBody()).toEqual({ excluded: ['T-1', '+T-2'] });
    // Ticking back to the default clears the entry.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ship the retry flow' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(2));
    expect(lastPutBody()).toEqual({ excluded: ['+T-2'] });
  });

  it('x toggles the focused row without moving focus, j/k move, o opens the task', async () => {
    renderMode();
    await screen.findByRole('heading', { level: 2, name: 'What closed this week' });
    fireEvent.keyDown(document.body, { key: 'j' });
    const rowOne = document.querySelector<HTMLElement>('[data-review-row="T-1"]')!;
    expect(rowOne).toHaveFocus();
    fireEvent.keyDown(rowOne, { key: 'x' });
    expect(screen.getByRole('checkbox', { name: 'Ship the retry flow' })).not.toBeChecked();
    expect(rowOne).toHaveFocus();
    fireEvent.keyDown(rowOne, { key: 'j' });
    expect(document.querySelector('[data-review-row="T-2"]')).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'k' });
    expect(rowOne).toHaveFocus();
    fireEvent.keyDown(rowOne, { key: 'o' });
    expect(openTask).toHaveBeenCalledWith('T-1');
    expect(screen.getByText('Left out of the update.')).toBeInTheDocument();
  });

  it('adds or leaves out a whole group at once', async () => {
    renderMode();
    await screen.findByRole('heading', { level: 2, name: 'What closed this week' });
    const mine = screen.getByRole('group', { name: /Mine/ });
    expect(within(mine).getByText('1 in update')).toBeInTheDocument();
    fireEvent.click(within(mine).getByRole('button', { name: 'Add all' }));
    expect(within(mine).getByText('3 in update')).toBeInTheDocument();
    await waitFor(() => expect(lastPutBody()).toEqual({ excluded: ['+T-2', '+T-3'] }));
    fireEvent.click(within(mine).getByRole('button', { name: 'Leave all out' }));
    await waitFor(() => expect(lastPutBody()).toEqual({ excluded: ['T-1'] }));
  });

  it('ignores the keymap while typing in a field', async () => {
    apiGet.mockResolvedValue(makeReview({ saved: saved({ step: 'waiting' }) }));
    renderMode();
    const input = await screen.findByRole('textbox', { name: 'Note' });
    input.focus();
    fireEvent.keyDown(input, { key: ']' });
    fireEvent.keyDown(input, { key: '1' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByRole('heading', { level: 2, name: 'Waiting heading' })).toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('exits on Escape after writing what is waiting', async () => {
    renderMode();
    await screen.findByRole('heading', { level: 2, name: 'What closed this week' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ship the retry flow' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(apiPut).toHaveBeenCalledTimes(1);
    expect(lastPutBody()).toEqual({ excluded: ['T-1'] });
  });

  it('opens the shortcut sheet with ? and Escape closes only the sheet', async () => {
    renderMode();
    await screen.findByRole('heading', { level: 2, name: 'What closed this week' });
    fireEvent.keyDown(document.body, { key: '?' });
    const sheet = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(sheet).getByText('Next / previous row')).toBeInTheDocument();
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument());
    expect(onExit).not.toHaveBeenCalled();
  });

  it('shows an error with Retry and Back to Today, then loads on Retry', async () => {
    apiGet.mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce(new Error('boom'));
    renderMode();
    expect(await screen.findByText("Couldn't load your week", {}, { timeout: 3000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Today' }));
    expect(onExit).toHaveBeenCalled();
    apiGet.mockResolvedValue(makeReview());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'What closed this week' })).toBeInTheDocument();
  });

  it('shows a failed source as an inline note with Retry while the rest works', async () => {
    apiGet.mockResolvedValueOnce(makeReview({ sections: [{ id: 'closed', status: 'unavailable', rows: [] }] }));
    renderMode();
    const note = (await screen.findByText(/Couldn't load this week's closed tasks/)).closest('p')!;
    apiGet.mockResolvedValueOnce(makeReview());
    fireEvent.click(within(note).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('checkbox', { name: 'Ship the retry flow' })).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state when nothing closed, and offers the switch back to this week from another one', async () => {
    apiGet.mockResolvedValue(makeReview({ today: '2026-10-20' }, []));
    renderMode({ week: '2026-09-28' });
    expect(await screen.findByText('Nothing closed this week')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to this week' }));
    expect(onWeekChange).toHaveBeenCalledWith('2026-10-19');
    expect(apiGet.mock.calls[0]?.[0]).toContain('week=2026-09-28');
  });

  it('labels a review that opened on last week', async () => {
    apiGet.mockResolvedValue(makeReview({ today: '2026-10-05', defaultedToLastWeek: true }));
    renderMode();
    await screen.findByRole('heading', { level: 2, name: 'What closed this week' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Last week');
  });
});
