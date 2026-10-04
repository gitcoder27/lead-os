import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SelfLinkSelect } from '@/components/settings/SelfLinkSelect';
import type { TeamSelfLink } from '@/types';

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
const addToastMock = vi.fn();

vi.mock('@/lib/api', () => ({ api: apiMocks }));
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => 'scope' }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: addToastMock }) }));

const ayan = { accountId: 'dev-ayan', displayName: 'Ayan Saha' };
const priya = { accountId: 'dev-priya', displayName: 'Priya' };

function renderSelect(link: TeamSelfLink, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  apiMocks.get.mockResolvedValue(link);
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <SelfLinkSelect members={[ayan, priya]} />
      </QueryClientProvider>,
    ),
  };
}

describe('Settings → "Which one is you?" (UX-15)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks once, above the list, with every member as an option', async () => {
    renderSelect({ developerAccountId: null, suggestedDeveloperAccountId: null });
    const select = await screen.findByLabelText('Which one is you?');
    expect(select).toHaveValue('');
    expect([...(select as HTMLSelectElement).options].map((option) => option.textContent)).toEqual(["I'm not on this list", 'Ayan Saha', 'Priya']);
    expect(screen.queryByRole('button', { name: /this is me/i })).toBeNull();
  });

  it('marks the member that matches the saved Jira account', async () => {
    renderSelect({ developerAccountId: null, suggestedDeveloperAccountId: 'dev-ayan' });
    const select = await screen.findByLabelText('Which one is you?');
    expect([...(select as HTMLSelectElement).options][1]!.textContent).toBe('Ayan Saha (matches your Jira account)');
  });

  it('saves the pick and shows it as the current answer', async () => {
    apiMocks.put.mockResolvedValue({ developerAccountId: 'dev-ayan', suggestedDeveloperAccountId: null });
    renderSelect({ developerAccountId: null, suggestedDeveloperAccountId: null });
    fireEvent.change(await screen.findByLabelText('Which one is you?'), { target: { value: 'dev-ayan' } });
    await waitFor(() => expect(apiMocks.put).toHaveBeenCalledWith('/team/self', { developerAccountId: 'dev-ayan' }));
    await waitFor(() => expect(screen.getByLabelText('Which one is you?')).toHaveValue('dev-ayan'));
    expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', title: 'Linked to you' }));
  });

  it('unlinks with "I\'m not on this list"', async () => {
    apiMocks.put.mockResolvedValue({ developerAccountId: null, suggestedDeveloperAccountId: null });
    renderSelect({ developerAccountId: 'dev-ayan', suggestedDeveloperAccountId: null });
    fireEvent.change(await screen.findByLabelText('Which one is you?'), { target: { value: '' } });
    await waitFor(() => expect(apiMocks.put).toHaveBeenCalledWith('/team/self', { developerAccountId: null }));
  });

  it('refreshes the surfaces that decide who "me" is', async () => {
    apiMocks.put.mockResolvedValue({ developerAccountId: 'dev-ayan', suggestedDeveloperAccountId: null });
    const { queryClient } = renderSelect({ developerAccountId: null, suggestedDeveloperAccountId: null });
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    fireEvent.change(await screen.findByLabelText('Which one is you?'), { target: { value: 'dev-ayan' } });
    await waitFor(() => {
      const keys = spy.mock.calls.map((call) => (call[0] as { queryKey: string[] }).queryKey[0]);
      expect(keys).toEqual(expect.arrayContaining(['tasks', 'today', 'team-tracker']));
    });
  });

  it('reports a failed save and keeps the old answer', async () => {
    apiMocks.put.mockRejectedValue(new Error('Choose an active team member'));
    renderSelect({ developerAccountId: null, suggestedDeveloperAccountId: null });
    fireEvent.change(await screen.findByLabelText('Which one is you?'), { target: { value: 'dev-ayan' } });
    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'Choose an active team member' })));
    expect(screen.getByLabelText('Which one is you?')).toHaveValue('');
  });
});
