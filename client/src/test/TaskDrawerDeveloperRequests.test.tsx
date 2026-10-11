import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskDetailResponse } from '@/types';

// The real roster, contact and label hooks run here; only the network is mocked.
const mockGet = vi.hoisted(() => vi.fn());
const mockUser = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser(), features: { tasksPhase3: true } }),
  useAuthScopeKey: () => 'ws:test',
}));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

const mockUseTaskDetail = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useTaskDetail', () => ({
  useTaskDetail: (...args: unknown[]) => mockUseTaskDetail(...args),
  useUpdateTaskDetail: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTaskDetail: () => ({ mutate: vi.fn(), isPending: false }),
  useAddTaskDetailLink: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveTaskDetailLink: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/components/tasks/TaskTimeline', () => ({
  TaskTimeline: () => <div data-testid="timeline" />,
  TaskTimelineDisclosure: () => <div data-testid="timeline" />,
}));

import { TaskDetailBody } from '@/components/tasks/TaskDrawer';
import { TestWrapper } from './wrapper';

const MANAGER_ONLY = ['/contacts', '/task-labels', '/team/developers'];

function task(overrides: Partial<TaskDetailResponse> = {}): TaskDetailResponse {
  return {
    id: 24,
    taskKey: 'T-24',
    title: 'Ship the fix',
    details: null,
    kind: 'task',
    status: 'active',
    ownerType: 'developer',
    ownerId: 'dev-1',
    priority: 'normal',
    scheduledOn: '2026-10-11',
    dueAt: null,
    startsAt: null,
    endsAt: null,
    participants: null,
    outcome: null,
    createdByType: 'manager',
    createdById: 'manager-a',
    createdAt: '2026-10-10T10:00:00Z',
    updatedAt: '2026-10-11T10:00:00Z',
    closedAt: null,
    deletedAt: null,
    links: [],
    parentId: null,
    children: [{ id: 25, taskKey: 'T-25', title: 'Write the test', status: 'open', ownerType: 'developer', ownerId: 'dev-1' }],
    parent: null,
    ...overrides,
  } as TaskDetailResponse;
}

function requested(path: string) {
  return mockGet.mock.calls.some(([url]) => String(url).split('?')[0] === path);
}

beforeEach(() => {
  mockGet.mockReset();
  mockGet.mockImplementation(() => new Promise(() => {}));
  mockUseTaskDetail.mockReturnValue({ data: task(), isLoading: false, isError: false, error: null });
});

describe('task drawer requests by role', () => {
  it('a developer drawer skips the manager-only roster, contact and label lookups', async () => {
    mockUser.mockReturnValue({ accountId: 'u-dev', role: 'developer', developerAccountId: 'dev-1' });
    render(<TestWrapper><TaskDetailBody taskKey="T-24" onNavigateTask={() => {}} /></TestWrapper>);
    expect(screen.getByText('Write the test')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/subtask|action item/i)).toBeNull();
    // Let any queued queries fire before asserting none of them did.
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const path of MANAGER_ONLY) expect(requested(path), path).toBe(false);
  });

  it('a manager drawer still loads them for the subtask typeahead', async () => {
    mockUser.mockReturnValue({ accountId: 'manager-a', role: 'manager', developerAccountId: undefined });
    render(<TestWrapper><TaskDetailBody taskKey="T-24" onNavigateTask={() => {}} /></TestWrapper>);
    await waitFor(() => { for (const path of MANAGER_ONLY) expect(requested(path), path).toBe(true); });
  });
});
