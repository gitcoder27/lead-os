import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationSection } from '@/components/settings/NavigationSection';
import { DEFAULT_NAV_PREFERENCES, type NavPreferences } from '@/types';

const useNavPreferencesMock = vi.fn();
const saveMutateAsyncMock = vi.fn();
const addToastMock = vi.fn();

vi.mock('@/hooks/useNavPreferences', () => ({
  useNavPreferences: () => useNavPreferencesMock(),
  useSaveNavPreferences: () => ({ mutateAsync: saveMutateAsyncMock, isPending: false }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

function topList() {
  return within(screen.getByRole('list', { name: 'Top navigation' }));
}

function moreList() {
  return within(screen.getByRole('list', { name: 'More menu' }));
}

function labelsIn(list: ReturnType<typeof within>): string[] {
  return list
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '');
}

describe('NavigationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveMutateAsyncMock.mockResolvedValue(DEFAULT_NAV_PREFERENCES);
    useNavPreferencesMock.mockReturnValue({ preferences: DEFAULT_NAV_PREFERENCES });
  });

  it('renders every page partitioned across the two zones with Today fixed first', () => {
    render(<NavigationSection />);

    const top = labelsIn(topList());
    expect(top[0]).toContain('Today');
    expect(top[0]).toContain('Always first');
    expect(top.slice(1)).toEqual(['Work', 'Team', 'Desk']);
    expect(labelsIn(moreList())).toEqual(['Follow-ups', 'Notes', 'Meetings']);
    expect(topList().queryByLabelText(/move today/i)).not.toBeInTheDocument();
  });

  it('reorders pages within a zone and saves the new order', async () => {
    render(<NavigationSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Team down' }));
    expect(labelsIn(topList()).slice(1)).toEqual(['Work', 'Desk', 'Team']);

    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await vi.waitFor(() => expect(saveMutateAsyncMock).toHaveBeenCalledTimes(1));
    expect(saveMutateAsyncMock).toHaveBeenCalledWith({
      topNav: ['work', 'desk', 'team'],
      moreNav: ['follow-ups', 'notes', 'meetings'],
    });
    expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('moves a page between zones', () => {
    render(<NavigationSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Notes to top navigation' }));
    expect(labelsIn(topList()).slice(1)).toEqual(['Work', 'Team', 'Desk', 'Notes']);
    expect(labelsIn(moreList())).toEqual(['Follow-ups', 'Meetings']);

    fireEvent.click(screen.getByRole('button', { name: 'Move Desk to More menu' }));
    expect(labelsIn(topList()).slice(1)).toEqual(['Work', 'Team', 'Notes']);
    expect(labelsIn(moreList())).toEqual(['Follow-ups', 'Meetings', 'Desk']);
  });

  it('keeps Save disabled until the layout changes', () => {
    render(<NavigationSection />);
    expect(screen.getByRole('button', { name: 'Save layout' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Move Meetings up' }));
    expect(screen.getByRole('button', { name: 'Save layout' })).toBeEnabled();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('restores the default layout into the draft for saving', async () => {
    useNavPreferencesMock.mockReturnValue({
      preferences: { topNav: ['notes'], moreNav: ['work', 'team', 'desk', 'follow-ups', 'meetings'] } satisfies NavPreferences,
    });
    render(<NavigationSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Restore default' }));
    expect(labelsIn(topList()).slice(1)).toEqual(['Work', 'Team', 'Desk']);
    expect(labelsIn(moreList())).toEqual(['Follow-ups', 'Notes', 'Meetings']);

    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await vi.waitFor(() => expect(saveMutateAsyncMock).toHaveBeenCalledWith(DEFAULT_NAV_PREFERENCES));
  });

  it('shows the empty-state hint when every page is in the top navigation', () => {
    useNavPreferencesMock.mockReturnValue({
      preferences: { topNav: ['work', 'team', 'desk', 'follow-ups', 'notes', 'meetings'], moreNav: [] },
    });
    render(<NavigationSection />);
    expect(screen.getByText(/Every page is in the top navigation/)).toBeInTheDocument();
  });

  it('surfaces save failures without clearing the draft', async () => {
    saveMutateAsyncMock.mockRejectedValue(new Error('network down'));
    render(<NavigationSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Meetings up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));

    await vi.waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    );
    expect(labelsIn(moreList())).toEqual(['Follow-ups', 'Meetings', 'Notes']);
  });
});
