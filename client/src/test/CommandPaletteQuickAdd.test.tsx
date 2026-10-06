import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '@/components/palette/CommandPalette';

/** docs/57 §3 (P3-05): the palette's quick add is a capture when Phase 3 is on. */
const mockCreate = vi.fn();
const mockLegacyMutate = vi.fn();
const mockToast = vi.fn();
let phase3 = true;

vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: mockToast }) }));
vi.mock('@/context/QuickActionsContext', () => ({ useQuickActions: () => ({ openCapture: vi.fn(), openCommandPalette: vi.fn() }) }));
vi.mock('@/hooks/useTasksPhase3', () => ({ useTasksPhase3: () => phase3 }));
vi.mock('@/hooks/useTriggerSync', () => ({ useTriggerSync: () => ({ mutate: vi.fn() }) }));
vi.mock('@/hooks/useSyncStatus', () => ({ useSyncStatus: () => ({ data: { jiraConfigured: true } }) }));
vi.mock('@/hooks/useTaskViews', () => ({ useTaskViews: () => ({ data: { views: [] } }) }));
vi.mock('@/hooks/useModalFocus', () => ({ useModalFocus: () => ({ current: null }) }));
vi.mock('@/hooks/useGlobalSearch', () => ({
  GLOBAL_SEARCH_MIN_LENGTH: 2,
  useGlobalSearch: () => ({ data: undefined, isFetching: false, isSearching: false, isError: false }),
}));
vi.mock('@/hooks/useCapture', () => ({
  useCaptureTask: () => ({ create: mockCreate, isPending: false }),
}));
vi.mock('@/hooks/useDevelopers', () => ({ useDevelopers: () => ({ data: [{ accountId: 'dev-p', displayName: 'Priya Raman' }] }) }));
const authFeatures = vi.hoisted(() => ({ oneOnOne: true }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ features: authFeatures }), useAuthScopeKey: () => 'scope' }));
vi.mock('@/hooks/useManagerDesk', () => ({
  useCreateManagerDeskItem: () => ({ mutate: mockLegacyMutate, isPending: false }),
}));

function open() {
  const onClose = vi.fn();
  render(<CommandPalette onClose={onClose} onOpenTarget={vi.fn()} />);
  const input = screen.getByLabelText('Search') as HTMLInputElement;
  return { onClose, input };
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no scrollIntoView; the palette scrolls the active row into view.
  Element.prototype.scrollIntoView = vi.fn();
  phase3 = true;
  mockCreate.mockResolvedValue({ task: { taskKey: 'T-1' }, warnings: [] });
});

describe('CommandPalette commands (UX-21)', () => {
  it('finds "1:1 with <name>" and a Settings section by name', () => {
    const { input } = open();
    fireEvent.change(input, { target: { value: '1:1 priya' } });
    expect(screen.getByRole('option', { name: /1:1 with Priya Raman/ })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'attention rules' } });
    expect(screen.getByRole('option', { name: /Settings › Attention Rules/ })).toBeInTheDocument();
  });
});

describe('CommandPalette quick add', () => {
  it('captures the typed text, tokens and all, and closes on success', async () => {
    const { onClose, input } = open();
    fireEvent.change(input, { target: { value: 'Send the deck to @dev-1 !fri' } });
    fireEvent.click(screen.getByRole('option', { name: /Add to Tasks/ }));

    expect(mockCreate).toHaveBeenCalledWith({ text: 'Send the deck to @dev-1 !fri' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockToast).toHaveBeenCalledWith('Added to Tasks', 'success');
    expect(mockLegacyMutate).not.toHaveBeenCalled();
  });

  it('Enter on the only row creates it', async () => {
    const { onClose, input } = open();
    fireEvent.change(input, { target: { value: 'zzz quick thought' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockCreate).toHaveBeenCalledWith({ text: 'zzz quick thought' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('stays open and shows the reason when the capture is rejected', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Nobody matches @ghost'));
    const { onClose, input } = open();
    fireEvent.change(input, { target: { value: 'Ask @ghost about it' } });
    fireEvent.click(screen.getByRole('option', { name: /Add to Tasks/ }));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Nobody matches @ghost', 'error'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the legacy Desk create when Phase 3 is off', () => {
    phase3 = false;
    const { input } = open();
    fireEvent.change(input, { target: { value: 'zzz legacy thought' } });
    fireEvent.click(screen.getByRole('option', { name: /Add to Desk/ }));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockLegacyMutate).toHaveBeenCalledWith(expect.objectContaining({ title: 'zzz legacy thought', status: 'inbox' }), expect.any(Object));
  });
});
