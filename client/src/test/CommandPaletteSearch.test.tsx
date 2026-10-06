import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '@/components/palette/CommandPalette';
import type { GlobalSearchResponse, GlobalSearchTaskItem } from '@/types';

const get = vi.fn();
const create = vi.fn();
vi.mock('@/lib/api', () => ({ api: { get: (...args: unknown[]) => get(...args) } }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ features: {} }), useAuthScopeKey: () => 'scope' }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('@/context/QuickActionsContext', () => ({ useQuickActions: () => ({ openCapture: vi.fn() }) }));
vi.mock('@/hooks/useTasksPhase3', () => ({ useTasksPhase3: () => true }));
vi.mock('@/hooks/useTriggerSync', () => ({ useTriggerSync: () => ({ mutate: vi.fn() }) }));
vi.mock('@/hooks/useSyncStatus', () => ({ useSyncStatus: () => ({ data: { jiraConfigured: false } }) }));
vi.mock('@/hooks/useTaskViews', () => ({ useTaskViews: () => ({ data: { views: [] } }) }));
vi.mock('@/hooks/useDevelopers', () => ({ useDevelopers: () => ({ data: [] }) }));
vi.mock('@/hooks/useCapture', () => ({ useCaptureTask: () => ({ create, isPending: false }) }));
vi.mock('@/hooks/useManagerDesk', () => ({ useCreateManagerDeskItem: () => ({ mutate: vi.fn(), isPending: false }) }));

interface SearchRequest {
  url: string;
  signal: AbortSignal;
  resolve: (value: GlobalSearchResponse) => void;
  reject: (error: Error) => void;
}
let requests: SearchRequest[];
let client: QueryClient;
const task = (key: string, title: string): GlobalSearchTaskItem => ({
  taskKey: key, title, kind: 'desk_only', status: 'inbox', matchedIn: 'title', updatedAt: '2026-10-07T10:00:00Z',
});
const response = (query: string, tasks: GlobalSearchTaskItem[] = []): GlobalSearchResponse => ({
  query, tasks, issues: [], deskItems: [], trackerItems: [], checkIns: [], developers: [],
});
const advance = async (ms = 150) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};
const complete = async (request: SearchRequest, data: GlobalSearchResponse) => {
  await act(async () => { request.resolve(data); });
  await advance(1);
};
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function open() {
  const onClose = vi.fn();
  const onOpenTarget = vi.fn();
  const onViewChange = vi.fn();
  const rendered = render(<CommandPalette onClose={onClose} onOpenTarget={onOpenTarget} onViewChange={onViewChange} />, { wrapper: Wrapper });
  return { ...rendered, onClose, onOpenTarget, onViewChange, input: screen.getByRole('combobox', { name: 'Search' }) };
}
const typeQuery = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });
function activeOption(input: HTMLElement) {
  const id = input.getAttribute('aria-activedescendant');
  expect(id).toBeTruthy();
  const option = document.getElementById(id!);
  expect(option).toHaveAttribute('role', 'option');
  expect(option).toHaveAttribute('aria-selected', 'true');
  expect(screen.getAllByRole('option', { selected: true })).toHaveLength(1);
  return option!;
}

