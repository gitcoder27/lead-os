import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCreateDeskTask } from '@/hooks/useManagerDesk';
import { deskPayloadToCapture } from '@/lib/capture-defaults';
import { ManagerDeskCaptureDialog } from '@/components/manager-desk/ManagerDeskCaptureDialog';
import type { ManagerDeskCreateItemPayload } from '@/types';

/** docs/57 §3 (P3-05): Desk-style creation (capture dialog, follow-ups/meetings composer) goes through /api/capture. */
const apiPost = vi.fn();
const addToast = vi.fn();
let phase3 = true;

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: (...args: unknown[]) => apiPost(...args), put: vi.fn(), delete: vi.fn(), patch: vi.fn() },
  ApiRequestError: class extends Error {},
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { accountId: 'manager-a', role: 'manager' }, features: { tasksPhase3: phase3 } }),
  useAuthScopeKey: () => 'ws:manager',
}));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast }) }));

const TODAY = '2026-09-26';
const captured = (over: Record<string, unknown> = {}) => ({ intent: 'create', diagnostics: [], task: { id: 5, taskKey: 'T-5', title: 'x', ...over } });

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  phase3 = true;
});

describe('deskPayloadToCapture', () => {
  const base: ManagerDeskCreateItemPayload = { date: TODAY, title: 'Follow up with Alice' };

  it('plans the task on the payload day', () => {
    expect(deskPayloadToCapture(base)).toEqual({ text: 'Follow up with Alice', defaults: { scheduledOn: TODAY } });
  });

  it('maps category, kind, priority, owner and status to structured defaults', () => {
    const { defaults } = deskPayloadToCapture({
      ...base, kind: 'decision', category: 'follow_up', priority: 'critical', assigneeDeveloperAccountId: '557058:ab-12', status: 'waiting',
    });
    expect(defaults).toEqual({
      scheduledOn: TODAY,
      ownerAccountId: '557058:ab-12',
      labels: ['category:follow_up', 'kind:decision'],
      priority: 'high',
      status: 'blocked',
    });
  });

  it('a meeting carries its times, attendees and next action', () => {
    const { defaults } = deskPayloadToCapture({
      ...base, kind: 'meeting', category: 'planning', participants: 'Ayan, QA', nextAction: 'Send notes',
      plannedStartAt: '2026-09-26T10:00:00.000Z', plannedEndAt: '2026-09-26T10:30:00.000Z',
    });
    expect(defaults).toMatchObject({ kind: 'meeting', participants: 'Ayan, QA', nextAction: 'Send notes', startsAt: '2026-09-26T10:00:00.000Z', endsAt: '2026-09-26T10:30:00.000Z', labels: ['category:planning'] });
  });

  it('keeps the follow-up time of day', () => {
    expect(deskPayloadToCapture({ ...base, followUpAt: '2026-09-27T09:00:00.000Z' }).defaults.followUpAt).toBe('2026-09-27T09:00:00.000Z');
  });

  it('turns links into Jira keys and developer ids, and a trimmed context note', () => {
    const { defaults } = deskPayloadToCapture({
      ...base, contextNote: '  why it matters  ',
      links: [{ linkType: 'developer', developerAccountId: 'dev-1' }, { linkType: 'issue', issueKey: 'LEAD-1' }, { linkType: 'issue', issueKey: 'LEAD-2' }],
    });
    expect(defaults.links).toEqual({ jiraKeys: ['LEAD-1', 'LEAD-2'], developerAccountIds: ['dev-1'] });
    expect(defaults.contextNote).toBe('why it matters');
  });

  it('a backlog item is parked instead of planned', () => {
    expect(deskPayloadToCapture({ ...base, status: 'backlog' }).defaults).toEqual({ later: true });
  });

  it('leaves out category "other" and empty links', () => {
    const { defaults } = deskPayloadToCapture({ ...base, category: 'other', links: [] });
    expect(defaults).toEqual({ scheduledOn: TODAY });
  });
});

