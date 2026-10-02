import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { QuickActionsProvider } from '@/context/QuickActionsContext';
import { ToastProvider } from '@/context/ToastContext';
import { WeeklyReviewMode } from '@/components/review/WeeklyReviewMode';
import { buildNextWeekPlan } from '@/lib/weekly-review-plan';
import type {
  WeeklyReviewOneOnOneRow,
  WeeklyReviewPin,
  WeeklyReviewResponse,
  WeeklyReviewSavedState,
  WeeklyReviewSection,
  WeeklyReviewTaskRow,
} from '@/types';

/** docs/60 WR-05: People and Next week, on a Friday so the next workday is Monday. */
const apiGet = vi.fn();
const apiPut = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const openTask = vi.fn();
const openCapture = vi.fn();
const onOpenTarget = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (url: string, options?: unknown) => apiGet(url, options),
    put: (url: string, body: unknown) => apiPut(url, body),
    post: (url: string, body: unknown) => apiPost(url, body),
    patch: (url: string, body: unknown) => apiPatch(url, body),
  },
}));
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => 'scope', useAuth: () => ({ user: { accountId: 'me' } }) }));
vi.mock('@/hooks/useDevelopers', () => ({ useDevelopers: () => ({ data: [] }) }));

const FRIDAY = '2026-10-02';
const MONDAY = '2026-10-05';

function task(id: number, title: string, extra: Partial<WeeklyReviewTaskRow> = {}): WeeklyReviewTaskRow {
  return {
    id, taskKey: `T-${id}`, title, details: null, kind: 'task', status: 'open', ownerType: 'manager', ownerId: 'me', priority: 'normal',
    scheduledOn: null, dueAt: null, startsAt: null, endsAt: null, participants: null, outcome: null, createdByType: 'manager', createdById: 'me',
    createdAt: '2026-09-01T09:00:00.000Z', updatedAt: '2026-09-25T09:00:00.000Z', closedAt: null, deletedAt: null, links: [],
    later: false, trackedByManagerId: 'me', parentId: null, labels: [], nextAction: null, followUpAt: null, schedulePosition: null,
    signals: { overdue: false, overdueDays: null, overdueSource: null, stale: false, staleDays: null, drift: false, followUpDue: false },
    ...extra,
  } as WeeklyReviewTaskRow;
}

const session = (id: number, name: string, kind: 'missed' | 'due_next_week', scheduledFor: string, status: 'scheduled' | 'skipped' = 'scheduled'): WeeklyReviewOneOnOneRow => ({
  seriesId: id + 100, sessionId: id, developerAccountId: `dev-${id}`, developerName: name, scheduledFor, kind, status,
});

function makeReview(over: Partial<WeeklyReviewResponse> & { sections?: WeeklyReviewSection[] } = {}): WeeklyReviewResponse {
  return {
    today: FRIDAY,
    timeZone: 'UTC',
    range: { start: '2026-09-28', end: '2026-10-04', nextStart: MONDAY, nextEnd: '2026-10-11' },
    defaultedToLastWeek: false,
    nextWorkday: MONDAY,
    teamMode: 'solo',
    rosterSize: 3,
    oneOnOneEnabled: true,
    sections: [
      { id: 'closed', status: 'ready', rows: [] },
      { id: 'oneOnOnes', status: 'ready', rows: [session(1, 'Sam Okafor', 'missed', '2026-09-30'), session(2, 'Priya Nair', 'due_next_week', '2026-10-06')] },
      { id: 'people', status: 'ready', rows: [{ developerAccountId: 'dev-3', developerName: 'Marcus Lee', status: 'blocked', note: 'waiting on the infra ticket', statusUpdatedAt: null }] },
    ],
    nextWorkdayTop3: [],
    saved: null,
    ...over,
  };
}

function saved(step: WeeklyReviewSavedState['step']): WeeklyReviewSavedState {
  return { weekStart: '2026-09-28', step, decisions: {}, excluded: [], reportMarkdown: null, startedAt: 'x', completedAt: null, dismissedAt: null, updatedAt: 'x' };
}

function renderReview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <QuickActionsProvider value={{ openCapture, openCommandPalette: vi.fn(), openTask }}>{children}</QuickActionsProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
  return render(<WeeklyReviewMode onExit={vi.fn()} onWeekChange={vi.fn()} onOpenTarget={onOpenTarget} />, { wrapper });
}