beforeEach(() => {
  vi.useFakeTimers();
  get.mockReset();
  create.mockReset();
  requests = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  get.mockImplementation((url: string, { signal }: { signal: AbortSignal }) =>
    new Promise<GlobalSearchResponse>((resolve, reject) => { requests.push({ url, signal, resolve, reject }); }),
  );
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('CommandPalette search', () => {
  it('links the input and options, keeps focus during arrows, and activates local commands', () => {
    const { input, onOpenTarget, onClose } = open();
    const list = screen.getByRole('listbox', { name: 'Commands and search results' });
    expect(input).toHaveAttribute('aria-controls', list.id);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveFocus();
    expect(list).toContainElement(activeOption(input));
    expect(activeOption(input)).toHaveTextContent('Go to Today');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeOption(input)).toHaveTextContent('Go to Work');
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(activeOption(input)).toHaveTextContent('Go to Today');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(activeOption(input)).toBe(within(list).getAllByRole('option').at(-1));
    typeQuery(input, 'notes');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onOpenTarget).toHaveBeenCalledWith({ type: 'view', view: 'notes' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('reports debounce/loading honestly, then shows no matches only after success', async () => {
    const { input } = open();
    typeQuery(input, 'zz');
    expect(screen.getByRole('status')).toHaveTextContent('Searching');
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No matches found.')).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await advance();
    expect(screen.getByRole('status')).toHaveTextContent('Searching');
    await complete(requests[0]!, response('zz'));
    expect(screen.getByText('No matches found.')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'false');
  });

  it('announces failure and retries the current query while keeping local commands and capture', async () => {
    const { input } = open();
    typeQuery(input, 'notes');
    expect(screen.getByRole('option', { name: /Go to Notes/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Add to Tasks/ })).toBeInTheDocument();
    await advance();
    await act(async () => { requests[0]!.reject(new Error('Network failed')); });
    await advance(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Search failed. Try again.');
    expect(screen.queryByText('No matches found.')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Go to Notes/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Add to Tasks/ })).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(retry).toBeDisabled();
    expect(input).toHaveFocus();
    fireEvent.click(retry);
    expect(get).toHaveBeenCalledTimes(2);
    expect(requests[1]!.url).toBe('/search?q=notes');
    expect(screen.getByRole('status')).toHaveTextContent('Searching');
    await complete(requests[1]!, response('notes', [task('T-5', 'Notes follow-through')]));
    expect(screen.getByRole('option', { name: /Notes follow-through/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    typeQuery(input, 'zz');
    expect(screen.queryByRole('option', { name: /Notes follow-through/ })).not.toBeInTheDocument();
  });

  it('pins an exact task key and keeps stable selection IDs through result reorder/removal', async () => {
    const { input, onOpenTarget } = open();
    typeQuery(input, 'T-5');
    await advance();
    await complete(requests[0]!, response('T-5', [task('T-9', 'Other task'), task('T-5', 'Exact task')]));
    expect(activeOption(input)).toHaveTextContent('Exact task');
    const exactId = activeOption(input).id;
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeOption(input)).toHaveTextContent('Other task');
    const otherId = activeOption(input).id;
    await act(async () => {
      client.setQueryData(['global-search', 'scope', 'T-5'], response('T-5', [task('T-5', 'Exact task'), task('T-9', 'Other task')]));
    });
    await advance(1);
    expect(activeOption(input).id).toBe(otherId);
    expect(screen.getByRole('option', { name: /Exact task/ }).id).toBe(exactId);
    expect(input).toHaveFocus();
    await act(async () => { client.setQueryData(['global-search', 'scope', 'T-5'], response('T-5', [task('T-5', 'Exact task')])); });
    await advance(1);
    expect(activeOption(input).id).toBe(exactId);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onOpenTarget).toHaveBeenCalledWith({ type: 'manager_desk_item', view: 'desk', taskKey: 'T-5' });
    expect(create).not.toHaveBeenCalled();
  });

  it('ignores an old response after editing and supports click activation without moving input focus', async () => {
    const { input, onOpenTarget } = open();
    typeQuery(input, 'alpha');
    await advance();
    const old = requests[0]!;
    typeQuery(input, 'beta');
    expect(old.signal.aborted).toBe(true);
    await advance();
    await complete(requests[1]!, response('beta', [task('T-2', 'Current result')]));
    await complete(old, response('alpha', [task('T-1', 'Stale result')]));
    expect(screen.queryByRole('option', { name: /Stale result/ })).not.toBeInTheDocument();
    const option = screen.getByRole('option', { name: /Current result/ });
    expect(fireEvent.mouseDown(option)).toBe(false);
    fireEvent.click(option);
    expect(input).toHaveFocus();
    expect(onOpenTarget).toHaveBeenCalledWith({ type: 'manager_desk_item', view: 'desk', taskKey: 'T-2' });
  });

  it('clears an obsolete error when typing and returns focus to the opener on Escape', async () => {
    function Host() {
      const [opened, setOpened] = useState(false);
      return <><button onClick={() => setOpened(true)}>Open palette</button>{opened && <CommandPalette onClose={() => setOpened(false)} onOpenTarget={vi.fn()} />}</>;
    }
    render(<Host />, { wrapper: Wrapper });
    const opener = screen.getByRole('button', { name: 'Open palette' });
    opener.focus();
    fireEvent.click(opener);
    const input = screen.getByRole('combobox');
    typeQuery(input, 'zz');
    await advance();
    await act(async () => { requests[0]!.reject(new Error('Failed')); });
    await advance(1);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No matches found.')).not.toBeInTheDocument();
    typeQuery(input, 'new query');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    await advance();
    expect(get).toHaveBeenCalledOnce();
  });
});