describe('useCreateDeskTask', () => {
  it('posts to /capture when Phase 3 is on and reports success', async () => {
    apiPost.mockResolvedValueOnce(captured());
    const { result } = renderHook(() => useCreateDeskTask(TODAY), { wrapper });
    const onSuccess = vi.fn();
    await act(async () => { result.current.mutate({ date: TODAY, title: 'Do it @dev-1' }, { onSuccess }); });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith('/capture', expect.objectContaining({ text: 'Do it @dev-1', defaults: { scheduledOn: TODAY } }));
    expect(apiPost).not.toHaveBeenCalledWith('/manager-desk/items', expect.anything());
  });

  it('reports the server\'s reason through onError', async () => {
    apiPost.mockResolvedValueOnce({ intent: 'create', blocked: true, diagnostics: [{ severity: 'error', code: 'unknown-person', message: 'Nobody matches @ghost' }] });
    const { result } = renderHook(() => useCreateDeskTask(TODAY), { wrapper });
    const onError = vi.fn();
    await act(async () => { result.current.mutate({ date: TODAY, title: 'Ask @ghost' }, { onError }); });
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0].message).toBe('Nobody matches @ghost');
  });

  it('is pending while the capture is in flight', async () => {
    let release!: (value: unknown) => void;
    apiPost.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const { result } = renderHook(() => useCreateDeskTask(TODAY), { wrapper });
    await act(async () => { result.current.mutate({ date: TODAY, title: 'Slow' }); });
    expect(result.current.isPending).toBe(true);
    await act(async () => { release(captured()); });
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it('keeps the legacy Desk create when Phase 3 is off', async () => {
    phase3 = false;
    apiPost.mockResolvedValueOnce({ id: 1 });
    const { result } = renderHook(() => useCreateDeskTask(TODAY), { wrapper });
    const payload = { date: TODAY, title: 'Legacy', kind: 'action' as const, category: 'planning' as const };
    await act(async () => { result.current.mutate(payload); });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/manager-desk/items', payload));
    expect(apiPost).not.toHaveBeenCalledWith('/capture', expect.anything());
  });
});

describe('ManagerDeskCaptureDialog under Phase 3', () => {
  const renderDialog = (props: Partial<Parameters<typeof ManagerDeskCaptureDialog>[0]> = {}) => {
    const onClose = vi.fn();
    render(<ManagerDeskCaptureDialog onClose={onClose} date={TODAY} {...props} />, { wrapper });
    return { onClose };
  };

  it('offers "Add task" and sends the title, links and note through capture', async () => {
    apiPost.mockResolvedValueOnce(captured());
    const { onClose } = renderDialog({
      heading: 'Add Issue Follow-Up',
      initialTitle: 'Login fails on Safari',
      initialCategory: 'analysis',
      initialContextNote: 'Saved triage notes',
      initialLinks: [{ linkType: 'issue', issueKey: 'LEAD-4' }, { linkType: 'developer', developerAccountId: 'dev-1' }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith('/capture', expect.objectContaining({
      text: 'Login fails on Safari',
      defaults: {
        scheduledOn: TODAY,
        labels: ['category:analysis'],
        contextNote: 'Saved triage notes',
        links: { jiraKeys: ['LEAD-4'], developerAccountIds: ['dev-1'] },
      },
    }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', title: 'Saved to Tasks' }));
  });

  it('keeps the dialog open and shows the error when the capture is rejected', async () => {
    apiPost.mockResolvedValueOnce({ intent: 'create', blocked: true, diagnostics: [{ severity: 'error', code: 'unknown-person', message: 'Nobody matches @ghost' }] });
    const { onClose } = renderDialog({ initialTitle: 'Ask @ghost' });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'Nobody matches @ghost' })));
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Ask @ghost');
  });

  it('uses the legacy Desk wording and create when Phase 3 is off', async () => {
    phase3 = false;
    apiPost.mockResolvedValueOnce({ id: 1 });
    renderDialog({ initialTitle: 'Legacy item' });
    fireEvent.click(screen.getByRole('button', { name: 'Add to Desk' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/manager-desk/items', expect.objectContaining({ title: 'Legacy item' })));
    expect(apiPost).not.toHaveBeenCalledWith('/capture', expect.anything());
  });
});
