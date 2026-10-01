import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/context/ToastContext';
import { QuickActionsProvider } from '@/context/QuickActionsContext';
import { TodayPage } from '@/components/today/TodayPage';
import { createTestQueryClient } from '@/test/wrapper';
import type { TodayActionItem, TodayResponse } from '@/types';

// docs/56 P1-04: these suites describe the collab check-in UI; solo cases flip the mode.
const teamModeMock = vi.hoisted(() => ({ mode: 'collab' as 'solo' | 'collab' }));
vi.mock('@/hooks/useTeamMode', () => ({
  useTeamMode: () => teamModeMock.mode,
  useSetTeamMode: () => ({ mutate: vi.fn(), isPending: false }),
}));

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
        participates: true,
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

function renderToday(response = todayResponse(), onOpenTodayTarget = vi.fn(), openCapture = vi.fn()) {
  const queryClient = createTestQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <QuickActionsProvider value={{ openCapture, openCommandPalette: vi.fn() }}>
        <ToastProvider>
          <TodayPage onViewChange={vi.fn()} onOpenTodayTarget={onOpenTodayTarget} />
        </ToastProvider>
      </QuickActionsProvider>
    </QueryClientProvider>,
  );
  return { onOpenTodayTarget, openCapture };
}

describe('TodayPage V2', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    teamModeMock.mode = 'collab';
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('shows the shaped Today skeleton while the first request is pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));

    renderToday();

    expect(screen.getByRole('status', { name: 'Loading Today' })).toBeInTheDocument();
    expect(screen.queryByText('Building the action queue.')).not.toBeInTheDocument();
  });

  it('renders the action queue with a visible row limit', async () => {
    const response = todayResponse({ actionItems: Array.from({ length: 15 }, (_, index) => actionItem(index + 1)) });
    mockFetch(response);
    renderToday(response);

    expect(await screen.findByRole('heading', { name: 'Queue' })).toBeInTheDocument();
    expect(screen.getAllByTestId('today-action-row')).toHaveLength(12);
    expect(screen.getByRole('button', { name: '+3 more' })).toBeInTheDocument();
  });

  it('expands "+N more" in place, grouped Now / Next / Later, with the server total (docs/53 F13)', async () => {
    const response = todayResponse();
    const overflow = [
      actionItem(20, { id: 'overflow-next', group: 'next', title: 'AM-20 Next row' }),
      actionItem(21, { id: 'overflow-later', group: 'later', title: 'AM-21 Later row' }),
    ];
    mockFetch({ ...response, overflowActionItems: overflow, totalCount: 15 });
    renderToday();

    fireEvent.click(await screen.findByRole('button', { name: '+3 more' }));

    expect(screen.getAllByTestId('today-action-row')).toHaveLength(13);
    expect(screen.queryByRole('group', { name: /^Now/ })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Later (1)' })).toHaveTextContent('AM-21 Later row');
    // Two rows are still past the shipped overflow cap.
    expect(screen.getByRole('button', { name: /Show less · 2 more/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('sends the browser time zone with the Today read (docs/53 F5)', async () => {
    const fetchMock = mockFetch(todayResponse());
    renderToday();
    await screen.findByRole('heading', { name: 'Queue' });
    const todayCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/api/today'));
    expect(String(todayCall?.[0])).toMatch(/[?&]tz=/);
  });

  it('keyboard triage: j/k move the cursor, e runs the primary action, Enter opens (docs/53 U4)', async () => {
    const { onOpenTodayTarget } = renderToday(todayResponse(), vi.fn());
    mockFetch(todayResponse());
    await screen.findByRole('heading', { name: 'Queue' });

    fireEvent.keyDown(window, { key: 'j' });
    expect(screen.getAllByTestId('today-action-row')[0]).toHaveAttribute('data-keyboard-active', 'true');
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'j' });
    expect(screen.getAllByTestId('today-action-row')[1]).toHaveAttribute('aria-current', 'true');

    // Row 2 is the follow-up whose fixture primary is confirm-gated (old server shape).
    fireEvent.keyDown(window, { key: 'e' });
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });

    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onOpenTodayTarget).toHaveBeenCalledWith(expect.objectContaining({ issueKey: 'AM-1' }));
  });

  describe('keyboard ownership (docs/63 #3)', () => {
    const rowsOf = () => screen.getAllByTestId('today-action-row');

    it('j and k move real focus to the row, so Tab and native activation continue from it', async () => {
      mockFetch(todayResponse());
      renderToday();
      await screen.findByRole('heading', { name: 'Queue' });

      fireEvent.keyDown(window, { key: 'j' });
      expect(document.activeElement).toBe(within(rowsOf()[0]!).getByText('AM-1 Issue 1').closest('button'));
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(rowsOf()[1]!.querySelector('[data-row-link]'));
      expect(rowsOf()[1]).toHaveAttribute('data-keyboard-active', 'true');
      fireEvent.keyDown(document.activeElement!, { key: 'k' });
      expect(document.activeElement).toBe(rowsOf()[0]!.querySelector('[data-row-link]'));
    });

    it('Space on a focused button is never a second action on the cursor row', async () => {
      mockFetch(todayResponse());
      const { onOpenTodayTarget } = renderToday(todayResponse(), vi.fn());
      await screen.findByRole('heading', { name: 'Queue' });

      // Cursor on row 2 (a confirm-gated Done), focus then Tabs to row 1's own button.
      fireEvent.keyDown(window, { key: 'j' });
      fireEvent.keyDown(window, { key: 'j' });
      const rowOneButton = within(rowsOf()[0]!).getByRole('button', { name: 'Open issue' });
      rowOneButton.focus();
      fireEvent.keyDown(rowOneButton, { key: ' ' });
      fireEvent.keyDown(rowOneButton, { key: 'Enter' });

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(onOpenTodayTarget).not.toHaveBeenCalled();
    });

    it('a letter shortcut acts on the focused row, not the row the cursor was left on', async () => {
      mockFetch(todayResponse());
      const { onOpenTodayTarget } = renderToday(todayResponse(), vi.fn());
      await screen.findByRole('heading', { name: 'Queue' });

      fireEvent.keyDown(window, { key: 'j' });
      fireEvent.keyDown(window, { key: 'j' }); // cursor: row 2
      const link = rowsOf()[0]!.querySelector<HTMLElement>('[data-row-link]')!;
      link.focus();
      fireEvent.keyDown(link, { key: 'e' });

      expect(onOpenTodayTarget).toHaveBeenCalledWith(expect.objectContaining({ issueKey: 'AM-1' }));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('does not run queue shortcuts from a control in the side panel', async () => {
      const oneOnOne = target({ type: 'developer', developerAccountId: 'dev-9', panel: 'one-on-one' });
      const response = todayResponse();
      response.actionItems = [
        ...response.actionItems,
        actionItem(40, { id: 'one-on-one-1', type: 'one_on_one', title: '1:1 with Ayan today', target: oneOnOne, primaryAction: command('open', 'Open 1:1', oneOnOne), secondaryActions: [] }),
      ];
      mockFetch(response);
      const { onOpenTodayTarget } = renderToday(response, vi.fn());
      await screen.findByRole('heading', { name: 'Queue' });

      fireEvent.keyDown(window, { key: 'j' });
      const panel = screen.getByRole('complementary');
      const control = within(panel).getAllByRole('button')[0]!;
      control.focus();
      for (const key of ['e', 's', 'f', 'c', ' ', 'Enter']) fireEvent.keyDown(control, { key });

      expect(onOpenTodayTarget).not.toHaveBeenCalled();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('runs undoable writes without confirm, offers a 6s Undo, and z posts the restore (docs/53 F11)', async () => {
    const followUpTarget = target({ type: 'follow_up', view: 'follow-ups', managerDeskItemId: 44, date: '2026-03-08' });
    const undoRequest = {
      date: '2026-03-08',
      command: { kind: 'restore', label: 'Undo', target: followUpTarget },
      restore: { type: 'desk_item', managerDeskItemId: 44, patch: { status: 'planned' } },
    };
    const response = todayResponse();
    response.actionItems[1] = {
      ...response.actionItems[1]!,
      primaryAction: { kind: 'mark_done', label: 'Done', target: followUpTarget, confirm: false, undoable: true },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/today')) {
        return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { command?: { kind?: string } };
      const payload = body.command?.kind === 'mark_done'
        ? { success: true, command: 'mark_done', target: followUpTarget, undo: { label: 'Undo', request: undoRequest } }
        : { success: true, command: 'restore', target: followUpTarget };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderToday(response);

    await screen.findByRole('heading', { name: 'Queue' });
    fireEvent.click(within(screen.getAllByTestId('today-action-row')[1]!).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
    const commandCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input).includes('/api/manager-actions/commands') && String(init?.body).includes('"kind":"mark_done"'));
    expect(String(commandCall?.[1]?.body)).toContain('"tz":');

    fireEvent.keyDown(window, { key: 'z' });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/manager-actions/commands'),
        expect.objectContaining({ body: expect.stringContaining('"kind":"restore"') }),
      );
    });
    expect(await screen.findByText('Undone')).toBeInTheDocument();
  });

  it('Ask for update posts a write and stamps askedAt optimistically (docs/53 F15)', async () => {
    const devTarget = target({ type: 'developer', view: 'team', developerAccountId: 'dev-1', date: '2026-03-08' });
    const response = todayResponse({
      actionItems: [actionItem(1, {
        id: 'today-dev-dev-1-stale',
        type: 'stale_check_in',
        title: 'Alice Smith',
        target: devTarget,
        primaryAction: { kind: 'add_check_in', label: 'Add check-in', target: devTarget },
        secondaryActions: [{ kind: 'ask_check_in', label: 'Ask for update', target: devTarget, confirm: false, undoable: true }],
      })],
    });
    const fetchMock = mockFetch(response);
    const { onOpenTodayTarget } = renderToday(response);

    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Alice Smith' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ask for update' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/manager-actions/commands'),
        expect.objectContaining({ body: expect.stringContaining('"kind":"ask_check_in"') }),
      );
    });
    expect(onOpenTodayTarget).not.toHaveBeenCalled();
  });

  it('meeting outcome dialog sends an optional next action with its owner (docs/53 F14)', async () => {
    const meetingTarget = target({ type: 'meeting', view: 'meetings', managerDeskItemId: 70, date: '2026-03-08' });
    const response = todayResponse({
      actionItems: [actionItem(1, {
        id: 'meeting-70',
        type: 'meeting_outcome',
        title: 'Migration review',
        target: meetingTarget,
        primaryAction: { kind: 'capture_meeting_outcome', label: 'Capture outcome', target: meetingTarget },
        secondaryActions: [],
      })],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/today')) {
        return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/api/team-tracker')) {
        return new Response(JSON.stringify({
          date: '2026-03-08',
          developers: [{ developer: { accountId: 'dev-1', displayName: 'Alice Smith' }, plannedItems: [], checkIns: [] }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderToday(response);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Capture outcome' }))[0]!);
    fireEvent.change(await screen.findByLabelText('Meeting outcome'), { target: { value: 'Go Friday' } });
    fireEvent.change(screen.getByLabelText('Next action (optional)'), { target: { value: 'Draft rollback plan' } });
    await screen.findByRole('option', { name: 'Alice Smith' });
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'dev-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save outcome' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input, init]) =>
        String(input).includes('/api/manager-actions/commands') && String((init as RequestInit | undefined)?.body).includes('capture_meeting_outcome'));
      expect(String((call?.[1] as RequestInit | undefined)?.body)).toContain('"nextAction":"Draft rollback plan"');
      expect(String((call?.[1] as RequestInit | undefined)?.body)).toContain('"nextActionOwnerAccountId":"dev-1"');
    });
  });

  it('opens the exact issue target from a row', async () => {
    mockFetch(todayResponse());
    const onOpenTodayTarget = vi.fn();
    renderToday(todayResponse(), onOpenTodayTarget);

    // docs/53 A2: the row's one link opens the target.
    fireEvent.click(await screen.findByRole('button', { name: /^(start here: )?am-1 issue 1/i }));

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

    // An open-only row has no separate primary button — the row link is it.
    expect(screen.queryByRole('button', { name: /^open task$/i })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /^(start here: )?t-7 checkout follow-up/i }));

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

    expect(await screen.findByRole('alertdialog', { name: /mark done/i })).toBeInTheDocument();
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

    // docs/53 A1: a real menu — items only exist while it's open.
    expect(screen.queryByRole('menuitem', { name: /tomorrow/i })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Follow up with QA' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /tomorrow/i }));

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

    fireEvent.click(await screen.findByRole('button', { name: 'More actions for AM-1 Issue 1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^follow up/i }));
    expect(await screen.findByRole('dialog', { name: /capture follow-up/i })).toBeInTheDocument();
    // docs/53 F16: the default title uses what Today knows.
    expect(screen.getByLabelText('Follow-up title')).toHaveValue('Follow up on AM-1');
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

    // docs/53 U7: one "Promises & meetings" list, no tabs.
    expect(await screen.findByRole('heading', { name: 'Promises & meetings' })).toBeInTheDocument();
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
    const dialog = await screen.findByRole('dialog', { name: 'Add check-in' });
    expect(dialog).toHaveTextContent('Alice Smith');
    // docs/53 F15: the signal is a placeholder, never a pre-filled value.
    expect(screen.getByLabelText('Check-in note')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Check-in note'), { target: { value: 'Asked for update' } });
    fireEvent.click(screen.getByRole('button', { name: /save check-in/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/manager-actions/commands', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Asked for update'),
      }));
    });
  });

  it('solo: the pulse action and dialog say "note", and the write is still the same command (P1-04)', async () => {
    teamModeMock.mode = 'solo';
    const fetchMock = mockFetch(todayResponse());
    renderToday();

    expect(screen.queryByRole('button', { name: /^Check-in$/i })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /^Note$/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Add note' });
    expect(dialog).toHaveTextContent('Alice Smith');
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Talked through the migration' } });
    fireEvent.click(screen.getByRole('button', { name: /save note/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/manager-actions/commands', expect.objectContaining({
        body: expect.stringContaining('"kind":"add_check_in"'),
      }));
    });
    expect(await screen.findByText('Note added')).toBeInTheDocument();
  });

  it('collab: a developer without a login gets "note" while a participating one keeps "check-in" (P1-04)', async () => {
    const devTarget = (id: string) => target({ type: 'developer', view: 'team', developerAccountId: id, date: '2026-03-08' });
    const pulse = (accountId: string, displayName: string, participates: boolean) => ({
      accountId,
      displayName,
      initials: displayName.slice(0, 2).toUpperCase(),
      participates,
      status: 'Blocked',
      tone: 'critical' as const,
      detail: 'Blocked',
      currentWork: 'No current work',
      lastUpdate: '1d ago',
      target: devTarget(accountId),
      primaryAction: command('add_check_in', 'Check-in', devTarget(accountId)),
      secondaryActions: [],
    });
    mockFetch(todayResponse({ teamPulse: [pulse('dev-1', 'Alice Smith', true), pulse('dev-2', 'Bob Jones', false)] }));
    renderToday();

    expect(await screen.findByRole('button', { name: /^Check-in$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Note$/i })).toBeInTheDocument();
  });

  it('solo: the wrap-up states exactly what is clear, with no check-in block (P1-04)', async () => {
    teamModeMock.mode = 'solo';
    const response = todayResponse({
      rhythm: { stage: 'wrap_up', label: 'Wrap-up', detail: 'Close loops' },
      focus: {
        stage: 'wrap_up',
        wrapUp: { missingCheckIns: [], openPromises: [], carryCandidates: [], eodNoteTarget: target({ view: 'notes', date: '2026-03-08' }) },
      },
    });
    mockFetch(response);
    renderToday(response);

    const panel = await screen.findByRole('complementary', { name: 'Wrap-up panel' });
    expect(within(panel).getByText('No open promises, carry-over or missing check-ins.')).toBeInTheDocument();
    expect(within(panel).queryByText(/Loops closed/)).not.toBeInTheDocument();
    expect(within(panel).queryByText(/No check-in today/)).not.toBeInTheDocument();
  });

  describe('weekly review row (docs/59 §5.1)', () => {
    const wrapUpFocus = {
      stage: 'wrap_up' as const,
      wrapUp: { missingCheckIns: [], openPromises: [], carryCandidates: [], eodNoteTarget: target({ view: 'notes', date: '2026-03-08' }) },
    };

    it('leads the wrap-up panel on the review day', async () => {
      teamModeMock.mode = 'solo';
      const response = todayResponse({
        rhythm: { stage: 'wrap_up', label: 'Wrap-up', detail: 'Close loops' },
        focus: wrapUpFocus,
        weeklyReview: { due: true, weekStart: '2026-03-02' },
      });
      mockFetch(response);
      renderToday(response);

      const panel = await screen.findByRole('complementary', { name: 'Wrap-up panel' });
      const row = within(panel).getByTestId('today-weekly-review');
      expect(within(row).getByRole('button', { name: 'Start review' })).toBeInTheDocument();
      // First in the panel, ahead of the wrap-up block itself.
      const sections = [...panel.querySelectorAll('section')];
      expect(sections[0]).toBe(row);
    });

    it('shows the catch-up in the morning panel, and nothing when the server offers nothing', async () => {
      teamModeMock.mode = 'solo';
      const morning = todayResponse({ weeklyReview: { due: true, catchUp: true, weekStart: '2026-03-02' } });
      mockFetch(morning);
      renderToday(morning);
      expect(await screen.findByText('Review last week')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Not this week' })).toBeInTheDocument();
      cleanup();

      const plain = todayResponse({
        rhythm: { stage: 'wrap_up', label: 'Wrap-up', detail: 'Close loops' },
        focus: wrapUpFocus,
      });
      mockFetch(plain);
      renderToday(plain);
      await screen.findByRole('complementary', { name: 'Wrap-up panel' });
      expect(screen.queryByTestId('today-weekly-review')).not.toBeInTheDocument();
    });
  });

  describe('getting started (docs/56 P2-02)', () => {
    const fresh = { people: false, tasks: false, jira: false, rhythm: false };

    it('shows the four first-run steps and opens each one', async () => {
      const response = todayResponse({ gettingStarted: fresh });
      mockFetch(response);
      const { onOpenTodayTarget, openCapture } = renderToday(response);

      const card = await screen.findByTestId('today-getting-started');
      expect(within(card).getByText('0 of 4')).toBeInTheDocument();
      for (const title of ['Capture a task', 'Add people', 'Connect Jira', 'Set your day rhythm']) {
        expect(within(card).getByText(title)).toBeInTheDocument();
      }

      fireEvent.click(within(card).getByRole('button', { name: 'Capture' }));
      expect(openCapture).toHaveBeenCalledTimes(1);
      fireEvent.click(within(card).getByRole('button', { name: 'Add' }));
      expect(onOpenTodayTarget).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'settings', section: 'team' }));
      fireEvent.click(within(card).getByRole('button', { name: 'Connect' }));
      expect(onOpenTodayTarget).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'settings', section: 'connection' }));
      fireEvent.click(within(card).getByRole('button', { name: 'Set times' }));
      expect(onOpenTodayTarget).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'settings', section: 'rhythm' }));
    });

    it('ticks finished steps and drops their button', async () => {
      const response = todayResponse({ gettingStarted: { people: true, tasks: true, jira: false, rhythm: false } });
      mockFetch(response);
      renderToday(response);

      const card = await screen.findByTestId('today-getting-started');
      expect(within(card).getByText('2 of 4')).toBeInTheDocument();
      expect(within(card).queryByRole('button', { name: 'Capture' })).not.toBeInTheDocument();
      expect(within(card).queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
      expect(within(card).getByRole('button', { name: 'Connect' })).toBeInTheDocument();
      expect(within(card).getAllByText('(done)')).toHaveLength(2);
    });

    it('is absent once everything is done, and when the server sends no checklist', async () => {
      const done = todayResponse({ gettingStarted: { people: true, tasks: true, jira: true, rhythm: true } });
      mockFetch(done);
      const first = renderToday(done);
      await screen.findByRole('heading', { name: 'Queue' });
      expect(screen.queryByTestId('today-getting-started')).not.toBeInTheDocument();
      void first;
    });

    it('does not show without a checklist in the response', async () => {
      const response = todayResponse();
      mockFetch(response);
      renderToday(response);
      await screen.findByRole('heading', { name: 'Queue' });
      expect(screen.queryByTestId('today-getting-started')).not.toBeInTheDocument();
    });

    it('Dismiss hides it and the choice survives a reload', async () => {
      const response = todayResponse({ gettingStarted: fresh });
      mockFetch(response);
      const view = renderToday(response);

      fireEvent.click(await screen.findByRole('button', { name: 'Dismiss getting started' }));
      expect(screen.queryByTestId('today-getting-started')).not.toBeInTheDocument();
      void view;
      cleanup();

      mockFetch(response);
      renderToday(response);
      await screen.findByRole('heading', { name: 'Queue' });
      expect(screen.queryByTestId('today-getting-started')).not.toBeInTheDocument();
    });
  });

  it('posts a check-in on Enter, like every other check-in composer (docs/54 K3)', async () => {
    const fetchMock = mockFetch(todayResponse());
    renderToday();

    fireEvent.click(await screen.findByRole('button', { name: /^Check-in$/i }));
    await screen.findByRole('dialog', { name: 'Add check-in' });
    const note = screen.getByLabelText('Check-in note');
    fireEvent.change(note, { target: { value: 'Pairing on the migration' } });
    fireEvent.keyDown(note, { key: 'Enter', shiftKey: true });
    expect(fetchMock).not.toHaveBeenCalledWith('/api/manager-actions/commands', expect.anything());
    fireEvent.keyDown(note, { key: 'Enter' });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/manager-actions/commands', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Pairing on the migration'),
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
          participates: true,
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
    });
    // The row stays with its next step; Alice is in the queue, so no separate People row.
    expect(screen.getByRole('button', { name: /^Open developer$/i })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'People' })).not.toBeInTheDocument();
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

  it('the first queue row is the priority: its link opens, only its primary button writes (docs/53 U1/F10)', async () => {
    const priorityTarget = target({ type: 'follow_up', view: 'follow-ups', managerDeskItemId: 44, date: '2026-03-08' });
    const priority = actionItem(99, {
      id: 'priority-1',
      type: 'follow_up_due',
      title: 'Priority pick',
      target: priorityTarget,
      primaryAction: command('mark_done', 'Mark done now', priorityTarget),
      secondaryActions: [],
    });
    const response = todayResponse({ currentPriority: priority, actionItems: [priority, actionItem(2)] });
    const fetchMock = mockFetch(response);
    const onOpenTodayTarget = vi.fn();
    renderToday(response, onOpenTodayTarget);

    const rows = await screen.findAllByTestId('today-action-row');
    expect(rows[0]).toHaveAttribute('data-featured', 'true');
    expect(rows[1]).not.toHaveAttribute('data-featured');
    // No separate "Start" band duplicating the first row.
    expect(screen.getAllByText('Priority pick')).toHaveLength(1);

    fireEvent.click(within(rows[0]!).getByRole('button', { name: /^start here: priority pick/i }));
    expect(onOpenTodayTarget).toHaveBeenCalledWith(expect.objectContaining({ managerDeskItemId: 44 }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input, init]) =>
        String(input) === '/api/manager-actions/commands' && (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(false);

    fireEvent.click(within(rows[0]!).getByRole('button', { name: /^mark done now$/i }));
    expect(await screen.findByRole('alertdialog', { name: /mark done\?/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Mark done$/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/manager-actions/commands', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"kind":"mark_done"'),
      }));
    });
  });

  it('keeps the follow-up dialog open with an inline error when the command fails (docs/53 F9)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/today')) {
        return new Response(JSON.stringify(todayResponse()), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === '/api/manager-actions/commands') {
        return new Response(JSON.stringify({ error: 'Desk unavailable' }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderToday();

    fireEvent.click(await screen.findByRole('button', { name: 'More actions for AM-1 Issue 1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^follow up/i }));
    expect(await screen.findByRole('dialog', { name: /capture follow-up/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Follow-up title'), { target: { value: 'Check API rollout' } });
    fireEvent.click(screen.getByRole('button', { name: /save follow-up/i }));

    expect(await screen.findByText('Desk unavailable')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /capture follow-up/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Follow-up title')).toHaveValue('Check API rollout');
  });

  it('keeps the check-in dialog open with an inline error when the command fails (docs/53 F9)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/today')) {
        return new Response(JSON.stringify(todayResponse()), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === '/api/manager-actions/commands') {
        return new Response(JSON.stringify({ error: 'Tracker write failed' }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderToday();

    fireEvent.click(await screen.findByRole('button', { name: /^Check-in$/i }));
    fireEvent.change(screen.getByLabelText('Check-in note'), { target: { value: 'Still working?' } });
    fireEvent.click(screen.getByRole('button', { name: /save check-in/i }));

    expect(await screen.findByText('Tracker write failed')).toBeInTheDocument();
    expect(screen.getByLabelText('Check-in note')).toHaveValue('Still working?');
  });

  describe('stage-driven layout (docs/53 §2/§3/§5)', () => {
    const serverSummary: TodayResponse['summary'] = [
      { id: 'attention', label: 'Attention', value: 11, detail: 'action rows', severity: 'warning' },
      { id: 'work', label: 'Active defects', value: 5, detail: 'in Work', severity: 'neutral' },
      { id: 'team', label: 'People', value: 7, detail: 'on team', severity: 'info' },
      { id: 'stale', label: 'Stale check-ins', value: 2, detail: 'need update', severity: 'warning', target: target({ filter: undefined }) },
      { id: 'due-work', label: 'Due today', value: 1, detail: 'defects', severity: 'warning', target: target({ view: 'work', filter: 'dueToday' }) },
      { id: 'promises', label: 'Follow-ups', value: 4, detail: 'due now', severity: 'warning', target: target({ view: 'follow-ups' }) },
    ];

    it('header band: stage first, four decision metrics, no inventory tiles (D2/U3)', async () => {
      const response = todayResponse({
        summary: serverSummary,
        rhythm: { stage: 'standup_window', label: 'Standup window', detail: 'Clear blockers', nextStage: { stage: 'midday_check', startsAt: new Date(2026, 2, 8, 12, 0).toISOString() } },
      });
      mockFetch(response);
      renderToday(response);

      const band = await screen.findByRole('region', { name: 'Today summary' });
      expect(band.textContent?.startsWith('Standup window')).toBe(true);
      expect(within(band).getByText('until 12:00')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Today/);
      for (const name of ['11 open', '2 stale', '1 due', '4 follow-ups']) {
        expect(within(band).getByRole('button', { name })).toBeInTheDocument();
      }
      expect(within(band).queryByText(/active defects|on team/i)).not.toBeInTheDocument();
    });

    it('wrap-up: the stage panel owns promises, so the queue does not repeat them', async () => {
      const followUpTarget = target({ type: 'follow_up', view: 'follow-ups', managerDeskItemId: 44, date: '2026-03-08' });
      const base = todayResponse();
      const response = todayResponse({
        rhythm: { stage: 'wrap_up', label: 'Wrap-up', detail: 'Close loops' },
        focus: {
          stage: 'wrap_up',
          wrapUp: {
            missingCheckIns: [{
              accountId: 'dev-2',
              displayName: 'Deepak Rao',
              target: target({ type: 'developer', developerAccountId: 'dev-2' }),
              primaryAction: { kind: 'ask_check_in', label: 'Ask for update', target: target({ type: 'developer', developerAccountId: 'dev-2' }) },
            }],
            openPromises: base.promises,
            carryCandidates: [],
            eodNoteTarget: target({ view: 'notes', date: '2026-03-08' }),
          },
        },
      });
      const fetchMock = mockFetch(response);
      const { onOpenTodayTarget } = renderToday(response);

      const panel = await screen.findByRole('complementary', { name: 'Wrap-up panel' });
      expect(within(panel).getByRole('heading', { name: 'Wrap-up' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Queue' })).toBeInTheDocument();
      // Follow-up 44 lives in the wrap-up block only.
      expect(screen.getAllByText('Follow up with QA')).toHaveLength(1);
      expect(screen.getAllByTestId('today-action-row').some((row) => row.textContent?.includes('Follow up with QA'))).toBe(false);

      fireEvent.click(screen.getByRole('button', { name: 'Ask Deepak Rao for an update' }));
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/manager-actions/commands'),
          expect.objectContaining({ body: expect.stringContaining('"kind":"ask_check_in"') }),
        );
      });

      fireEvent.click(screen.getByRole('button', { name: /write eod note/i }));
      expect(onOpenTodayTarget).toHaveBeenCalledWith(expect.objectContaining({ view: 'notes' }));
      void followUpTarget;
    });

    it('standup: a sealed round shows "Standup ✓ 09:40 · 1 flagged" with the person one tap away (F7)', async () => {
      const flaggedTarget = target({ type: 'developer', developerAccountId: 'dev-2' });
      const response = todayResponse({
        rhythm: { stage: 'standup_window', label: 'Standup window', detail: '' },
        focus: {
          stage: 'standup_window',
          morning: {
            nowCount: 3,
            oneOnOnes: [],
            standup: {
              status: 'completed',
              date: '2026-03-08',
              endedAt: new Date(2026, 2, 8, 9, 40).toISOString(),
              sessionCount: 1,
              reviewedCount: 5,
              flaggedCount: 1,
              flagged: [{ accountId: 'dev-2', displayName: 'Deepak Rao', target: flaggedTarget }],
              target: flaggedTarget,
            },
          },
        },
      });
      mockFetch(response);
      const { onOpenTodayTarget } = renderToday(response);

      const line = await screen.findByRole('region', { name: 'Standup' });
      expect(line).toHaveTextContent('Standup ✓ 09:40');
      expect(line).toHaveTextContent("5 visited in today's rounds · 1 flagged in those rounds");
      fireEvent.click(within(line).getByRole('button', { name: 'Deepak' }));
      expect(onOpenTodayTarget).toHaveBeenCalledWith(expect.objectContaining({ developerAccountId: 'dev-2' }));
    });

    it('since-last-visit sits in the stage panel and deep-links its chips', async () => {
      const response = todayResponse({
        delta: {
          since: new Date(2026, 2, 7, 18, 40).toISOString(),
          newIssues: { count: 0, items: [] },
          overdueOvernight: { count: 1, items: [{ jiraKey: 'AM-3', summary: 'x', target: target({ type: 'issue', view: 'work', issueKey: 'AM-3', filter: 'overdue' }) }] },
          newCheckIns: { count: 0, people: [] },
          followUpsNewlyDue: { count: 0, items: [] },
          resolvedCount: 2,
        },
      });
      mockFetch(response);
      const { onOpenTodayTarget } = renderToday(response);

      const strip = await screen.findByRole('region', { name: 'Since your last visit' });
      expect(strip.closest('aside')).not.toBeNull();
      expect(within(strip).getByRole('button', { name: '2 resolved' })).toBeDisabled();
      fireEvent.click(within(strip).getByRole('button', { name: '1 went overdue' }));
      expect(onOpenTodayTarget).toHaveBeenCalledWith(expect.objectContaining({ issueKey: 'AM-3' }));
    });

    it('an empty queue is a real done state with what comes next (U2)', async () => {
      const calm = actionItem(1, { id: 'today-calm', type: 'calm', title: 'Team is calm', severity: 'success', primaryAction: command('open', 'Open Team', target()), secondaryActions: [] });
      const response = todayResponse({
        actionItems: [calm],
        promises: [],
        totalCount: 0,
        rhythm: { stage: 'midday_check', label: 'Midday check', detail: '', nextStage: { stage: 'wrap_up', startsAt: new Date(2026, 2, 8, 16, 0).toISOString() } },
      });
      mockFetch(response);
      renderToday(response);

      const done = await screen.findByText('Clear for now');
      expect(done.closest('[role="status"]')).toHaveTextContent('Next: Wrap-up at 16:00');
      expect(screen.queryAllByTestId('today-action-row')).toHaveLength(0);
    });

    it('? opens the shortcuts sheet', async () => {
      mockFetch(todayResponse());
      renderToday(todayResponse());
      await screen.findByRole('heading', { name: 'Queue' });

      fireEvent.keyDown(window, { key: '?' });
      const sheet = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
      expect(sheet).toHaveTextContent('Snooze to tomorrow');
      fireEvent.keyDown(sheet, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument());
    });

    it('keeps focus in the queue after an optimistic removal (A5)', async () => {
      const followUpTarget = target({ type: 'follow_up', view: 'follow-ups', managerDeskItemId: 44, date: '2026-03-08' });
      const response = todayResponse();
      response.actionItems = [
        { ...response.actionItems[1]!, primaryAction: { kind: 'mark_done', label: 'Done', target: followUpTarget, confirm: false, undoable: true } },
        response.actionItems[0]!,
      ];
      // After the write the server no longer returns the done row.
      let served = response;
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/manager-actions/commands')) {
          served = { ...response, actionItems: response.actionItems.slice(1) };
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify(served), { status: 200, headers: { 'content-type': 'application/json' } });
      }));
      renderToday(response);

      const rows = await screen.findAllByTestId('today-action-row');
      const doneButton = within(rows[0]!).getByRole('button', { name: 'Done' });
      within(rows[0]!).getAllByRole('button')[0]!.focus();
      doneButton.focus();
      fireEvent.click(doneButton);

      await waitFor(() => {
        expect(document.activeElement).not.toBe(document.body);
        expect(document.activeElement?.hasAttribute('data-row-link')).toBe(true);
      });
      expect(document.activeElement).toHaveAccessibleName(/am-1 issue 1/i);
    });

    it('folds same-reason people into one row; "Ask all" asks each in one undoable write', async () => {
      const staleRow = (id: string, name: string, priority: number) => {
        const devTarget = target({ type: 'developer', developerAccountId: id });
        return actionItem(priority, {
          id: `stale-${id}`,
          type: 'stale_check_in',
          title: name,
          signal: 'Stale by time',
          severity: 'warning',
          target: devTarget,
          primaryAction: command('add_check_in', 'Add check-in', devTarget),
          secondaryActions: [command('ask_check_in', 'Ask for update', devTarget)],
        });
      };
      const response = todayResponse({
        actionItems: [staleRow('a', 'Ayan Saha', 1), staleRow('d', 'Deepak Rao', 2), staleRow('h', 'Harsha N', 3), actionItem(4)],
        totalCount: 4,
      });
      let undoCount = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/today')) {
          return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as { command?: { kind?: string; target?: unknown } };
        undoCount += 1;
        return new Response(JSON.stringify({
          success: true,
          command: body.command?.kind,
          target: body.command?.target,
          undo: { label: 'Undo', request: { date: '2026-03-08', command: { kind: 'restore', label: 'Undo', target: body.command?.target }, restore: { type: 'check_in_ask', askId: undoCount } } },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      });
      vi.stubGlobal('fetch', fetchMock);
      renderToday(response);

      const group = await screen.findByRole('group', { name: '3 people · Stale by time' });
      expect(screen.getAllByTestId('today-action-row')).toHaveLength(2);
      expect(within(group).getByText('Ayan, Deepak, Harsha')).toBeInTheDocument();

      fireEvent.click(within(group).getByRole('button', { name: /^start here: 3 people/i }));
      expect(screen.getAllByTestId('today-action-row')).toHaveLength(5);

      fireEvent.click(within(group).getByRole('button', { name: 'Ask all' }));
      await waitFor(() => {
        const asks = fetchMock.mock.calls.filter(([, init]) => String((init as RequestInit | undefined)?.body).includes('"kind":"ask_check_in"'));
        expect(asks).toHaveLength(3);
      });
      expect(await screen.findByText('Asked 3 for an update')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await waitFor(() => {
        const restores = fetchMock.mock.calls.filter(([, init]) => String((init as RequestInit | undefined)?.body).includes('"kind":"restore"'));
        expect(restores).toHaveLength(3);
      });
    });

    it('wrap-up previews three carry rows and carries all in one move', async () => {
      const carry = (id: number) => {
        const deskTarget = target({ type: 'manager_desk_item', view: 'desk', managerDeskItemId: id, date: '2026-03-05' });
        return actionItem(id, {
          id: `carry-${id}`,
          type: 'desk_carry_forward',
          title: `Old plan ${id}`,
          context: 'Open Manager Desk item',
          target: deskTarget,
          primaryAction: { kind: 'carry_forward', label: 'Carry to tomorrow', target: deskTarget, toDate: '2026-03-09', undoable: true },
          secondaryActions: [command('mark_done', 'Done', deskTarget)],
        });
      };
      const carries = [60, 61, 62, 63, 64].map(carry);
      const response = todayResponse({
        rhythm: { stage: 'wrap_up', label: 'Wrap-up', detail: '' },
        focus: { stage: 'wrap_up', wrapUp: { missingCheckIns: [], openPromises: [], carryCandidates: carries, eodNoteTarget: target({ view: 'notes' }) } },
      });
      const fetchMock = mockFetch(response);
      renderToday(response);

      const carryGroup = await screen.findByRole('group', { name: 'Carry to tomorrow (5)' });
      expect(within(carryGroup).getAllByTestId('today-compact-row')).toHaveLength(3);
      // Filler context is replaced by where the item came from.
      expect(within(carryGroup).getAllByText('from Thu 5 Mar')).toHaveLength(3);
      fireEvent.click(within(carryGroup).getByRole('button', { name: '+2 more' }));
      expect(within(carryGroup).getAllByTestId('today-compact-row')).toHaveLength(5);

      fireEvent.click(within(carryGroup).getByRole('button', { name: 'Carry all 5' }));
      await waitFor(() => {
        const carried = fetchMock.mock.calls.filter(([, init]) => String((init as RequestInit | undefined)?.body).includes('"kind":"carry_forward"'));
        expect(carried).toHaveLength(5);
        expect(String((carried[0]?.[1] as RequestInit).body)).toContain('"toDate":"2026-03-09"');
      });
      expect(await screen.findByText('Carried 5 to tomorrow')).toBeInTheDocument();
    });

    it('a visit with nothing new is one quiet note in the header; open-only rows keep a button', async () => {
      const oneOnOne = target({ type: 'developer', developerAccountId: 'dev-9', panel: 'one-on-one' });
      const response = todayResponse({
        actionItems: [actionItem(1, { id: 'one-on-one-1', type: 'one_on_one', title: '1:1 with Ayan today', target: oneOnOne, primaryAction: command('open', 'Open 1:1', oneOnOne), secondaryActions: [] })],
        delta: {
          since: new Date(2026, 2, 8, 7, 5).toISOString(),
          newIssues: { count: 0, items: [] },
          overdueOvernight: { count: 0, items: [] },
          newCheckIns: { count: 0, people: [] },
          followUpsNewlyDue: { count: 0, items: [] },
          resolvedCount: 0,
        },
      });
      mockFetch(response);
      renderToday(response);

      const band = await screen.findByRole('region', { name: 'Today summary' });
      expect(within(band).getByText(/No changes since/)).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Since your last visit' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Open 1:1' })).toBeInTheDocument();
    });

    it('the panel owns standup, 1:1s and carry-forward; the queue keeps the decisions', async () => {
      const oneOnOne = target({ type: 'developer', developerAccountId: 'dev-9', panel: 'one-on-one' });
      const standupTarget = target({ mode: 'standup' });
      const carry = (id: number) => {
        const deskTarget = target({ type: 'manager_desk_item', view: 'desk', managerDeskItemId: id, date: '2026-03-05' });
        return actionItem(id, {
          id: `carry-${id}`, type: 'desk_carry_forward', title: `Old plan ${id}`, context: 'Open Manager Desk item', target: deskTarget,
          primaryAction: { kind: 'carry_forward', label: 'Carry forward', target: deskTarget, undoable: true },
          secondaryActions: [command('mark_done', 'Done', deskTarget)],
        });
      };
      const response = todayResponse({
        rhythm: { stage: 'morning_plan', label: 'Morning plan', detail: '' },
        actionItems: [
          actionItem(1),
          actionItem(2, { id: 'today-standup-start', type: 'standup', title: 'Start standup', context: '5 stale', target: standupTarget, primaryAction: command('open', 'Start standup', standupTarget), secondaryActions: [] }),
          actionItem(3, { id: 'one-on-one-1', type: 'one_on_one', title: '1:1 with Ayan today', target: oneOnOne, primaryAction: command('open', 'Open 1:1', oneOnOne), secondaryActions: [] }),
          carry(60), carry(61),
        ],
        focus: { stage: 'morning_plan', morning: { nowCount: 1, oneOnOnes: [], standup: { status: 'not_started', date: '2026-03-08', sessionCount: 0, reviewedCount: 0, flaggedCount: 0, flagged: [], target: standupTarget } } },
      });
      const fetchMock = mockFetch(response);
      const { onOpenTodayTarget } = renderToday(response);

      const panel = await screen.findByRole('complementary', { name: 'Morning plan panel' });
      expect(screen.getAllByTestId('today-action-row')).toHaveLength(1);
      const standup = within(panel).getByRole('region', { name: 'Standup' });
      expect(standup).toHaveTextContent('Not started · 5 stale');
      fireEvent.click(within(standup).getByRole('button', { name: 'Start standup' }));
      expect(onOpenTodayTarget).toHaveBeenCalledWith(expect.objectContaining({ mode: 'standup' }));
      expect(within(panel).getByRole('region', { name: '1:1s' })).toHaveTextContent('1:1 with Ayan today');

      fireEvent.click(within(within(panel).getByRole('region', { name: 'Carry from earlier' })).getByRole('button', { name: 'Carry all 2' }));
      await waitFor(() => {
        const carried = fetchMock.mock.calls.filter(([, init]) => String((init as RequestInit | undefined)?.body).includes('"kind":"carry_forward"'));
        expect(carried).toHaveLength(2);
      });
    });

    it('identical follow-ups fold into one row with "Done all"', async () => {
      const followUp = (id: number) => {
        const deskTarget = target({ type: 'follow_up', view: 'follow-ups', managerDeskItemId: id });
        return actionItem(id, {
          id: `follow-up-${id}`, type: 'follow_up_due', title: 'Standup follow-up: Harsha', signal: 'Overdue follow-up', target: deskTarget,
          primaryAction: { kind: 'mark_done', label: 'Done', target: deskTarget, undoable: true }, secondaryActions: [],
        });
      };
      const response = todayResponse({ actionItems: [followUp(70), followUp(71), actionItem(3)], promises: [] });
      const fetchMock = mockFetch(response);
      renderToday(response);

      const group = await screen.findByRole('group', { name: 'Standup follow-up: Harsha · ×2' });
      expect(screen.getAllByTestId('today-action-row')).toHaveLength(2);
      fireEvent.click(within(group).getByRole('button', { name: 'Done all' }));
      await waitFor(() => {
        const done = fetchMock.mock.calls.filter(([, init]) => String((init as RequestInit | undefined)?.body).includes('"kind":"mark_done"'));
        expect(done).toHaveLength(2);
      });
    });

    it('with nothing for the panel, the queue takes the full width (no empty column)', async () => {
      const response = todayResponse({ promises: [], teamPulse: [], meetingPrompts: [] });
      mockFetch(response);
      renderToday(response);

      await screen.findByRole('heading', { name: 'Queue' });
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
      expect(document.querySelector('.today-body')).toHaveAttribute('data-panel', 'false');
    });
  });
});
