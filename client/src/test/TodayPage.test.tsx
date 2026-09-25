import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/context/ToastContext';
import { TodayPage } from '@/components/today/TodayPage';
import { createTestQueryClient } from '@/test/wrapper';
import type { TodayActionItem, TodayResponse } from '@/types';

function target(overrides = {}) {
  return { type: 'view', view: 'team', ...overrides } as const;
}

function command(kind: TodayActionItem['primaryAction']['kind'], label: string, actionTarget: TodayActionItem['target']) {
  return {
    kind,
    label,
    target: actionTarget,
    ...(kind === 'mark_done' || kind === 'carry_forward' ? { confirm: true } : {}),
  };
}

function actionItem(index: number, overrides: Partial<TodayActionItem> = {}): TodayActionItem {
  const actionTarget = target({ type: 'issue', view: 'work', issueKey: `AM-${index}`, filter: 'overdue' });
  return {
    id: `action-${index}`,
    type: 'overdue_issue',
    title: `AM-${index} Issue ${index}`,
    context: 'Alice Smith / In Progress',
    signal: 'Overdue',
    severity: 'critical',
    priority: 90 - index,
    group: 'now',
    target: actionTarget,
    primaryAction: command('open', 'Open issue', actionTarget),
    secondaryActions: [command('capture_follow_up', 'Follow up', actionTarget)],
    ...overrides,
  };
}

function todayResponse(overrides: Partial<TodayResponse> = {}): TodayResponse {
  const followUpTarget = target({ type: 'follow_up', view: 'follow-ups', managerDeskItemId: 44, date: '2026-03-08' });
  const devTarget = target({ type: 'developer', view: 'team', developerAccountId: 'dev-1', date: '2026-03-08' });
  const actions = [
    actionItem(1),
    {
      ...actionItem(2, {
        id: 'follow-up-44',
        type: 'follow_up_due',
        title: 'Follow up with QA',
        context: 'QA',
        signal: 'Overdue follow-up',
        target: followUpTarget,
        primaryAction: command('mark_done', 'Done', followUpTarget),
        secondaryActions: [command('snooze', 'Snooze', followUpTarget), command('open', 'Open', followUpTarget)],
      }),
    },
    ...Array.from({ length: 9 }, (_, index) => actionItem(index + 3)),
  ] as TodayActionItem[];

  return {
    date: '2026-03-08',
    generatedAt: '2026-03-08T08:30:00.000Z',
    rhythm: { stage: 'morning_plan', label: 'Morning plan', detail: 'Set direction' },
    summary: [
      { id: 'attention', label: 'Attention', value: 11, detail: 'action rows', severity: 'warning' },
      { id: 'work', label: 'Active defects', value: 5, detail: 'in Work', severity: 'neutral' },
      { id: 'team', label: 'People', value: 1, detail: 'on team', severity: 'info', target: target() },
      { id: 'stale', label: 'Stale check-ins', value: 1, detail: 'need update', severity: 'warning' },
      { id: 'due', label: 'Due work', value: 3, detail: 'today or late', severity: 'warning' },
      { id: 'follow', label: 'Follow-ups', value: 1, detail: 'due now', severity: 'warning' },
    ],
    currentPriority: actions[0],
    actionItems: actions,
    teamPulse: [
      {
        accountId: 'dev-1',
        displayName: 'Alice Smith',
        initials: 'AS',
        status: 'Blocked',
        tone: 'critical',
        detail: 'Blocked',
        currentWork: 'No current work',
        lastUpdate: '1d ago',
        target: devTarget,
        primaryAction: command('add_check_in', 'Check-in', devTarget),
        secondaryActions: [command('capture_follow_up', 'Follow up', devTarget)],
      },
    ],
    promises: [
      {
        id: 'promise-44',
        title: 'Follow up with QA',
        detail: 'Overdue',
        severity: 'critical',
        target: followUpTarget,
        primaryAction: command('mark_done', 'Done', followUpTarget),
        secondaryActions: [command('snooze', 'Snooze', followUpTarget)],
      },
    ],
    standupPrompts: [],
    meetingPrompts: [],
    ...overrides,
  };
}

