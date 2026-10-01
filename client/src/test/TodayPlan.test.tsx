import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/context/ToastContext';
import { QuickActionsProvider } from '@/context/QuickActionsContext';
import { TodayPage } from '@/components/today/TodayPage';
import { TodayPlanPanel, planDetail } from '@/components/today/TodayPlanPanel';
import { createTestQueryClient } from '@/test/wrapper';
import type { TodayActionItem, TodayPlanFocus, TodayPlanItem, TodayResponse } from '@/types';

vi.mock('@/hooks/useTeamMode', () => ({
  useTeamMode: () => 'solo',
  useSetTeamMode: () => ({ mutate: vi.fn(), isPending: false }),
}));

const DATE = '2026-03-08';

function planItem(key: string, title: string, overrides: Partial<TodayPlanItem> = {}): TodayPlanItem {
  const target = { type: 'view', view: 'tasks', taskKey: key, date: DATE } as const;
  return {
    taskKey: key,
    title,
    status: 'open',
    priority: 'normal',
    scheduledOn: DATE,
    dueAt: null,
    overdue: false,
    pinned: false,
    target,
    primaryAction: { kind: 'mark_done', label: 'Done', target, confirm: false, undoable: true },
    ...overrides,
  };
}

function plan(overrides: Partial<TodayPlanFocus> = {}): TodayPlanFocus {
  return {
    date: DATE,
    items: [],
    top3: [],
    inboxCount: 0,
    doneToday: { count: 0, items: [] },
    tomorrowTop3: { date: '2026-03-09', items: [] },
    ...overrides,
  };
}

function queueRow(key: string, title: string, index: number): TodayActionItem {
  const target = { type: 'view', view: 'tasks', taskKey: key, date: DATE } as const;
  return {
    id: `today-top3-${key}`,
    type: 'top_three',
    title,
    context: 'Top 3 for today',
    signal: `Top ${index + 1}`,
    severity: 'info',
    priority: 120 - index,
    group: 'now',
    target,
    primaryAction: { kind: 'mark_done', label: 'Done', target, confirm: false, undoable: true },
    secondaryActions: [],
  };
}

function today(stage: 'morning_plan' | 'wrap_up', focusPlan: TodayPlanFocus | undefined, actionItems: TodayActionItem[] = [], carryCandidates: TodayActionItem[] = []): TodayResponse {
  const focus = stage === 'wrap_up'
    ? { stage, wrapUp: { missingCheckIns: [], openPromises: [], carryCandidates, eodNoteTarget: { type: 'view', view: 'notes', date: DATE } } }
    : { stage, morning: { nowCount: 0, oneOnOnes: [] } };
  return {
    date: DATE,
    generatedAt: '2026-03-08T08:30:00.000Z',
    rhythm: { stage, label: stage === 'wrap_up' ? 'Wrap-up' : 'Morning plan', detail: '' },
    summary: [],
    actionItems,
    totalCount: actionItems.length,
    teamPulse: [],
    promises: [],
    standupPrompts: [],
    meetingPrompts: [],
    focus: { ...focus, ...(focusPlan ? { plan: focusPlan } : {}) },
  } as TodayResponse;
}

function mockFetch(response: TodayResponse) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes('/api/today?') ? response : { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function calls(fetchMock: ReturnType<typeof mockFetch>, needle: string) {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes(needle));
}

function renderToday(openCapture = vi.fn(), onOpenTodayTarget = vi.fn()) {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <QuickActionsProvider value={{ openCapture, openCommandPalette: vi.fn() }}>
        <ToastProvider>
          <TodayPage onViewChange={vi.fn()} onOpenTodayTarget={onOpenTodayTarget} />
        </ToastProvider>
      </QuickActionsProvider>
    </QueryClientProvider>,
  );
  return { openCapture, onOpenTodayTarget };
}

