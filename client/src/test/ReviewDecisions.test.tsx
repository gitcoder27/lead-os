import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { QuickActionsProvider } from '@/context/QuickActionsContext';
import { ToastProvider } from '@/context/ToastContext';
import { WeeklyReviewMode } from '@/components/review/WeeklyReviewMode';
import type { WeeklyReviewResponse, WeeklyReviewSavedState, WeeklyReviewTaskRow } from '@/types';

/** docs/60 WR-04: decisions in Waiting and Loose ends, on a Friday so "Monday" is the next workday. */
const apiGet = vi.fn();
const apiPut = vi.fn();
const apiPost = vi.fn();
const openTask = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (url: string, options?: unknown) => apiGet(url, options),
    put: (url: string, body: unknown) => apiPut(url, body),
    post: (url: string, body: unknown) => apiPost(url, body),
  },
}));
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => 'scope', useAuth: () => ({ user: { accountId: 'me' } }) }));
vi.mock('@/hooks/useDevelopers', () => ({
  useDevelopers: () => ({ data: [{ accountId: 'dev-1', displayName: 'Priya Nair' }] }),
}));

const FRIDAY = '2026-10-02';
const MONDAY = '2026-10-05';
const atNine = (day: string) => new Date(`${day}T09:00:00`).toISOString();

function row(id: number, title: string, extra: Partial<WeeklyReviewTaskRow> = {}): WeeklyReviewTaskRow {
  return {
    id, taskKey: `T-${id}`, title, details: null, kind: 'task', status: 'open', ownerType: 'manager', ownerId: 'me', priority: 'normal',
    scheduledOn: null, dueAt: null, startsAt: null, endsAt: null, participants: null, outcome: null, createdByType: 'manager', createdById: 'me',
    createdAt: '2026-09-01T09:00:00.000Z', updatedAt: '2026-09-25T09:00:00.000Z', closedAt: null, deletedAt: null, links: [],
    later: false, trackedByManagerId: 'me', parentId: null, labels: [], nextAction: null, followUpAt: null, schedulePosition: null,
    signals: { overdue: false, overdueDays: null, overdueSource: null, stale: false, staleDays: null, drift: false, followUpDue: false, waitingDays: 3 },
    ...extra,
  } as WeeklyReviewTaskRow;
}

const legal = row(10, 'Vendor DPA signed', {
  followUpAt: '2026-09-30T09:00:00.000Z',
  waitingOn: { type: 'text', ref: null, label: 'Legal', since: '2026-09-21T09:00:00.000Z' },
  signals: { overdue: false, overdueDays: null, overdueSource: null, stale: false, staleDays: null, drift: false, followUpDue: true, waitingDays: 9 },
  quiet: { checkByPassed: '2026-09-30', idleWorkingDays: 4 },
});
const reindex = row(11, 'Search re-index', {
  ownerType: 'developer', ownerId: 'dev-1', followUpAt: null,
  signals: { overdue: false, overdueDays: null, overdueSource: null, stale: true, staleDays: 9, drift: false, followUpDue: false, waitingDays: 9 },
  quiet: { checkByPassed: null, idleWorkingDays: 6 },
});
const slipped = row(20, 'Draft Q4 roadmap', {
  scheduledOn: '2026-09-29',
  signals: { overdue: true, overdueDays: 3, overdueSource: 'scheduled', stale: false, staleDays: null, drift: false, followUpDue: false },
});
const inbox = row(21, 'Look into on-call fatigue', { ownerType: null, ownerId: null, needsTriage: true, createdAt: '2026-10-01T09:00:00.000Z' });
const undated = row(22, 'Rework onboarding checklist', { createdAt: '2026-09-10T09:00:00.000Z' });