function mockFetch(response: TodayResponse) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/today')) {
      return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderToday(response = todayResponse(), onOpenTodayTarget = vi.fn()) {
  const queryClient = createTestQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TodayPage onViewChange={vi.fn()} onOpenTodayTarget={onOpenTodayTarget} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onOpenTodayTarget };
}

describe('TodayPage V2', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it('shows the shaped Today skeleton while the first request is pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));

    renderToday();

    expect(screen.getByRole('status', { name: 'Loading Today' })).toBeInTheDocument();
    expect(screen.queryByText('Building the action queue.')).not.toBeInTheDocument();
  });

  it('renders the action queue with a hard visible row limit', async () => {
    mockFetch(todayResponse());
    renderToday();

    expect(await screen.findByText('Action queue')).toBeInTheDocument();
    expect(screen.getAllByTestId('today-action-row')).toHaveLength(8);
    expect(screen.getByText('+3 more in the source workflows')).toBeInTheDocument();
  });

  it('opens the exact issue target from a row', async () => {
    mockFetch(todayResponse());
    const onOpenTodayTarget = vi.fn();
    renderToday(todayResponse(), onOpenTodayTarget);

    fireEvent.click(await screen.findByRole('button', { name: /open am-1/i }));

    await waitFor(() => {
      expect(onOpenTodayTarget).toHaveBeenCalledWith(expect.objectContaining({ issueKey: 'AM-1', view: 'work' }));
    });
  });

  it('routes a Jira drift item to the tasks target without mutating (§8.1)', async () => {
    const driftTarget = target({ type: 'view', view: 'tasks', taskKey: 'T-7' });
    const fetchMock = mockFetch(todayResponse({
      actionItems: [
        actionItem(1, {
          id: 'jira-drift-T-7',
          type: 'jira_drift',
          title: 'T-7 Checkout follow-up',
          context: 'AM-7 is done in Jira — this task is still open',
          signal: 'Done in Jira, open here',
          severity: 'warning',
          target: driftTarget,
          primaryAction: command('open', 'Open task', driftTarget),
          secondaryActions: [],
        }),
      ],
    }));
    const onOpenTodayTarget = vi.fn();
    renderToday(todayResponse({
      actionItems: [
        actionItem(1, {
          id: 'jira-drift-T-7',
          type: 'jira_drift',
          title: 'T-7 Checkout follow-up',
          context: 'AM-7 is done in Jira — this task is still open',
          signal: 'Done in Jira, open here',
          severity: 'warning',
          target: driftTarget,
          primaryAction: command('open', 'Open task', driftTarget),
          secondaryActions: [],
        }),
      ],
    }), onOpenTodayTarget);

    fireEvent.click(await screen.findByRole('button', { name: /open task/i }));

    await waitFor(() => {
      expect(onOpenTodayTarget).toHaveBeenCalledWith(expect.objectContaining({ view: 'tasks', taskKey: 'T-7' }));
    });
    // Read-only signal — no manager-action command is posted.
    expect(
      fetchMock.mock.calls.some(([input, init]) =>
        String(input) === '/api/manager-actions/commands' && (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('confirms a follow-up done action before mutating through the manager action command endpoint', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const fetchMock = mockFetch(todayResponse());
    renderToday();

    const doneButtons = await screen.findAllByRole('button', { name: /^Done$/i });
    fireEvent.click(doneButtons[0]!);

    expect(await screen.findByRole('dialog', { name: /mark done/i })).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(([input, init]) =>
        String(input) === '/api/manager-actions/commands' && (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /^Mark done$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/manager-actions/commands', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"kind":"mark_done"'),
      }));
    });
  });

  it('snoozes a follow-up from the secondary action menu', async () => {
    const fetchMock = mockFetch(todayResponse());
    renderToday();

    const moreActions = await screen.findAllByLabelText('More actions');
    const tomorrowButtons = screen.getAllByText('Tomorrow');
    fireEvent.click(moreActions[1]!);
    fireEvent.click(tomorrowButtons[0]!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/manager-actions/commands', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"preset":"tomorrow"'),
      }));
    });
  });

  it('captures a follow-up through the Today dialog instead of a native prompt', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    const followUpTarget = target({
      type: 'issue',
      view: 'work',
      issueKey: 'AM-1',
      relatedIssueKeys: ['AM-2'],
      filter: 'overdue',
    });
    const fetchMock = mockFetch(todayResponse({
      actionItems: [
        actionItem(1, {
          target: followUpTarget,
          primaryAction: command('open', 'Open issue', followUpTarget),
          secondaryActions: [command('capture_follow_up', 'Follow up', followUpTarget)],
        }),
      ],
    }));
    renderToday();

    fireEvent.click((await screen.findAllByLabelText('More actions'))[0]!);
    fireEvent.click(screen.getAllByRole('button', { name: /^follow up$/i })[0]!);
    expect(await screen.findByRole('dialog', { name: /capture follow-up/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Follow-up title'), { target: { value: 'Check API rollout' } });
    fireEvent.click(screen.getByRole('button', { name: /save follow-up/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/manager-actions/commands', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Check API rollout'),
      }));
    });
    const postCall = fetchMock.mock.calls.find(([url, init]) => (
      url === '/api/manager-actions/commands' && (init as RequestInit | undefined)?.method === 'POST'
    ));
    expect(JSON.parse((postCall?.[1] as RequestInit).body as string).command.target).toMatchObject({
      issueKey: 'AM-1',
      relatedIssueKeys: ['AM-2'],
    });
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('captures a meeting outcome through the Today dialog', async () => {
    const meetingTarget = target({ type: 'meeting', view: 'meetings', managerDeskItemId: 91, date: '2026-03-08' });
    const fetchMock = mockFetch(todayResponse({
      meetingPrompts: [
        {
          id: 'meeting-91',
          title: 'Payments sync',
          detail: 'Outcome missing',
          severity: 'warning',
          target: meetingTarget,
          primaryAction: command('capture_meeting_outcome', 'Capture outcome', meetingTarget),
          secondaryActions: [],
        },
      ],
    }));
    renderToday();

    fireEvent.click(await screen.findByRole('button', { name: /^meetings 1$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /capture outcome/i }));
    fireEvent.change(screen.getByLabelText('Meeting outcome'), { target: { value: 'Decision approved' } });
    fireEvent.click(screen.getByRole('button', { name: /save outcome/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/manager-actions/commands', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Decision approved'),
      }));
    });
  });

  it('adds a developer check-in from People Pulse', async () => {
    const fetchMock = mockFetch(todayResponse());
    renderToday();

    fireEvent.click(await screen.findByRole('button', { name: /^Check-in$/i }));
    expect(await screen.findByText('Saves to Team / Alice Smith / Check-ins for today.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Check-in note'), { target: { value: 'Asked for update' } });
    fireEvent.click(screen.getByRole('button', { name: /save check-in/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/manager-actions/commands', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Asked for update'),
      }));
    });
  });

  it('sends the picked task key with a developer check-in', async () => {
    const board = {
      date: '2026-03-08',
      viewMode: 'live',
      developers: [
        {
          id: 1,
          date: '2026-03-08',
          developer: { accountId: 'dev-1', displayName: 'Alice Smith', isActive: true },
          availability: { state: 'active' },
          status: 'on_track',
          plannedItems: [
            {
              id: 10,
              dayId: 1,
              lifecycle: 'tracker_only',
              itemType: 'custom',
              taskKey: 'T-10',
              title: 'Refactor utils',
              state: 'planned',
              position: 0,
              createdAt: '2026-03-08T08:00:00Z',
              updatedAt: '2026-03-08T08:00:00Z',
            },
          ],
          completedItems: [],
          droppedItems: [],
          checkIns: [],
          recentCheckIns: [],
          isStale: false,
          signals: {
            freshness: { staleThresholdHours: 4, noCurrentThresholdHours: 2, statusFollowUpThresholdHours: 2 },
            risk: { openRisk: false, overdueLinkedWork: false, overdueLinkedCount: 0 },
          },
          statusUpdatedAt: '2026-03-08T08:00:00Z',
          createdAt: '2026-03-08T08:00:00Z',
          updatedAt: '2026-03-08T08:00:00Z',
        },
      ],
      inactiveDevelopers: [],
      summary: {},
      visibleSummary: {},
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/today')) {
        return new Response(JSON.stringify(todayResponse()), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/api/team-tracker')) {
        return new Response(JSON.stringify(board), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderToday();

    fireEvent.click(await screen.findByRole('button', { name: /^Check-in$/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'T-10' }));
    fireEvent.change(screen.getByLabelText('Check-in note'), { target: { value: 'How is this going?' } });
    fireEvent.click(screen.getByRole('button', { name: /save check-in/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/manager-actions/commands', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"taskKeys":["T-10"]'),
      }));
    });
  });

  it('shows Open developer after a same-day check-in clears the check-in action', async () => {
    const devTarget = target({ type: 'developer', view: 'team', developerAccountId: 'dev-1', date: '2026-03-08' });
    const beforeAction = actionItem(1, {
      id: 'dev-no-current',
      type: 'developer_attention',
      title: 'Alice Smith',
      context: 'No current work',
      signal: 'No current item',
      target: devTarget,
      primaryAction: command('add_check_in', 'Add check-in', devTarget),
      secondaryActions: [],
    });
    const afterAction = {
      ...beforeAction,
      primaryAction: command('open', 'Open developer', devTarget),
    };
    let response = todayResponse({
      currentPriority: beforeAction,
      actionItems: [beforeAction],
      teamPulse: [
        {
          accountId: 'dev-1',
          displayName: 'Alice Smith',
          initials: 'AS',
          status: 'On track',
          tone: 'info',
          detail: 'No current item',
          currentWork: 'No current work',
          lastUpdate: 'No check-in',
          target: devTarget,
          primaryAction: command('add_check_in', 'Check-in', devTarget),
          secondaryActions: [],
        },
      ],
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/today')) {
        return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/api/manager-actions/commands')) {
        response = {
          ...response,
          currentPriority: afterAction,
          actionItems: [afterAction],
          teamPulse: response.teamPulse.map((person) => ({
            ...person,
            lastUpdate: 'Just now',
            primaryAction: command('open', 'Open', devTarget),
          })),
        };
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    renderToday();

    fireEvent.click((await screen.findAllByRole('button', { name: /^Add check-in$/i }))[0]!);
    fireEvent.change(screen.getByLabelText('Check-in note'), { target: { value: 'Asked about next work' } });
    fireEvent.click(screen.getByRole('button', { name: /save check-in/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Add check-in$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Check-in$/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Open developer$/i })).toBeInTheDocument();
    });
  });

  it('sets planned work current when Today chooses Set current for a developer', async () => {
    const setCurrentTarget = target({
      type: 'tracker_item',
      view: 'team',
      developerAccountId: 'dev-1',
      trackerItemId: 77,
      date: '2026-03-08',
    });
    const fetchMock = mockFetch(todayResponse({
      actionItems: [
        actionItem(1, {
          id: 'dev-set-current',
          type: 'developer_attention',
          title: 'Alice Smith',
          context: 'No current work',
          signal: 'No current item',
          actionPreview: 'AM-77 Checkout retry fix',
          target: setCurrentTarget,
          primaryAction: command('set_current_work', 'Set current', setCurrentTarget),
          secondaryActions: [],
        }),
      ],
    }));
    renderToday();

    expect(await screen.findAllByText('AM-77 Checkout retry fix')).not.toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: /^Set current$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/manager-actions/commands', expect.objectContaining({
        body: expect.stringContaining('"kind":"set_current_work"'),
        method: 'POST',
      }));
    });
  });

  it('does not leave Set current rows stuck in Working', async () => {
    const setCurrentTarget = target({
      type: 'tracker_item',
      view: 'team',
      developerAccountId: 'dev-1',
      trackerItemId: 77,
      date: '2026-03-08',
    });
    const response = todayResponse({
      actionItems: [
        actionItem(1, {
          id: 'dev-set-current',
          type: 'developer_attention',
          title: 'Alice Smith',
          context: 'No current work',
          signal: 'No current item',
          target: setCurrentTarget,
          primaryAction: command('set_current_work', 'Set current', setCurrentTarget),
          secondaryActions: [],
        }),
      ],
    });
    let resolveSetCurrent: (() => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/today')) {
        return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/api/manager-actions/commands')) {
        await new Promise<void>((resolve) => {
          resolveSetCurrent = resolve;
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    renderToday();

    fireEvent.click(await screen.findByRole('button', { name: /^Set current$/i }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Set current$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Working$/i })).not.toBeInTheDocument();
    });

    resolveSetCurrent?.();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Working$/i })).not.toBeInTheDocument();
    });
  });
});