describe('TodayPlanPanel', () => {
  const noop = vi.fn();
  const panel = (value: TodayPlanFocus, props: Partial<Parameters<typeof TodayPlanPanel>[0]> = {}) =>
    render(
      <TodayPlanPanel plan={value} today={DATE} pinning={false} onTogglePin={noop} onRunCommand={noop} onOpenTarget={noop} onCapture={noop} {...props} />,
    );

  afterEach(() => cleanup());

  it('asks you to plan your day when nothing is planned, with Add task and the Inbox count', () => {
    const onCapture = vi.fn();
    const onOpenTarget = vi.fn();
    panel(plan({ inboxCount: 3 }), { onCapture, onOpenTarget });

    const row = screen.getByTestId('today-plan-empty');
    expect(within(row).getByText('Plan your day')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Add task' }));
    expect(onCapture).toHaveBeenCalledTimes(1);
    fireEvent.click(within(row).getByRole('button', { name: '3 to triage' }));
    expect(onOpenTarget).toHaveBeenCalledWith({ type: 'view', view: 'tasks', taskView: 'inbox' });
    expect(screen.queryByTestId('today-plan-pin-hint')).not.toBeInTheDocument();
  });

  it('omits the triage button when the Inbox is empty', () => {
    panel(plan());
    expect(screen.queryByRole('button', { name: /to triage/ })).not.toBeInTheDocument();
  });

  it('invites you to pick up to 3, then counts the pins', () => {
    const items = [planItem('T-1', 'One'), planItem('T-2', 'Two')];
    const { rerender } = panel(plan({ items }));
    expect(screen.getByTestId('today-plan-pin-hint')).toHaveTextContent('Pick up to 3');

    rerender(
      <TodayPlanPanel plan={plan({ items: [planItem('T-1', 'One', { pinned: true }), items[1]!], top3: ['T-1'] })} today={DATE} pinning={false} onTogglePin={noop} onRunCommand={noop} onOpenTarget={noop} onCapture={noop} />,
    );
    expect(screen.getByTestId('today-plan-pin-hint')).toHaveTextContent('Top 3 · 1/3');
  });

  it('pins and unpins by task key, and stops at three', () => {
    const onTogglePin = vi.fn();
    const items = [
      planItem('T-1', 'One', { pinned: true }),
      planItem('T-2', 'Two', { pinned: true }),
      planItem('T-3', 'Three', { pinned: true }),
      planItem('T-4', 'Four'),
    ];
    panel(plan({ items, top3: ['T-1', 'T-2', 'T-3'] }), { onTogglePin });

    // The fourth cannot be pinned while three are; an existing pin can always be removed.
    expect(screen.getByRole('button', { name: 'Pin Four to top 3' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Unpin Two from top 3' }));
    expect(onTogglePin).toHaveBeenCalledWith('T-2');
  });

  it('waits while a pin write is in flight', () => {
    panel(plan({ items: [planItem('T-1', 'One')] }), { pinning: true });
    expect(screen.getByRole('button', { name: 'Pin One to top 3' })).toBeDisabled();
  });

  it('runs Done with the row\'s mark_done command and opens the task on click', () => {
    const onRunCommand = vi.fn();
    const item = planItem('T-1', 'One');
    panel(plan({ items: [item] }), { onRunCommand });

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onRunCommand).toHaveBeenCalledWith(item.primaryAction);
    fireEvent.click(screen.getByRole('button', { name: /^One/ }));
    expect(onRunCommand).toHaveBeenLastCalledWith({ kind: 'open', label: 'Open', target: item.target });
  });

  it('labels slipped, in-progress and blocked rows', () => {
    expect(planDetail(planItem('T-1', 'x', { scheduledOn: '2026-03-05', overdue: true }), DATE)).toEqual({ text: '3d overdue', overdue: true });
    expect(planDetail(planItem('T-2', 'x', { status: 'active' }), DATE)).toEqual({ text: 'In progress', overdue: false });
    expect(planDetail(planItem('T-3', 'x', { status: 'blocked' }), DATE)).toEqual({ text: 'Blocked', overdue: false });
    expect(planDetail(planItem('T-4', 'x'), DATE)).toBeUndefined();
  });
});

describe('TodayPage plan', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });
  afterEach(() => cleanup());

  it('shows my plan with pinned tasks first, and lists each pinned task once (docs/63 #7)', async () => {
    const items = [planItem('T-2', 'Beta', { pinned: true }), planItem('T-1', 'Alpha')];
    const exception: TodayActionItem = { ...queueRow('J-1', 'AM-1 Overdue defect', 1), id: 'overdue-1', type: 'overdue_issue' };
    mockFetch(today('morning_plan', plan({ items, top3: ['T-2'] }), [queueRow('T-2', 'Beta', 0), exception]));
    renderToday();

    expect(await screen.findByRole('heading', { name: 'My plan' })).toBeInTheDocument();
    const planRows = screen.getAllByTestId('today-plan-row');
    expect(planRows).toHaveLength(2);
    expect(planRows[0]).toHaveTextContent('Beta');
    expect(planRows[0]).toHaveAttribute('data-pinned', 'true');
    // The queue keeps the exception; the pin's own queue row is not a second copy of Beta.
    const queueRows = screen.getAllByTestId('today-action-row');
    expect(queueRows).toHaveLength(1);
    expect(queueRows[0]).toHaveTextContent('AM-1 Overdue defect');
    expect(screen.getAllByText('Beta')).toHaveLength(1);
  });

  it('pins a task with PUT /today/top3, keeping the order already picked', async () => {
    const items = [planItem('T-2', 'Beta', { pinned: true }), planItem('T-1', 'Alpha')];
    const fetchMock = mockFetch(today('morning_plan', plan({ items, top3: ['T-2'] })));
    renderToday();

    fireEvent.click(await screen.findByRole('button', { name: 'Pin Alpha to top 3' }));
    await waitFor(() => expect(calls(fetchMock, '/api/today/top3')).toHaveLength(1));
    const [, init] = calls(fetchMock, '/api/today/top3')[0]!;
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ date: DATE, taskKeys: ['T-2', 'T-1'] });
  });

  it('unpins by sending the remaining keys', async () => {
    const items = [planItem('T-2', 'Beta', { pinned: true }), planItem('T-1', 'Alpha', { pinned: true })];
    const fetchMock = mockFetch(today('morning_plan', plan({ items, top3: ['T-2', 'T-1'] })));
    renderToday();

    fireEvent.click(await screen.findByRole('button', { name: 'Unpin Beta from top 3' }));
    await waitFor(() => expect(calls(fetchMock, '/api/today/top3')).toHaveLength(1));
    expect(JSON.parse(String(calls(fetchMock, '/api/today/top3')[0]![1]?.body))).toEqual({ date: DATE, taskKeys: ['T-1'] });
  });

  it('marks a plan row done through the command engine with its task key, not by opening it', async () => {
    let current = today('morning_plan', plan({ items: [planItem('T-7', 'Ship it')] }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/manager-actions/commands')) {
        // The write lands: the next read has no plan row and one real completion.
        current = today('morning_plan', plan({ doneToday: { count: 1, items: [] } }));
        return new Response(JSON.stringify({ success: true, command: 'mark_done' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const body = url.includes('/api/today?') ? current : { ok: true };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onOpenTodayTarget } = renderToday();

    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    await waitFor(() => expect(calls(fetchMock as ReturnType<typeof mockFetch>, '/api/manager-actions/commands')).toHaveLength(1));
    const body = JSON.parse(String((fetchMock.mock.calls as unknown as [unknown, RequestInit][]).find(([input]) => String(input).includes('/api/manager-actions/commands'))![1].body));
    expect(body.command.kind).toBe('mark_done');
    expect(body.command.target.taskKey).toBe('T-7');
    expect(onOpenTodayTarget).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Ship it')).not.toBeInTheDocument());
    expect(screen.getByTestId('today-plan-empty')).toBeInTheDocument();
  });

  it('opens capture from the empty plan', async () => {
    mockFetch(today('morning_plan', plan()));
    const { openCapture } = renderToday();

    fireEvent.click(await screen.findByRole('button', { name: 'Add task' }));
    expect(openCapture).toHaveBeenCalled();
  });

  it('reads the cleared count from real completions, not from this session', async () => {
    const response = today('morning_plan', plan({ doneToday: { count: 4, items: [] } }), [{ ...queueRow('T-1', 'Alpha', 0), id: 'overdue-1', type: 'overdue_issue' }]);
    mockFetch(response);
    renderToday();

    // A fresh mount with empty storage still shows what was finished earlier today — as a plain fact, with no progress bar.
    expect(await screen.findByText('4 done today')).toBeInTheDocument();
    expect(document.querySelector('.today-progress-track')).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it('wrap-up lists Done today and lets you pick tomorrow\'s top 3', async () => {
    const closed = { taskKey: 'T-9', title: 'Sent the report', closedAt: '2026-03-08T09:00:00.000Z', target: { type: 'view', view: 'tasks', taskKey: 'T-9', date: DATE } } as const;
    const fetchMock = mockFetch(today('wrap_up', plan({
      items: [planItem('T-1', 'Alpha'), planItem('T-2', 'Beta')],
      doneToday: { count: 2, items: [closed] },
      tomorrowTop3: { date: '2026-03-09', items: [planItem('T-2', 'Beta', { pinned: true })] },
    })));
    renderToday();

    const done = await screen.findByRole('group', { name: 'Done today (2)' });
    expect(within(done).getByText('Sent the report')).toBeInTheDocument();

    const tomorrow = screen.getByRole('group', { name: "Tomorrow's top 3" });
    expect(within(tomorrow).getByText(/1\/3/)).toBeInTheDocument();
    expect(within(tomorrow).getByTestId('tomorrow-top3-row')).toHaveTextContent('Beta');
    const open = screen.getByRole('group', { name: 'Still open today (1)' });
    expect(within(open).queryByText('Beta')).not.toBeInTheDocument();
    fireEvent.click(within(open).getByRole('button', { name: "Pick Alpha for tomorrow's top 3" }));

    await waitFor(() => expect(calls(fetchMock, '/api/today/top3')).toHaveLength(1));
    expect(JSON.parse(String(calls(fetchMock, '/api/today/top3')[0]![1]?.body))).toEqual({ date: '2026-03-09', taskKeys: ['T-2', 'T-1'] });
  });

  it('wrap-up removes a pick without touching the others', async () => {
    const fetchMock = mockFetch(today('wrap_up', plan({
      tomorrowTop3: { date: '2026-03-09', items: [planItem('T-1', 'Alpha', { pinned: true }), planItem('T-2', 'Beta', { pinned: true })] },
    })));
    renderToday();

    fireEvent.click(await screen.findByRole('button', { name: "Remove Alpha from tomorrow's top 3" }));
    await waitFor(() => expect(calls(fetchMock, '/api/today/top3')).toHaveLength(1));
    expect(JSON.parse(String(calls(fetchMock, '/api/today/top3')[0]![1]?.body))).toEqual({ date: '2026-03-09', taskKeys: ['T-2'] });
  });

  describe('wrap-up keeps unfinished work (docs/63 #2)', () => {
    const four = () => plan({ items: ['Alpha', 'Beta', 'Gamma', 'Delta'].map((title, index) => planItem(`T-${index + 1}`, title)) });

    it('shows every unfinished plan task in the morning and again at wrap-up, none lost at the phase change', async () => {
      mockFetch(today('morning_plan', four()));
      renderToday();
      await screen.findByRole('heading', { name: 'My plan' });
      const morning = screen.getAllByTestId('today-plan-row').map((row) => row.textContent);
      expect(morning.join('|')).toMatch(/Alpha.*Beta.*Gamma.*Delta/);
      cleanup();

      mockFetch(today('wrap_up', four()));
      renderToday();
      const open = await screen.findByRole('group', { name: 'Still open today (4)' });
      expect(within(open).getAllByTestId('tomorrow-top3-candidate')).toHaveLength(3);
      fireEvent.click(within(open).getByRole('button', { name: '+1 more' }));
      const titles = within(open).getAllByTestId('tomorrow-top3-candidate').map((row) => row.textContent ?? '');
      expect(titles).toHaveLength(4);
      expect(titles[3]).toContain('Delta');
    });

    it('finishes an unfinished task from the wrap-up through the command engine', async () => {
      let current = today('wrap_up', four());
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/manager-actions/commands')) {
          current = today('wrap_up', plan({ items: four().items.slice(1), doneToday: { count: 1, items: [] } }));
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify(url.includes('/api/today?') ? current : { ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      });
      vi.stubGlobal('fetch', fetchMock);
      renderToday();

      fireEvent.click(await screen.findByRole('button', { name: 'Done Alpha' }));
      await waitFor(() => expect(calls(fetchMock as ReturnType<typeof mockFetch>, '/api/manager-actions/commands')).toHaveLength(1));
      await waitFor(() => expect(screen.getByRole('group', { name: 'Still open today (3)' })).toBeInTheDocument());
      expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    });

    it('keeps unfinished tasks visible when tomorrow is full, with Pick disabled and explained', async () => {
      const picked = ['T-1', 'T-2', 'T-3'].map((key) => planItem(key, `Pinned ${key}`, { pinned: true }));
      mockFetch(today('wrap_up', plan({
        items: [...picked, planItem('T-4', 'Delta'), planItem('T-5', 'Epsilon')],
        tomorrowTop3: { date: '2026-03-09', items: picked },
      })));
      renderToday();

      const open = await screen.findByRole('group', { name: 'Still open today (2)' });
      const pick = within(open).getByRole('button', { name: "Pick Delta for tomorrow's top 3" });
      expect(pick).toBeDisabled();
      expect(pick).toHaveAttribute('title', expect.stringContaining('full'));
      expect(within(open).getByText('Epsilon')).toBeInTheDocument();
    });

    it('folds a carry row for a planned task into that task instead of listing it twice', async () => {
      const carry: TodayActionItem = {
        ...queueRow('T-1', 'Alpha', 0),
        id: 'today-desk-carry-1',
        type: 'desk_carry_forward',
        primaryAction: { kind: 'carry_forward', label: 'Carry to tomorrow', target: queueRow('T-1', 'Alpha', 0).target, toDate: '2026-03-09', confirm: false, undoable: true },
      };
      mockFetch(today('wrap_up', plan({ items: [planItem('T-1', 'Alpha')] }), [], [carry]));
      renderToday();

      const open = await screen.findByRole('group', { name: 'Still open today (1)' });
      expect(within(open).getByRole('button', { name: 'Carry Alpha to tomorrow' })).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: /Carry to tomorrow/ })).not.toBeInTheDocument();
      expect(screen.getAllByText('Alpha')).toHaveLength(1);
    });

    it('makes no "nothing left" claim while a source failed to load (docs/63 #6)', async () => {
      const response = today('wrap_up', plan({ doneToday: { count: 2, items: [] } }));
      mockFetch({ ...response, isPartial: true, sourceStatus: { issues: 'ready', team: 'unavailable', desk: 'ready', sync: 'ready', drift: 'ready', one_on_one: 'ready' } });
      renderToday();

      await screen.findByRole('heading', { name: 'Wrap-up' });
      expect(screen.getByText(/Team unavailable/)).toBeInTheDocument();
      expect(screen.queryByText(/Nothing left|Nothing was planned|Loops closed/)).not.toBeInTheDocument();
    });

    it('makes no completion claim while a plan task is open, and none on a day with nothing at all', async () => {
      mockFetch(today('wrap_up', plan({ items: [planItem('T-1', 'Alpha')], doneToday: { count: 2, items: [] } })));
      renderToday();
      await screen.findByRole('group', { name: 'Still open today (1)' });
      expect(screen.queryByText(/Nothing left|Loops closed|Nothing was planned/)).not.toBeInTheDocument();
      cleanup();

      mockFetch(today('wrap_up', plan()));
      renderToday();
      expect(await screen.findByText('Nothing was planned or finished today.')).toBeInTheDocument();
      expect(screen.queryByText(/Loops closed|Nothing left/)).not.toBeInTheDocument();
      cleanup();

      mockFetch(today('wrap_up', plan({ doneToday: { count: 2, items: [] } })));
      renderToday();
      expect(await screen.findByText('Nothing left on your plan, promises, carry-over or check-ins.')).toBeInTheDocument();
    });
  });

  it('without a plan (legacy task model) Today renders as before', async () => {
    mockFetch(today('morning_plan', undefined, [queueRow('T-1', 'Alpha', 0)]));
    renderToday();

    expect(await screen.findByRole('heading', { name: 'Queue' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'My plan' })).not.toBeInTheDocument();
    expect(screen.queryByText(/cleared/)).not.toBeInTheDocument();
  });
});