async function openStep(step: WeeklyReviewSavedState['step'], review: WeeklyReviewResponse, heading: string) {
  apiGet.mockResolvedValue({ ...review, saved: saved(step) });
  renderReview();
  await screen.findByRole('heading', { level: 2, name: heading });
}

const rail = () => screen.getByRole('navigation', { name: 'Review steps' });
const announcement = () => document.querySelector('[data-testid="weekly-review"] [aria-live="polite"]')!.textContent;
const rowEl = (key: string) => document.querySelector<HTMLElement>(`[data-review-row="${key}"]`)!;

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [apiGet, apiPut, apiPost, apiPatch]) fn.mockReset();
  apiPut.mockResolvedValue({});
  apiPost.mockResolvedValue({ tasks: [] });
  apiPatch.mockResolvedValue({});
});

describe('People step (docs/59 §5.3 step 4)', () => {
  it('shows 1:1s missed and due, and people marked blocked or at risk, with counts', async () => {
    await openStep('people', makeReview(), 'People');
    expect(screen.getByText('3 need you')).toBeInTheDocument();
    const missed = screen.getByRole('group', { name: /Missed this week/ });
    expect(within(missed).getByText('Sam Okafor')).toBeInTheDocument();
    expect(within(missed).getByText('Was Wed 30 Sep')).toBeInTheDocument();
    expect(within(missed).getByText('Missed')).toBeInTheDocument();
    const due = screen.getByRole('group', { name: /Due next week/ });
    expect(within(due).getByText('1:1 Tue 6 Oct')).toBeInTheDocument();
    const status = screen.getByRole('group', { name: /Status/ });
    expect(within(status).getByText('Blocked')).toBeInTheDocument();
    expect(within(status).getByText('waiting on the infra ticket')).toBeInTheDocument();
    expect(within(rail()).getByRole('button', { name: /People, 3/ })).toBeInTheDocument();
  });

  it('opens the 1:1 workspace or the person on the Team page', async () => {
    await openStep('people', makeReview(), 'People');
    fireEvent.click(within(rowEl('oo-2')).getByRole('button', { name: 'Open 1:1' }));
    expect(onOpenTarget).toHaveBeenCalledWith({ type: 'view', view: 'team', developerAccountId: 'dev-2', panel: 'one-on-one' });
    fireEvent.click(within(rowEl('st-dev-3')).getByRole('button', { name: 'Open' }));
    expect(onOpenTarget).toHaveBeenLastCalledWith({ type: 'view', view: 'team', developerAccountId: 'dev-3' });
    // o opens the focused row's primary target.
    fireEvent.keyDown(document.body, { key: 'j' });
    fireEvent.keyDown(document.activeElement!, { key: 'o' });
    expect(onOpenTarget).toHaveBeenLastCalledWith({ type: 'view', view: 'team', developerAccountId: 'dev-1', panel: 'one-on-one' });
  });

  it('skips a scheduled session from the menu with the existing session PATCH', async () => {
    await openStep('people', makeReview(), 'People');
    fireEvent.click(within(rowEl('oo-1')).getByRole('button', { name: /More actions/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Skip this session' }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/one-on-ones/101/sessions/1', { status: 'skipped' }));
    expect(within(rowEl('oo-1')).getByText('Skipped')).toBeInTheDocument();
    expect(announcement()).toBe('Skipped the 1:1 with Sam Okafor.');
    expect(screen.getByText('2 need you')).toBeInTheDocument();
  });

  it('puts a session back and raises an error when the skip fails', async () => {
    apiPatch.mockRejectedValueOnce(new Error('nope'));
    await openStep('people', makeReview(), 'People');
    fireEvent.click(within(rowEl('oo-1')).getByRole('button', { name: /More actions/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Skip this session' }));
    expect(await screen.findByText("Couldn't skip that 1:1")).toBeInTheDocument();
    expect(within(rowEl('oo-1')).getByText('Missed')).toBeInTheDocument();
  });

  it('offers no skip for a session that is already skipped', async () => {
    const review = makeReview({ sections: [
      { id: 'oneOnOnes', status: 'ready', rows: [session(1, 'Sam Okafor', 'missed', '2026-09-30', 'skipped')] },
      { id: 'people', status: 'ready', rows: [] },
    ] });
    await openStep('people', review, 'People');
    expect(within(rowEl('oo-1')).getByText('Skipped')).toBeInTheDocument();
    fireEvent.click(within(rowEl('oo-1')).getByRole('button', { name: /More actions/ }));
    await screen.findByRole('menuitem', { name: 'Open person' });
    expect(screen.queryByRole('menuitem', { name: 'Skip this session' })).not.toBeInTheDocument();
  });

  it('hides 1:1 rows without the 1:1 workspace, and shows a success empty state when nothing needs you', async () => {
    await openStep('people', makeReview({ oneOnOneEnabled: false }), 'People');
    expect(screen.queryByRole('group', { name: /Missed this week/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Due next week/ })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Status/ })).toBeInTheDocument();
  });

  it('empty', async () => {
    await openStep('people', makeReview({ sections: [{ id: 'oneOnOnes', status: 'ready', rows: [] }, { id: 'people', status: 'ready', rows: [] }] }), 'People');
    expect(screen.getByText('Nothing needs you here')).toBeInTheDocument();
  });

  it('is left out of the review with an empty roster', async () => {
    apiGet.mockResolvedValue({ ...makeReview({ rosterSize: 0 }), saved: saved('look_back') });
    renderReview();
    await screen.findByRole('heading', { level: 2, name: 'What closed this week' });
    expect(within(rail()).queryByRole('button', { name: /People/ })).not.toBeInTheDocument();
    expect(within(rail()).getAllByRole('button')).toHaveLength(5);
    fireEvent.keyDown(document.body, { key: '4' });
    expect(await screen.findByRole('heading', { level: 2, name: /top 3/ })).toBeInTheDocument();
  });

  it('shows check-ins only in collab mode, read-only', async () => {
    const solo = makeReview();
    await openStep('people', solo, 'People');
    expect(screen.queryByRole('group', { name: /Check-ins this week/ })).not.toBeInTheDocument();
  });

  it('collab: one read-only line per participating developer', async () => {
    const collab = makeReview({
      teamMode: 'collab',
      sections: [
        { id: 'oneOnOnes', status: 'ready', rows: [] },
        { id: 'people', status: 'ready', rows: [] },
        { id: 'checkIns', status: 'ready', rows: [
          { developerAccountId: 'dev-1', developerName: 'Priya Nair', daysWithCheckIn: 3, workingDays: 5 },
          { developerAccountId: 'dev-2', developerName: 'Sam Okafor', daysWithCheckIn: 0, workingDays: 5 },
        ] },
      ],
    });
    await openStep('people', collab, 'People');
    const group = screen.getByRole('group', { name: /Check-ins this week/ });
    expect(within(group).getByText('3 of 5 days')).toBeInTheDocument();
    expect(within(group).getByText('No check-ins')).toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument();
    // Check-ins alone do not make it a step that needs the manager.
    expect(screen.getByText('Nothing needs you here')).toBeInTheDocument();
  });

  it('shows a failed 1:1 source as a note with Retry while the rest works', async () => {
    const review = makeReview({ sections: [
      { id: 'oneOnOnes', status: 'unavailable', rows: [] },
      { id: 'people', status: 'ready', rows: [{ developerAccountId: 'dev-3', developerName: 'Marcus Lee', status: 'at_risk', note: null, statusUpdatedAt: null }] },
    ] });
    await openStep('people', review, 'People');
    expect(screen.getByText(/Couldn't load 1:1s/)).toBeInTheDocument();
    expect(screen.getByText('At risk')).toBeInTheDocument();
  });
});

describe('Next week step (docs/59 §5.3 step 5)', () => {
  const planned = (over: Partial<WeeklyReviewTaskRow>[] = []) => [
    task(1, 'Q4 roadmap draft', { scheduledOn: MONDAY }),
    task(2, 'Migrate paging to the new rotation', { scheduledOn: '2026-10-06', priority: 'high' }),
    task(3, 'Calibration prep', { scheduledOn: '2026-10-06' }),
    task(4, 'Review error budget policy', { scheduledOn: '2026-10-07' }),
    ...over.map((extra, index) => task(50 + index, `Extra ${index}`, extra)),
  ];
  const review = (rows: WeeklyReviewTaskRow[] = planned(), extra: Partial<WeeklyReviewResponse> = {}) => makeReview({
    sections: [
      { id: 'closed', status: 'ready', rows: [] },
      { id: 'plannedNextWeek', status: 'ready', rows },
      { id: 'laterNextWeek', status: 'ready', rows: [task(9, 'Revisit headcount plan', { later: true, hideUntil: '2026-10-07' })] },
    ],
    ...extra,
  });

  it("names the day, orders candidates high priority first, and counts planned tasks per day", async () => {
    await openStep('next_week', review(), "Monday's top 3");
    expect(screen.getByText('0 of 3')).toBeInTheDocument();
    const candidates = screen.getByRole('group', { name: /Candidates/ });
    expect(within(candidates).getAllByRole('listitem').map((item) => within(item).getByText(/^(Q4|Migrate|Calibration|Review)/).textContent)).toEqual([
      'Migrate paging to the new rotation',
      'Q4 roadmap draft',
      'Calibration prep',
      'Review error budget policy',
    ]);
    const days = screen.getByRole('list', { name: 'Planned tasks per day' });
    expect(within(days).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Mon11 planned', 'Tue22 planned', 'Wed11 planned', 'Thu–nothing planned', 'Fri–nothing planned',
    ]);
    const later = screen.getByRole('group', { name: /Back from Later next week/ });
    expect(within(later).getByText('Revisit headcount plan')).toBeInTheDocument();
    expect(within(later).getByText('Back Wed 7 Oct')).toBeInTheDocument();
  });

  it("pins with Monday's date on a Friday, up to three, and the fourth is refused", async () => {
    await openStep('next_week', review(), "Monday's top 3");
    const pick = (title: string) => fireEvent.click(within(screen.getByText(title).closest('[data-review-row]') as HTMLElement).getByRole('button', { name: 'Pick' }));
    pick('Migrate paging to the new rotation');
    await waitFor(() => expect(apiPut).toHaveBeenLastCalledWith('/today/top3', { date: MONDAY, taskKeys: ['T-2'] }));
    pick('Q4 roadmap draft');
    pick('Calibration prep');
    await waitFor(() => expect(apiPut).toHaveBeenLastCalledWith('/today/top3', { date: MONDAY, taskKeys: ['T-2', 'T-1', 'T-3'] }));
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
    // Full: Pick is disabled, and p on a candidate says so instead of writing.
    const fourth = screen.getByText('Review error budget policy').closest('[data-review-row]') as HTMLElement;
    expect(within(fourth).getByRole('button', { name: 'Pick' })).toBeDisabled();
    fireEvent.focus(fourth);
    const before = apiPut.mock.calls.length;
    fireEvent.keyDown(fourth, { key: 'p' });
    // A p on a candidate while full only says so.
    expect(apiPut.mock.calls.length).toBe(before);
    expect(announcement()).toBe('Your top 3 is full. Remove one first.');
    expect(within(rail()).getByRole('button', { name: /Next week, 3/ })).toBeInTheDocument();
  });

  it('p picks and unpicks the focused row; Remove takes a pin back to the candidates', async () => {
    await openStep('next_week', review(), "Monday's top 3");
    fireEvent.keyDown(document.body, { key: 'j' });
    const first = document.activeElement as HTMLElement;
    expect(first.getAttribute('data-review-row')).toBe('T-2');
    fireEvent.keyDown(first, { key: 'p' });
    await waitFor(() => expect(apiPut).toHaveBeenLastCalledWith('/today/top3', { date: MONDAY, taskKeys: ['T-2'] }));
    expect(announcement()).toBe('Picked. 1 of 3.');
    const slot = screen.getByRole('button', { name: "Remove Migrate paging to the new rotation from Monday's top 3" });
    fireEvent.click(slot);
    await waitFor(() => expect(apiPut).toHaveBeenLastCalledWith('/today/top3', { date: MONDAY, taskKeys: [] }));
    expect(within(screen.getByRole('group', { name: /Candidates/ })).getByText('Migrate paging to the new rotation')).toBeInTheDocument();
  });

  it('shows what is already pinned and puts the list back when a write fails', async () => {
    const pins: WeeklyReviewPin[] = [{ taskKey: 'T-3', title: 'Calibration prep' }];
    await openStep('next_week', review(planned(), { nextWorkdayTop3: pins }), "Monday's top 3");
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: /Candidates/ })).queryByText('Calibration prep')).not.toBeInTheDocument();
    apiPut.mockRejectedValueOnce(new Error('nope'));
    fireEvent.click(within(screen.getByText('Q4 roadmap draft').closest('[data-review-row]') as HTMLElement).getByRole('button', { name: 'Pick' }));
    await waitFor(() => expect(screen.getByText('1 of 3')).toBeInTheDocument());
    expect(announcement()).toBe("Couldn't save that. Your top 3 is unchanged.");
    expect(await screen.findByText('nope')).toBeInTheDocument();
  });

  it('keeps pins when moving between steps, and flags a pinned 1:1 task', async () => {
    const pins: WeeklyReviewPin[] = [{ taskKey: 'T-70', title: 'Career growth chat', oneOnOne: true }];
    await openStep('next_week', review(planned(), { nextWorkdayTop3: pins }), "Monday's top 3");
    expect(screen.getByText('Career growth chat')).toBeInTheDocument();
    expect(screen.getByText('1:1 · not in your update')).toBeInTheDocument();
    fireEvent.click(within(screen.getByText('Q4 roadmap draft').closest('[data-review-row]') as HTMLElement).getByRole('button', { name: 'Pick' }));
    fireEvent.keyDown(document.body, { key: '[' });
    await screen.findByRole('heading', { level: 2, name: 'People' });
    fireEvent.keyDown(document.body, { key: ']' });
    await screen.findByRole('heading', { level: 2, name: "Monday's top 3" });
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
  });

  it('empty: offers to capture a task', async () => {
    await openStep('next_week', makeReview({ sections: [{ id: 'plannedNextWeek', status: 'ready', rows: [] }, { id: 'laterNextWeek', status: 'ready', rows: [] }] }), "Monday's top 3");
    expect(screen.getByText('Nothing planned next week')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Capture a task' }));
    expect(openCapture).toHaveBeenCalled();
  });

  it('puts tasks moved to Monday in steps 2 and 3 first, and counts them on Monday', async () => {
    const slipped = task(30, 'Slipped plan', { scheduledOn: '2026-09-29', signals: { overdue: true, overdueDays: 3, overdueSource: 'scheduled', stale: false, staleDays: null, drift: false, followUpDue: false } });
    const full = review(planned(), {});
    full.sections.push({ id: 'slipped', status: 'ready', rows: [slipped] });
    apiGet.mockResolvedValue({ ...full, saved: saved('loose_ends') });
    renderReview();
    await screen.findByRole('heading', { level: 2, name: 'Loose ends' });
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-review-row="T-30"]')!).getByRole('button', { name: 'Monday' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    fireEvent.keyDown(document.body, { key: ']' });
    await screen.findByRole('heading', { level: 2, name: 'People' });
    fireEvent.keyDown(document.body, { key: ']' });
    await screen.findByRole('heading', { level: 2, name: "Monday's top 3" });
    const candidates = screen.getByRole('group', { name: /Candidates/ });
    const first = within(candidates).getAllByRole('listitem')[0]!;
    expect(within(first).getByText('Slipped plan')).toBeInTheDocument();
    expect(within(first).getByText('Moved to Mon')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Planned tasks per day' })).getAllByRole('listitem')[0]).toHaveTextContent(/^Mon2/);
  });
});

