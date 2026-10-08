import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTaskPeople } from '@/components/tasks/TaskDetailFields';

let scope = 'w:manager:login';
let user = { accountId: 'login', role: 'manager', developerAccountId: undefined as string | undefined };
const get = vi.fn(); const patch = vi.fn();
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => scope, useAuth: () => ({ user }) }));
vi.mock('@/lib/api', () => ({ api: { get: (...args: unknown[]) => get(...args), patch: (...args: unknown[]) => patch(...args) } }));
const clients: QueryClient[] = [];
beforeEach(() => {
  scope = 'w:manager:login'; user = { accountId: 'login', role: 'manager', developerAccountId: undefined };
  vi.clearAllMocks();
  get.mockImplementation(async (url: string) => url === '/team/self'
    ? { developerAccountId: 'roster', suggestedDeveloperAccountId: null }
    : { developers: [{ accountId: 'roster', displayName: 'Self roster', isActive: true }, { accountId: 'colleague', displayName: 'Colleague', isActive: true }] });
});
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); });
function setup(mode: 'manager' | 'developer' = 'manager') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(() => useTaskPeople(mode), { wrapper }) };
}

it('follows linked/unlinked cache answers, keeps colleague names and switches managers without task writes', async () => {
  const { result, client, rerender } = setup();
  await waitFor(() => expect(result.current.nameFor('roster')).toBe('You'));
  expect(result.current.nameFor('login')).toBe('You');
  expect(result.current.nameFor('colleague')).toBe('Colleague');
  expect(result.current.developers.map((entry) => entry.accountId)).toEqual(['colleague']);
  await act(async () => { client.setQueryData(['team-self', scope], { developerAccountId: null, suggestedDeveloperAccountId: 'roster' }); });
  await waitFor(() => expect(result.current.nameFor('roster')).toBe('Self roster'));
  expect(result.current.developers.map((entry) => entry.accountId)).toEqual(['roster', 'colleague']);
  get.mockImplementation(async (url: string) => url === '/team/self' ? { developerAccountId: null, suggestedDeveloperAccountId: null } : { developers: [] });
  scope = 'next:manager:other'; user = { ...user, accountId: 'other' }; rerender();
  expect(result.current.nameFor('login')).not.toBe('You');
  expect(result.current.nameFor('other')).toBe('You');
  expect(result.current.nameFor('roster')).not.toBe('You');
  expect(patch).not.toHaveBeenCalled();
});

it('falls back to login after a failed link refresh even when an older confirmed link is cached', async () => {
  const { result, client } = setup();
  await waitFor(() => expect(result.current.nameFor('roster')).toBe('You'));
  get.mockImplementation(async (url: string) => { if (url === '/team/self') throw new Error('Unavailable'); return { developers: [] }; });
  await act(async () => { await client.invalidateQueries({ queryKey: ['team-self', scope] }); });
  await waitFor(() => expect(result.current.nameFor('roster')).not.toBe('You'));
  expect(result.current.nameFor('login')).toBe('You');
  expect(patch).not.toHaveBeenCalled();
});

it('developer detail mode sends no manager-only self-link or roster requests', () => {
  scope = 'w:developer:dev-login'; user = { accountId: 'dev-login', role: 'developer', developerAccountId: 'dev-roster' };
  const { result } = setup('developer');
  expect(result.current.nameFor('dev-roster')).toBe('You');
  expect(get).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
});