function makeReview(sections?: WeeklyReviewResponse['sections'], saved: WeeklyReviewSavedState | null = null): WeeklyReviewResponse {
  return {
    today: FRIDAY,
    timeZone: 'UTC',
    range: { start: '2026-09-28', end: '2026-10-04', nextStart: MONDAY, nextEnd: '2026-10-11' },
    defaultedToLastWeek: false,
    nextWorkday: MONDAY,
    teamMode: 'solo',
    rosterSize: 2,
    oneOnOneEnabled: false,
    sections: sections ?? [
      { id: 'closed', status: 'ready', rows: [] },
      { id: 'quiet', status: 'ready', rows: [legal, reindex] },
      { id: 'slipped', status: 'ready', rows: [slipped] },
      { id: 'inbox', status: 'ready', rows: [inbox] },
      { id: 'undated', status: 'ready', rows: [undated] },
    ],
    nextWorkdayTop3: [],
    saved,
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
        <QuickActionsProvider value={{ openCapture: vi.fn(), openCommandPalette: vi.fn(), openTask }}>{children}</QuickActionsProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
  return render(<WeeklyReviewMode onExit={vi.fn()} onWeekChange={vi.fn()} />, { wrapper });
}

type Bulk = { items: { key: string; changes: Record<string, unknown> }[] };
/** The nth `POST /tasks/bulk` (the write goes out after the optimistic patch settles). */
async function bulkCall(n: number): Promise<Bulk> {
  await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(n));
  return apiPost.mock.calls[n - 1]?.[1] as Bulk;
}
const rowEl = (key: string) => document.querySelector<HTMLElement>(`[data-review-row="${key}"]`)!;
const announcement = () => document.querySelector('[data-testid="weekly-review"] [aria-live="polite"]')!.textContent;

async function openWaiting() {
  apiGet.mockResolvedValue(makeReview(undefined, saved('waiting')));
  renderReview();
  await screen.findByRole('heading', { level: 2, name: 'Waiting & delegated' });
}

async function openLooseEnds() {
  apiGet.mockResolvedValue(makeReview(undefined, saved('loose_ends')));
  renderReview();
  await screen.findByRole('heading', { level: 2, name: 'Loose ends' });
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockReset();
  apiPut.mockReset();
  apiPost.mockReset();
  apiPut.mockResolvedValue({ saved: saved('waiting') });
  apiPost.mockResolvedValue({ tasks: [] });
});

