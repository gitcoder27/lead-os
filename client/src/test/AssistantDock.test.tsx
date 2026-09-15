import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantProvider } from '@/context/AssistantContext';
import { AssistantDock } from '@/components/assistant/AssistantDock';
import type { AiAssistantConfig, AssistantStreamEvent } from '@/types';

const mockStream = vi.fn();
const mockGet = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/lib/assistant-stream', () => ({
  streamAssistantEvents: (...args: unknown[]) => mockStream(...args),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuthScopeKey: () => 'test-workspace:test-user:manager:',
}));

const CONFIGURED: AiAssistantConfig = {
  enabled: true,
  hasApiKey: true,
  provider: 'openai-compatible',
  baseUrl: 'https://llm.test/v1',
  model: 'test-model',
  maxToolIterations: 6,
  responseStyle: 'concise',
  suggestFollowups: true,
  providers: [
    { id: 'default', name: 'Default', baseUrl: 'https://llm.test/v1', model: 'test-model', hasApiKey: true },
  ],
  activeProviderId: 'default',
};

function streamEvents(events: AssistantStreamEvent[]) {
  mockStream.mockImplementation(
    (_path: string, _body: unknown, onEvent: (event: AssistantStreamEvent) => void) => {
      for (const event of events) {
        onEvent(event);
      }
      return Promise.resolve();
    },
  );
}

function renderDock(overrides: { onOpenChange?: (open: boolean) => void; onOpenTarget?: (target: unknown) => void } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  const onOpenTarget = overrides.onOpenTarget ?? vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <AssistantProvider isOpen onOpenChange={onOpenChange} onOpenTarget={onOpenTarget}>
        <AssistantDock />
      </AssistantProvider>
    </QueryClientProvider>,
  );
  return { invalidateSpy, onOpenChange, onOpenTarget };
}

