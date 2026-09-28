import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/context/AuthContext';
import { TeamModeSection } from '@/components/settings/TeamModeSection';
import { useTeamMode } from '@/hooks/useTeamMode';
import type { AuthSessionResponse, TeamMode } from '@/types';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));
const addToastMock = vi.fn();

vi.mock('@/lib/api', () => ({ api: apiMocks }));
vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

function session(teamMode: TeamMode | undefined): AuthSessionResponse {
  return {
    user: { username: 'manager-a', accountId: 'manager-a', workspaceId: 'default', displayName: 'Manager A', role: 'manager' },
    features: teamMode ? { tasksPhase3: false, teamMode } : undefined,
  };
}

function ModeProbe() {
  return <span data-testid="mode">{useTeamMode()}</span>;
}

function renderWithAuth(children: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

describe('team mode (docs/56 P1-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useTeamMode reads the session feature and defaults to solo', async () => {
    apiMocks.get.mockResolvedValueOnce(session(undefined));
    const { unmount } = renderWithAuth(<ModeProbe />);
    await waitFor(() => expect(apiMocks.get).toHaveBeenCalledWith('/auth/me'));
    expect(screen.getByTestId('mode')).toHaveTextContent('solo');
    unmount();

    apiMocks.get.mockResolvedValueOnce(session('collab'));
    renderWithAuth(<ModeProbe />);
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('collab'));
  });

  it('the Settings toggle saves the mode and refreshes the session', async () => {
    apiMocks.get.mockResolvedValueOnce(session('solo')).mockResolvedValueOnce(session('collab'));
    apiMocks.put.mockResolvedValue({ teamMode: 'collab' });
    renderWithAuth(<><TeamModeSection /><ModeProbe /></>);

    await waitFor(() => expect(screen.getByRole('radio', { name: /Solo/ })).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(screen.getByRole('radio', { name: /Collaborative/ }));

    await waitFor(() => expect(apiMocks.put).toHaveBeenCalledWith('/config/team-mode', { teamMode: 'collab' }));
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('collab'));
    expect(screen.getByRole('radio', { name: /Collaborative/ })).toHaveAttribute('aria-checked', 'true');
    expect(apiMocks.get).toHaveBeenCalledTimes(2);
    expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('does not save when the current mode is clicked, and reports errors', async () => {
    apiMocks.get.mockResolvedValue(session('solo'));
    apiMocks.put.mockRejectedValueOnce(new Error('nope'));
    renderWithAuth(<TeamModeSection />);
    await waitFor(() => expect(apiMocks.get).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('radio', { name: /Solo/ }));
    expect(apiMocks.put).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('radio', { name: /Collaborative/ }));
    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'nope' })));
    expect(screen.getByRole('radio', { name: /Solo/ })).toHaveAttribute('aria-checked', 'true');
  });
});