describe('buildNextWeekPlan', () => {
  it('drops a task that was done, dropped or parked in this session, and starts at the next workday', () => {
    const rows = [task(1, 'A', { scheduledOn: '2026-10-05' }), task(2, 'B', { scheduledOn: '2026-10-05' }), task(3, 'C', { scheduledOn: '2026-10-06' })];
    const review = makeReview({ sections: [{ id: 'plannedNextWeek', status: 'ready', rows }, { id: 'laterNextWeek', status: 'ready', rows: [] }] });
    const choice = (changes: Record<string, unknown>) => ({ action: 'x', label: 'x', tone: 'neutral' as const, announce: 'x', changes });
    const decisions = new Map([
      ['T-1', { taskKey: 'T-1', row: rows[0]!, choice: choice({ status: 'done' }) }],
      ['T-2', { taskKey: 'T-2', row: rows[1]!, choice: choice({ later: true }) }],
    ]);
    const plan = buildNextWeekPlan(review, decisions);
    expect(plan.candidates.map((item) => item.row.taskKey)).toEqual(['T-3']);
    expect(plan.total).toBe(1);
    // Mid-week: the window starts at the next workday, so days before it are not counted.
    const midweek = { ...review, today: '2026-10-07', nextWorkday: '2026-10-08' };
    const plan2 = buildNextWeekPlan(midweek, new Map());
    expect(plan2.candidates).toEqual([]);
    expect(plan2.days[0]?.date).toBe('2026-10-08');
  });
});