describe('AssistantDock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStream.mockReset();
    mockStream.mockResolvedValue(undefined);
    mockGet.mockImplementation((url: string) => {
      if (url === '/config/ai') {
        return Promise.resolve(CONFIGURED);
      }
      if (url === '/assistant/conversations') {
        return Promise.resolve({ conversations: [] });
      }
      return Promise.resolve(undefined);
    });
  });

  it('shows suggestion chips in the empty state and sends a picked suggestion', async () => {
    streamEvents([]);
    renderDock();

    const chip = await screen.findByText('Brief me on today');
    fireEvent.click(chip);

    await waitFor(() => expect(mockStream).toHaveBeenCalledTimes(1));
    const [path, body] = mockStream.mock.calls[0] as [string, { message: string; currentView: string; date: string }];
    expect(path).toBe('/assistant/chat');
    expect(body.message).toBe('Brief me on today');
    expect(body.currentView).toBe(window.location.pathname);
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('sends on Enter and renders the streamed turn with tool chips and an issue link', async () => {
    const events: AssistantStreamEvent[] = [
      { type: 'delta', content: 'Checking…' },
      { type: 'tool_start', toolCallId: 'c1', name: 'get_team_board', label: 'Reading team board…' },
      {
        type: 'tool_end',
        toolCallId: 'c1',
        name: 'get_team_board',
        ok: true,
        summary: 'Read team board (3 developers)',
        durationMs: 4,
      },
      {
        type: 'message',
        message: {
          id: 2,
          conversationId: 7,
          role: 'assistant',
          content: '**3** developers, see AM-12',
          toolCalls: [
            {
              id: 'c1',
              name: 'get_team_board',
              arguments: {},
              confirm: 'never',
              status: 'executed',
              summary: 'Read team board',
            },
          ],
          createdAt: '2026-09-14T10:00:00.000Z',
        },
      },
      { type: 'done', conversationId: 7, status: 'complete' },
    ];
    streamEvents(events);
    const { onOpenTarget } = renderDock();

    const textarea = await screen.findByLabelText('Message Copilot');
    fireEvent.change(textarea, { target: { value: 'team status?' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(await screen.findByText('team status?')).toBeInTheDocument();
    expect(await screen.findByText('get_team_board')).toBeInTheDocument();
    const bold = await screen.findByText('3');
    expect(bold.tagName).toBe('STRONG');

    fireEvent.click(screen.getByRole('button', { name: 'AM-12' }));
    expect(onOpenTarget).toHaveBeenCalledWith({ type: 'issue', view: 'work', issueKey: 'AM-12' });
  });

  it('runs the confirm flow end-to-end and invalidates the affected queries', async () => {
    mockStream.mockImplementation(
      (path: string, _body: unknown, onEvent: (event: AssistantStreamEvent) => void) => {
        if (path === '/assistant/chat') {
          onEvent({
            type: 'action_proposal',
            proposal: {
              conversationId: 7,
              toolCallId: 'tc-1',
              tool: 'create_desk_item',
              summary: "Create follow-up 'Call Alice'",
              preview: { title: 'Call Alice' },
              jiraMutating: false,
              status: 'pending',
            },
          });
          onEvent({
            type: 'message',
            message: {
              id: 3,
              conversationId: 7,
              role: 'assistant',
              content: 'I drafted that for you.',
              toolCalls: [
                {
                  id: 'tc-1',
                  name: 'create_desk_item',
                  arguments: { title: 'Call Alice' },
                  confirm: 'always',
                  status: 'pending',
                  summary: "Create follow-up 'Call Alice'",
                },
              ],
              createdAt: '2026-09-14T10:00:00.000Z',
            },
          });
          onEvent({ type: 'done', conversationId: 7, status: 'awaiting_confirmation' });
          return Promise.resolve();
        }
        onEvent({
          type: 'action_executed',
          conversationId: 7,
          toolCallId: 'tc-1',
          tool: 'create_desk_item',
          ok: true,
          summary: 'Created desk item',
          invalidate: ['manager-desk', 'today'],
        });
        onEvent({
          type: 'message',
          message: {
            id: 4,
            conversationId: 7,
            role: 'assistant',
            content: 'Done — follow-up created.',
            createdAt: '2026-09-14T10:00:01.000Z',
          },
        });
        onEvent({ type: 'done', conversationId: 7, status: 'complete' });
        return Promise.resolve();
      },
    );
    const { invalidateSpy } = renderDock();

    fireEvent.click(await screen.findByText('Brief me on today'));

    expect(await screen.findByText("Create follow-up 'Call Alice'")).toBeInTheDocument();
    expect(screen.queryByText('Changes Jira')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm action' }));

    await waitFor(() => expect(mockStream).toHaveBeenCalledTimes(2));
    const [path, body] = mockStream.mock.calls[1] as [
      string,
      { decision: string; toolCallId: string; conversationId: number },
    ];
    expect(path).toBe('/assistant/actions/confirm');
    expect(body).toMatchObject({ decision: 'confirm', toolCallId: 'tc-1', conversationId: 7 });

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['manager-desk'] }));
    await waitFor(() =>
      expect(screen.queryByText("Create follow-up 'Call Alice'")).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Done — follow-up created.')).toBeInTheDocument();
  });

  it('sends a cancel decision from the proposal card', async () => {
    mockStream.mockImplementation(
      (path: string, _body: unknown, onEvent: (event: AssistantStreamEvent) => void) => {
        if (path === '/assistant/chat') {
          onEvent({
            type: 'action_proposal',
            proposal: {
              conversationId: 7,
              toolCallId: 'tc-1',
              tool: 'add_issue_comment',
              summary: 'Comment on AM-1',
              preview: { jiraKey: 'AM-1', text: 'hi' },
              jiraMutating: true,
              status: 'pending',
            },
          });
          onEvent({ type: 'done', conversationId: 7, status: 'awaiting_confirmation' });
          return Promise.resolve();
        }
        onEvent({ type: 'done', conversationId: 7, status: 'complete' });
        return Promise.resolve();
      },
    );
    renderDock();

    fireEvent.click(await screen.findByText('Brief me on today'));
    expect(await screen.findByText('Changes Jira')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel action' }));

    await waitFor(() => expect(mockStream).toHaveBeenCalledTimes(2));
    const [path, body] = mockStream.mock.calls[1] as [string, { decision: string; toolCallId: string }];
    expect(path).toBe('/assistant/actions/confirm');
    expect(body).toMatchObject({ decision: 'cancel', toolCallId: 'tc-1' });
  });

  it('shows a Thinking state while reasoning deltas stream', async () => {
    mockStream.mockImplementation(
      (_path: string, _body: unknown, onEvent: (event: AssistantStreamEvent) => void) => {
        onEvent({ type: 'reasoning_delta', content: 'working it out' });
        return new Promise(() => undefined);
      },
    );
    renderDock();

    fireEvent.click(await screen.findByText('Brief me on today'));
    expect(await screen.findByText('Thinking…')).toBeInTheDocument();
  });

  it('replaces the Thinking state once content streams', async () => {
    mockStream.mockImplementation(
      (_path: string, _body: unknown, onEvent: (event: AssistantStreamEvent) => void) => {
        onEvent({ type: 'reasoning_delta', content: 'working it out' });
        onEvent({ type: 'delta', content: 'Here is the board.' });
        onEvent({
          type: 'message',
          message: {
            id: 9,
            conversationId: 7,
            role: 'assistant',
            content: 'Here is the board.',
            createdAt: '2026-09-15T10:00:00.000Z',
          },
        });
        onEvent({ type: 'done', conversationId: 7, status: 'complete' });
        return Promise.resolve();
      },
    );
    renderDock();

    fireEvent.click(await screen.findByText('Brief me on today'));
    expect(await screen.findByText('Here is the board.')).toBeInTheDocument();
    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument();
  });

  it('renders follow-up suggestion chips and sends one when clicked', async () => {
    streamEvents([
      {
        type: 'message',
        message: {
          id: 9,
          conversationId: 7,
          role: 'assistant',
          content: 'Two check-ins are stale.',
          createdAt: '2026-09-15T10:00:00.000Z',
        },
      },
      { type: 'done', conversationId: 7, status: 'complete' },
      { type: 'followups', items: ['Nudge the stale ones', 'Show my desk'] },
    ]);
    renderDock();

    fireEvent.click(await screen.findByText('Brief me on today'));
    const chip = await screen.findByText('Nudge the stale ones');
    fireEvent.click(chip);

    await waitFor(() => {
      expect(mockStream).toHaveBeenLastCalledWith(
        '/assistant/chat',
        expect.objectContaining({ conversationId: 7, message: 'Nudge the stale ones' }),
        expect.any(Function),
        expect.any(AbortSignal),
      );
    });
  });

  it('closes on Escape', async () => {
    const onOpenChange = vi.fn();
    renderDock({ onOpenChange });

    expect(await screen.findByText('Copilot')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('expands to a fullscreen overlay and collapses on backdrop click', async () => {
    renderDock();

    fireEvent.click(await screen.findByRole('button', { name: 'Expand Copilot' }));

    expect(await screen.findByTestId('assistant-backdrop')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore dock size' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('assistant-backdrop'));

    await waitFor(() => expect(screen.queryByTestId('assistant-backdrop')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Expand Copilot' })).toBeInTheDocument();
  });

  it('collapses expanded mode on Escape before closing', async () => {
    const onOpenChange = vi.fn();
    renderDock({ onOpenChange });

    fireEvent.click(await screen.findByRole('button', { name: 'Expand Copilot' }));
    expect(await screen.findByTestId('assistant-backdrop')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('assistant-backdrop')).not.toBeInTheDocument());

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('collapses to dock when an issue key is clicked in expanded mode', async () => {
    streamEvents([
      {
        type: 'message',
        message: {
          id: 11,
          conversationId: 7,
          role: 'assistant',
          content: 'Check AM-12 next.',
          createdAt: '2026-09-15T10:00:00.000Z',
        },
      },
      { type: 'done', conversationId: 7, status: 'complete' },
    ]);
    const { onOpenTarget } = renderDock();

    fireEvent.click(await screen.findByText('Brief me on today'));
    fireEvent.click(await screen.findByRole('button', { name: 'Expand Copilot' }));
    expect(await screen.findByTestId('assistant-backdrop')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'AM-12' }));

    expect(onOpenTarget).toHaveBeenCalledWith({ type: 'issue', view: 'work', issueKey: 'AM-12' });
    await waitFor(() => expect(screen.queryByTestId('assistant-backdrop')).not.toBeInTheDocument());
  });

  it('focuses the composer when the dock opens', async () => {
    renderDock();

    const textarea = await screen.findByLabelText('Message Copilot');
    await waitFor(() => expect(textarea).toHaveFocus());
  });

  it('refocuses the composer after a streamed response completes', async () => {
    let finishStream: (() => void) | undefined;
    mockStream.mockImplementation(
      (_path: string, _body: unknown, onEvent: (event: AssistantStreamEvent) => void) =>
        new Promise<void>((resolve) => {
          finishStream = () => {
            onEvent({ type: 'done', conversationId: 7, status: 'complete' });
            resolve();
          };
        }),
    );
    renderDock();

    const textarea = await screen.findByLabelText('Message Copilot');
    await waitFor(() => expect(textarea).toHaveFocus());

    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(textarea).toBeDisabled());
    screen.getByRole('button', { name: 'Stop generating' }).focus();
    expect(textarea).not.toHaveFocus();

    act(() => finishStream!());

    await waitFor(() => expect(textarea).toHaveFocus());
  });

  it('shows the setup empty state when Copilot is not configured', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/config/ai') {
        return Promise.resolve({ ...CONFIGURED, enabled: false, hasApiKey: false });
      }
      if (url === '/assistant/conversations') {
        return Promise.resolve({ conversations: [] });
      }
      return Promise.resolve(undefined);
    });
    renderDock();

    expect(await screen.findByText("Copilot isn't set up yet")).toBeInTheDocument();
    expect(screen.queryByLabelText('Message Copilot')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open settings/i })).toBeInTheDocument();
  });
});
