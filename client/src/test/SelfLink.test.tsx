import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SelfLinkAction } from '@/components/settings/SelfLinkAction';
import type { TeamSelfLink } from '@/types';

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
const addToastMock = vi.fn();

vi.mock('@/lib/api', () => ({ api: apiMocks }));
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => 'scope' }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: addToastMock }) }));

const ayan = { accountId: 'dev-ayan', displayName: 'Ayan Saha' };
const priya = { accountId: 'dev-priya', displayName: 'Priya' };

function renderRow(link: TeamSelfLink, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  apiMocks.get.mockResolvedValue(link);
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <SelfLinkAction member={ayan} />
        <SelfLinkAction member={priya} />
      </QueryClientProvider>,
    ),
  };
}

describe('Settings → "This is me"', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers the control on every member until one is marked', async () => {
    renderRow({ developerAccountId: null, suggestedDeveloperAccountId: null });
    expect(await screen.findByRole('button', { name: 'This is me: Ayan Saha' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'This is me: Priya' })).toBeInTheDocument();
  });

  it('marks the member that matches the saved Jira account as the suggestion', async () => {
    renderRow({ developerAccountId: null, suggestedDeveloperAccountId: 'dev-ayan' });
    expect(await screen.findByRole('button', { name: 'This is me: Ayan Saha' })).toHaveTextContent('This is me?');
    expect(screen.getByRole('button', { name: 'This is me: Priya' })).toHaveTextContent('This is me');
    expect(screen.getByRole('button', { name: 'This is me: Priya' })).not.toHaveTextContent('?');
  });

  it('saves the link, then shows You and hides the control on everyone else', async () => {
    apiMocks.put.mockResolvedValue({ developerAccountId: 'dev-ayan', suggestedDeveloperAccountId: null });
    renderRow({ developerAccountId: null, suggestedDeveloperAccountId: null });
    fireEvent.click(await screen.findByRole('button', { name: 'This is me: Ayan Saha' }));
    await waitFor(() => expect(apiMocks.put).toHaveBeenCalledWith('/team/self', { developerAccountId: 'dev-ayan' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'This is me: Ayan Saha' })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button', { name: 'This is me: Ayan Saha' })).toHaveTextContent('You');
    expect(screen.queryByRole('button', { name: 'This is me: Priya' })).toBeNull();
    expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('unlinks with a second click', async () => {
    apiMocks.put.mockResolvedValue({ developerAccountId: null, suggestedDeveloperAccountId: null });
    renderRow({ developerAccountId: 'dev-ayan', suggestedDeveloperAccountId: null });
    fireEvent.click(await screen.findByRole('button', { name: 'This is me: Ayan Saha' }));
    await waitFor(() => expect(apiMocks.put).toHaveBeenCalledWith('/team/self', { developerAccountId: null }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'This is me: Priya' })).toBeInTheDocument());
  });

  it('refreshes the surfaces that decide who "me" is', async () => {
    apiMocks.put.mockResolvedValue({ developerAccountId: 'dev-ayan', suggestedDeveloperAccountId: null });
    const { queryClient } = renderRow({ developerAccountId: null, suggestedDeveloperAccountId: null });
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'This is me: Ayan Saha' }));
    await waitFor(() => expect(apiMocks.put).toHaveBeenCalled());
    await waitFor(() => {
      const keys = spy.mock.calls.map((call) => (call[0] as { queryKey: string[] }).queryKey[0]);
      expect(keys).toEqual(expect.arrayContaining(['tasks', 'today', 'team-tracker']));
    });
  });

  it('reports a failed save and keeps the old state', async () => {
    apiMocks.put.mockRejectedValue(new Error('Choose an active team member'));
    renderRow({ developerAccountId: null, suggestedDeveloperAccountId: null });
    fireEvent.click(await screen.findByRole('button', { name: 'This is me: Ayan Saha' }));
    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'Choose an active team member' })));
    expect(screen.getByRole('button', { name: 'This is me: Ayan Saha' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders nothing until the link has loaded', () => {
    apiMocks.get.mockReturnValue(new Promise(() => undefined));
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <SelfLinkAction member={ayan} />
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