describe('Waiting step (docs/59 §5.3 step 2)', () => {
  it('groups by the party waited on, with chips that say why the row is here', async () => {
    await openWaiting();
    expect(screen.getByText('2 went quiet')).toBeInTheDocument();
    const legalGroup = screen.getByRole('group', { name: /Legal/ });
    expect(within(legalGroup).getByText('Vendor DPA signed')).toBeInTheDocument();
    expect(within(legalGroup).getByText('Waiting 9d')).toBeInTheDocument();
    // The danger chip carries words, not only colour.
    expect(within(legalGroup).getByText('Check was Wed')).toBeInTheDocument();
    // A delegated task with no explicit party groups under its developer.
    const priya = screen.getByRole('group', { name: /Priya Nair/ });
    expect(within(priya).getByText('Quiet 6 working days')).toBeInTheDocument();
    // Primary names the next workday: from a Friday it is Monday.
    expect(within(legalGroup).getByRole('button', { name: 'Check Mon' })).toBeInTheDocument();
    expect(within(legalGroup).getByRole('button', { name: 'Got it' })).toBeInTheDocument();
  });

  it('Check Mon sets the check date to 09:00 on the next workday, collapses the row in place, and saves the decision', async () => {
    await openWaiting();
    const before = [...document.querySelectorAll('[data-review-row]')].map((el) => el.getAttribute('data-review-row'));
    fireEvent.click(within(rowEl('T-10')).getByRole('button', { name: 'Check Mon' }));

    expect(await bulkCall(1)).toEqual({ items: [{ key: 'T-10', changes: { followUpAt: atNine(MONDAY) } }] });
    // The row stays where it was, now one line with Undo; nothing else moved.
    expect([...document.querySelectorAll('[data-review-row]')].map((el) => el.getAttribute('data-review-row'))).toEqual(before);
    expect(within(rowEl('T-10')).getByText('→ Check Mon')).toBeInTheDocument();
    expect(within(rowEl('T-10')).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(within(rowEl('T-10')).queryByRole('button', { name: 'Check Mon' })).not.toBeInTheDocument();
    expect(announcement()).toBe('Check Mon. Press z to undo.');
    // The step and the rail count what is left.
    expect(screen.getByText('1 of 2 left')).toBeInTheDocument();
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/review/week/2026-09-28', { decisions: { 'T-10': 'check_monday' } }));
  });

  it('Undo writes the inverse and brings the actions back', async () => {
    await openWaiting();
    fireEvent.click(within(rowEl('T-10')).getByRole('button', { name: 'Check Mon' }));
    await bulkCall(1);
    fireEvent.click(within(rowEl('T-10')).getByRole('button', { name: 'Undo' }));
    expect(await bulkCall(2)).toEqual({ items: [{ key: 'T-10', changes: { followUpAt: '2026-09-30T09:00:00.000Z' } }] });
    expect(within(rowEl('T-10')).getByRole('button', { name: 'Check Mon' })).toBeInTheDocument();
    expect(announcement()).toBe('Undone.');
    await waitFor(() => expect(apiPut).toHaveBeenLastCalledWith('/review/week/2026-09-28', { decisions: { 'T-10': null } }));
  });

  it('m, e and # decide the focused row from the keyboard without moving focus; z takes back the latest', async () => {
    await openWaiting();
    fireEvent.keyDown(document.body, { key: 'j' });
    const first = document.querySelector<HTMLElement>('[data-review-row]')!;
    const key = first.getAttribute('data-review-row')!;
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'e' });
    expect(await bulkCall(1)).toEqual({ items: [{ key, changes: { status: 'done' } }] });
    await waitFor(() => expect(first).toHaveFocus());
    expect(within(first).getByText('Got it')).toBeInTheDocument();
    // A decided row ignores further action keys.
    fireEvent.keyDown(first, { key: '#' });
    expect(apiPost).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(first, { key: 'j' });
    const second = document.activeElement as HTMLElement;
    fireEvent.keyDown(second, { key: '#' });
    expect((await bulkCall(2)).items[0]!.changes).toEqual({ status: 'dropped' });
    fireEvent.keyDown(second, { key: 'z' });
    await bulkCall(3);
    expect(within(second).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    // z again reaches the earlier decision.
    fireEvent.keyDown(second, { key: 'z' });
    await waitFor(() => expect(within(first).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument());
    await bulkCall(4);
    fireEvent.keyDown(second, { key: 'z' }); // nothing left to undo
    expect(apiPost).toHaveBeenCalledTimes(4);
  });

  it('Still waiting checks again in a week, Stop waiting clears the party, and the menu offers a check date', async () => {
    await openWaiting();
    fireEvent.click(within(rowEl('T-10')).getByRole('button', { name: /More actions/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Still waiting/ }));
    expect(await bulkCall(1)).toEqual({ items: [{ key: 'T-10', changes: { followUpAt: atNine('2026-10-09') } }] });
    expect(within(rowEl('T-10')).getByText('→ Check Oct 9')).toBeInTheDocument();

    fireEvent.click(within(rowEl('T-11')).getByRole('button', { name: /More actions/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Stop waiting/ }));
    expect(await bulkCall(2)).toEqual({ items: [{ key: 'T-11', changes: { waitingOn: null } }] });
    expect(within(rowEl('T-11')).getByText('No longer waiting')).toBeInTheDocument();
    expect(announcement()).toBe('Stopped waiting. Press z to undo.');
  });

  it('c opens the check-by menu, and a preset writes that date', async () => {
    await openWaiting();
    fireEvent.keyDown(document.body, { key: 'j' });
    const first = document.activeElement as HTMLElement;
    fireEvent.keyDown(first, { key: 'c' });
    const menu = await screen.findByRole('dialog', { name: 'Check by' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Tomorrow/ }));
    expect((await bulkCall(1)).items[0]!.changes).toEqual({ followUpAt: atNine('2026-10-03') });
  });

  it('puts the row back to undecided when the write fails, with a persistent error', async () => {
    apiPost.mockRejectedValueOnce(new Error('nope'));
    await openWaiting();
    fireEvent.click(within(rowEl('T-10')).getByRole('button', { name: 'Check Mon' }));
    await waitFor(() => expect(within(rowEl('T-10')).getByRole('button', { name: 'Check Mon' })).toBeInTheDocument());
    expect(await screen.findByText('Could not update tasks')).toBeInTheDocument();
    await waitFor(() => expect(apiPut).toHaveBeenLastCalledWith('/review/week/2026-09-28', { decisions: { 'T-10': null } }));
    expect(screen.getByText('2 went quiet')).toBeInTheDocument();
  });

  it('opens the task, and shows a success empty state when nothing has gone quiet', async () => {
    await openWaiting();
    fireEvent.click(screen.getByText('Vendor DPA signed'));
    expect(openTask).toHaveBeenCalledWith('T-10');
  });

  it('empty', async () => {
    apiGet.mockResolvedValue(makeReview([{ id: 'closed', status: 'ready', rows: [] }, { id: 'quiet', status: 'ready', rows: [] }], saved('waiting')));
    renderReview();
    expect(await screen.findByText('Nothing has gone quiet')).toBeInTheDocument();
  });
});

