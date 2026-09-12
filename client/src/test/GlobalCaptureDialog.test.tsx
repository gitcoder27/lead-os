import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalCaptureDialog } from '@/components/capture/GlobalCaptureDialog';
import { TestWrapper } from './wrapper';
import type * as scopedStorageModule from '@/lib/scoped-storage';
import type * as authContextModule from '@/context/AuthContext';

// ── Mocks ───────────────────────────────────────────────

const mockMutate = vi.fn();
const mockAddToast = vi.fn();
const CAPTURE_TARGET_STORAGE_KEY = 'lead-os:anonymous:dcc-capture-target';

const mockDevelopers = [
  {
    accountId: 'dev-1',
    displayName: 'Alice Smith',
    email: 'alice@example.com',
    avatarUrl: null,
    availability: undefined,
  },
  {
    accountId: 'dev-2',
    displayName: 'Bob Jones',
    email: 'bob@example.com',
    avatarUrl: null,
    availability: { state: 'inactive' as const, startDate: '2026-03-19', endDate: '2026-03-21', note: 'PTO' },
  },
  {
    accountId: 'dev-3',
    displayName: 'Carol Davis',
    email: 'carol@example.com',
    avatarUrl: null,
    availability: undefined,
  },
];

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@/hooks/useManagerDesk', () => ({
  useCreateManagerDeskItem: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
  useManagerDeskDeveloperLookup: () => ({
    data: mockDevelopers,
    isLoading: false,
  }),
  useManagerDeskIssueLookup: () => ({
    data: [],
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useTeamTrackerMutations', () => ({
  useAddTrackerItem: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

const mockNoteAppendMutate = vi.fn();
let scopedStorageKey = CAPTURE_TARGET_STORAGE_KEY;
let noteDraftScope = 'ws-1:manager-a:manager:';

vi.mock('@/hooks/useDailyNotes', () => ({
  useAppendDailyNote: () => ({
    mutate: mockNoteAppendMutate,
    isPending: false,
  }),
}));

vi.mock('@/lib/scoped-storage', async (importOriginal) => {
  const mod = await importOriginal<typeof scopedStorageModule>();
  return { ...mod, useScopedStorageKey: () => scopedStorageKey };
});

vi.mock('@/context/AuthContext', async (importOriginal) => {
  const mod = await importOriginal<typeof authContextModule>();
  return { ...mod, useAuthScopeKey: () => noteDraftScope };
});

vi.mock('@/components/JiraIssueLink', () => ({
  JiraIssueLink: ({ children, ...props }: Record<string, unknown>) => (
    <a {...props}>{children as React.ReactNode}</a>
  ),
}));

// ── Helpers ─────────────────────────────────────────────

function renderDialog(props: Partial<React.ComponentProps<typeof GlobalCaptureDialog>> = {}) {
  return render(
    <TestWrapper>
      <GlobalCaptureDialog
        onClose={vi.fn()}
        onOpenManagerDesk={vi.fn()}
        onOpenTeamTracker={vi.fn()}
        {...props}
      />
    </TestWrapper>,
  );
}

// ── Tests ───────────────────────────────────────────────

describe('GlobalCaptureDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    scopedStorageKey = CAPTURE_TARGET_STORAGE_KEY;
    noteDraftScope = 'ws-1:manager-a:manager:';
  });

  it('renders with segmented control showing both targets', () => {
    renderDialog();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Desk')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
  });

  it('defaults to Manager Desk target on first open', () => {
    renderDialog();

    // Manager Desk form has desk-specific placeholder
    expect(screen.getByPlaceholderText('What needs to land on your desk?')).toBeInTheDocument();
  });

  it('switches to Team target when clicked', async () => {
    renderDialog();

    fireEvent.click(screen.getByText('Team'));

    // Should show the developer picker label
    await waitFor(() => {
      expect(screen.getByText('Assign to')).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('Search developer…')).toBeInTheDocument();
  });

  it('persists last-used target in localStorage', async () => {
    renderDialog();

    fireEvent.click(screen.getByText('Team'));
    expect(localStorage.getItem(CAPTURE_TARGET_STORAGE_KEY)).toBe('team-tracker');

    fireEvent.click(screen.getByText('Desk'));
    expect(localStorage.getItem(CAPTURE_TARGET_STORAGE_KEY)).toBe('manager-desk');
  });

  it('restores persisted target on reopen', async () => {
    localStorage.setItem(CAPTURE_TARGET_STORAGE_KEY, 'team-tracker');
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText('Assign to')).toBeInTheDocument();
    });
  });

  it('shows available developer roster immediately in Team mode', async () => {
    renderDialog();
    fireEvent.click(screen.getByText('Team'));

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    expect(screen.getByText('Carol Davis')).toBeInTheDocument();
  });

  it('hides unavailable developers from the Team capture picker', async () => {
    renderDialog();
    fireEvent.click(screen.getByText('Team'));

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    expect(screen.queryByText('PTO')).not.toBeInTheDocument();
  });

  it('selects a developer and shows the task input', async () => {
    renderDialog();
    fireEvent.click(screen.getByText('Team'));

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Alice Smith'));

    // Developer selected — shows chip and title becomes active
    expect(screen.getByText('Change')).toBeInTheDocument();
    const titleInput = screen.getByPlaceholderText('What should Alice work on?');
    expect(titleInput).toBeInTheDocument();
    expect(titleInput).not.toBeDisabled();
  });

  it('calls add tracker item mutation on team tracker submit', async () => {
    renderDialog();
    fireEvent.click(screen.getByText('Team'));

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    // Select developer
    fireEvent.click(screen.getByText('Alice Smith'));

    // Enter title
    const titleInput = screen.getByPlaceholderText('What should Alice work on?');
    fireEvent.change(titleInput, { target: { value: 'Fix the login bug' } });

    // Submit
    fireEvent.click(screen.getByText('Add Task'));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'dev-1',
        title: 'Fix the login bug',
      }),
      expect.any(Object),
    );
  });

  it('calls create desk item mutation on manager desk submit', async () => {
    renderDialog();

    const titleInput = screen.getByPlaceholderText('What needs to land on your desk?');
    fireEvent.change(titleInput, { target: { value: 'Review sprint plan' } });

    fireEvent.click(screen.getByText('Add to Desk'));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Review sprint plan',
        kind: 'action',
        category: 'planning',
      }),
      expect.any(Object),
    );
  });

  it('prelinks scoped issue context on manager desk submit', async () => {
    renderDialog({
      context: {
        defaultTarget: 'manager-desk',
        issue: { jiraKey: 'PROJ-221', summary: 'Open blocker' },
      },
    });

    const titleInput = screen.getByPlaceholderText('What needs to land on your desk?');
    fireEvent.change(titleInput, { target: { value: 'Review blocker' } });

    fireEvent.click(screen.getByText('Add to Desk'));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Review blocker',
        links: [{ linkType: 'issue', issueKey: 'PROJ-221' }],
      }),
      expect.any(Object),
    );
  });

  it('preselects scoped issue context for team tracker capture', async () => {
    renderDialog({
      context: {
        defaultTarget: 'team-tracker',
        issue: { jiraKey: 'PROJ-221', summary: 'Open blocker' },
      },
    });

    await waitFor(() => {
      expect(screen.getByText('Assign to')).toBeInTheDocument();
    });
    expect(screen.getByText('PROJ-221')).toBeInTheDocument();
    expect(screen.getByText('Open blocker')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Alice Smith'));
    const titleInput = screen.getByPlaceholderText('What should Alice work on?');
    fireEvent.change(titleInput, { target: { value: 'Pick up blocker' } });
    fireEvent.click(screen.getByText('Add Task'));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'dev-1',
        title: 'Pick up blocker',
        jiraKey: 'PROJ-221',
      }),
      expect.any(Object),
    );
  });

  it('disables tracker submit when no developer is selected', async () => {
    renderDialog();
    fireEvent.click(screen.getByText('Team'));

    await waitFor(() => {
      expect(screen.getByText('Add Task')).toBeInTheDocument();
    });

    const addButton = screen.getByText('Add Task').closest('button');
    expect(addButton).toBeDisabled();
  });

  it('disables tracker submit when title is empty', async () => {
    renderDialog();
    fireEvent.click(screen.getByText('Team'));

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Alice Smith'));

    const addButton = screen.getByText('Add Task').closest('button');
    expect(addButton).toBeDisabled();
  });

  it('closes on close button click', () => {
    const onClose = vi.fn();
    renderDialog({ onClose });

    fireEvent.click(screen.getByLabelText('Close capture'));
    expect(onClose).toHaveBeenCalled();
  });

  it('filters developer roster by search text', async () => {
    renderDialog();
    fireEvent.click(screen.getByText('Team'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search developer…')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search developer…');
    fireEvent.change(searchInput, { target: { value: 'alice' } });

    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    expect(screen.queryByText('Carol Davis')).not.toBeInTheDocument();
  });

  it('shows optional add-ons for team tracker capture', async () => {
    renderDialog();
    fireEvent.click(screen.getByText('Team'));

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Alice Smith'));

    expect(screen.getByText('+ Attach Jira')).toBeInTheDocument();
    expect(screen.getByText('+ Add note')).toBeInTheDocument();
  });

  it('expands note field when add note is clicked', async () => {
    renderDialog();
    fireEvent.click(screen.getByText('Team'));

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Alice Smith'));

    fireEvent.click(screen.getByText('+ Add note'));
    expect(screen.getByPlaceholderText('Context, handoff detail, or priority reason…')).toBeInTheDocument();
  });

  it('switches to the Notes target and appends via the notes mutation', async () => {
    renderDialog({ onOpenNotes: vi.fn() });

    fireEvent.click(screen.getByText('Notes'));

    await waitFor(() => {
      expect(screen.getByText('Added to your private daily note')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Quick note'), { target: { value: 'capture this thought' } });
    fireEvent.click(screen.getByRole('button', { name: /add to note/i }));

    expect(mockNoteAppendMutate).toHaveBeenCalledTimes(1);
    expect(mockNoteAppendMutate.mock.calls[0][0]).toMatchObject({
      text: 'capture this thought',
    });
    expect(mockNoteAppendMutate.mock.calls[0][0].requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('opens the Notes target directly when requested by context', async () => {
    renderDialog({ context: { defaultTarget: 'notes' }, onOpenNotes: vi.fn() });

    await waitFor(() => {
      expect(screen.getByText('Added to your private daily note')).toBeInTheDocument();
    });
  });

  it('does not leak held note text when the auth scope changes', async () => {
    const onClose = vi.fn();
    const renderView = () => (
      <TestWrapper>
        <GlobalCaptureDialog onClose={onClose} context={{ defaultTarget: 'notes' }} />
      </TestWrapper>
    );
    const { rerender } = render(renderView());

    await waitFor(() => {
      expect(screen.getByLabelText('Quick note')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText('Quick note'), {
      target: { value: 'private text from the previous manager' },
    });

    scopedStorageKey = 'lead-os:ws-2:manager-b:dcc-capture-target';
    noteDraftScope = 'ws-2:manager-b:manager:';
    rerender(renderView());

    await waitFor(() => {
      expect(screen.getByLabelText('Quick note')).toHaveValue('');
    });
  });
});