describe('Loose ends step (docs/59 §5.3 step 3)', () => {
  it('groups Slipped, Inbox and Undated with context, and offers Monday and Done', async () => {
    await openLooseEnds();
    expect(screen.getByText('3 to decide')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: /Slipped/ })).getByText('3d overdue · planned Tue')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: /Inbox/ })).getByText('In Inbox 1d')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: /Undated for 2\+ weeks/ })).getByText('No date · 22d old')).toBeInTheDocument();
    expect(within(rowEl('T-20')).getByRole('button', { name: 'Monday' })).toBeInTheDocument();
  });

  it('Monday plans it for the next workday and takes it off Later', async () => {
    await openLooseEnds();
    fireEvent.click(within(rowEl('T-20')).getByRole('button', { name: 'Monday' }));
    expect(await bulkCall(1)).toEqual({ items: [{ key: 'T-20', changes: { scheduledOn: MONDAY, later: false } }] });
    expect(within(rowEl('T-20')).getByText('→ Mon')).toBeInTheDocument();
    expect(announcement()).toBe('Moved to Mon. Press z to undo.');
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/review/week/2026-09-28', { decisions: { 'T-20': 'monday' } }));
    // Undo restores the old plan date.
    fireEvent.click(within(rowEl('T-20')).getByRole('button', { name: 'Undo' }));
    expect((await bulkCall(2)).items[0]!.changes).toMatchObject({ scheduledOn: '2026-09-29', later: false });
  });

  it('Done and Drop write the status, and s opens the schedule menu with Later', async () => {
    await openLooseEnds();
    fireEvent.click(within(rowEl('T-21')).getByRole('button', { name: 'Done' }));
    expect(await bulkCall(1)).toEqual({ items: [{ key: 'T-21', changes: { status: 'done' } }] });
    expect(within(rowEl('T-21')).getByText('Done')).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'j' });
    const first = document.activeElement as HTMLElement;
    fireEvent.keyDown(first, { key: 's' });
    const menu = await screen.findByRole('dialog', { name: 'Schedule' });
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: /Later/ }));
    expect((await bulkCall(2)).items[0]!.changes).toMatchObject({ later: true });
    expect(within(first).getByText('→ Later')).toBeInTheDocument();

    // Focus was on the Inbox row that was just decided, so `j` moved to the next one (T-22).
    expect(first).toBe(rowEl('T-22'));
    fireEvent.click(within(rowEl('T-20')).getByRole('button', { name: /More actions/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Drop/ }));
    expect(await bulkCall(3)).toEqual({ items: [{ key: 'T-20', changes: { status: 'dropped' } }] });
  });

  it('Keep undated triages an Inbox task without giving it a date', async () => {
    await openLooseEnds();
    fireEvent.click(within(rowEl('T-21')).getByRole('button', { name: /More actions/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Keep undated/ }));
    expect(await bulkCall(1)).toEqual({ items: [{ key: 'T-21', changes: { triaged: true } }] });
  });

  it('keeps decisions when moving between steps, and shows a success empty state with no loose ends', async () => {
    await openLooseEnds();
    fireEvent.click(within(rowEl('T-20')).getByRole('button', { name: 'Monday' }));
    fireEvent.keyDown(document.body, { key: '[' });
    await screen.findByRole('heading', { level: 2, name: 'Waiting & delegated' });
    fireEvent.keyDown(document.body, { key: ']' });
    await screen.findByRole('heading', { level: 2, name: 'Loose ends' });
    expect(within(rowEl('T-20')).getByText('→ Mon')).toBeInTheDocument();
    expect(screen.getByText('2 of 3 left')).toBeInTheDocument();
  });

  it('empty', async () => {
    apiGet.mockResolvedValue(makeReview([{ id: 'closed', status: 'ready', rows: [] }, { id: 'slipped', status: 'ready', rows: [] }], saved('loose_ends')));
    renderReview();
    expect(await screen.findByText('No loose ends')).toBeInTheDocument();
  });
});
