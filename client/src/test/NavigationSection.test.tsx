import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationSection } from '@/components/settings/NavigationSection';
import { DEFAULT_NAV_PREFERENCES, type NavPreferences } from '@/types';

const useNavPreferencesMock = vi.fn();
const useNavAvailabilityMock = vi.fn();
const saveMutateAsyncMock = vi.fn();
const addToastMock = vi.fn();

vi.mock('@/hooks/useNavPreferences', () => ({
  useNavPreferences: () => useNavPreferencesMock(),
  useSaveNavPreferences: () => ({ mutateAsync: saveMutateAsyncMock, isPending: false }),
}));

vi.mock('@/hooks/useNavAvailability', () => ({
  useNavAvailability: () => useNavAvailabilityMock(),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

const layout = (topNav: NavPreferences['topNav'], moreNav: NavPreferences['moreNav'], hidden: NavPreferences['hidden'] = []): NavPreferences => ({ topNav, moreNav, hidden });

function topList() {
  return within(screen.getByRole('list', { name: 'Top navigation' }));
}

function moreList() {
  return within(screen.getByRole('list', { name: 'More menu' }));
}

function hiddenList() {
  return within(screen.getByRole('list', { name: 'Hidden pages' }));
}

function labelsIn(list: ReturnType<typeof within>): string[] {
  return list.getAllByRole('listitem').map((item) => item.textContent ?? '');
}

describe('NavigationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveMutateAsyncMock.mockResolvedValue(DEFAULT_NAV_PREFERENCES);
    useNavPreferencesMock.mockReturnValue({ preferences: DEFAULT_NAV_PREFERENCES });
    useNavAvailabilityMock.mockReturnValue({ team: true, work: true });
  });

  it('renders every page partitioned across the three zones with Today fixed first', () => {
    render(<NavigationSection />);

    const top = labelsIn(topList());
    expect(top[0]).toContain('Today');
    expect(top[0]).toContain('Always first');
    // docs/56 P2-04: Today | Tasks | Team | Work | Notes (Desk under its pre-Phase 3 name).
    expect(top.slice(1)).toEqual(['Desk', 'Team', 'Work', 'Notes']);
    expect(screen.getByText(/Every page is in the top navigation/)).toBeInTheDocument();
    expect(screen.getByText('Nothing is hidden.')).toBeInTheDocument();
    // An empty zone is still a valid list: its note is the one item (axe aria-required-children).
    expect(hiddenList().getByRole('listitem')).toHaveTextContent('Nothing is hidden.');
    expect(topList().queryByLabelText(/move today/i)).not.toBeInTheDocument();
  });

  it('reorders pages within a zone and saves the new order', async () => {
    render(<NavigationSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Team down' }));
    expect(labelsIn(topList()).slice(1)).toEqual(['Desk', 'Work', 'Team', 'Notes']);

    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await vi.waitFor(() => expect(saveMutateAsyncMock).toHaveBeenCalledTimes(1));
    expect(saveMutateAsyncMock).toHaveBeenCalledWith({ topNav: ['desk', 'work', 'team', 'notes'], moreNav: [], hidden: [] });
    expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('moves a page between the top navigation and the More menu', () => {
    render(<NavigationSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Notes to More menu' }));
    expect(labelsIn(topList()).slice(1)).toEqual(['Desk', 'Team', 'Work']);
    expect(labelsIn(moreList())).toEqual(['Notes']);

    fireEvent.click(screen.getByRole('button', { name: 'Move Notes to top navigation' }));
    expect(labelsIn(topList()).slice(1)).toEqual(['Desk', 'Team', 'Work', 'Notes']);
  });

  it('keeps Save disabled until the layout changes', () => {
    render(<NavigationSection />);
    expect(screen.getByRole('button', { name: 'Save layout' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Move Team up' }));
    expect(screen.getByRole('button', { name: 'Save layout' })).toBeEnabled();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('restores the default layout into the draft for saving', async () => {
    useNavPreferencesMock.mockReturnValue({ preferences: layout(['notes'], ['work', 'team', 'desk']) });
    render(<NavigationSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Restore default' }));
    expect(labelsIn(topList()).slice(1)).toEqual(['Desk', 'Team', 'Work', 'Notes']);
    expect(screen.getByText(/Every page is in the top navigation/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await vi.waitFor(() => expect(saveMutateAsyncMock).toHaveBeenCalledWith(DEFAULT_NAV_PREFERENCES));
  });

  it('restoring the default also brings hidden pages back', () => {
    useNavPreferencesMock.mockReturnValue({ preferences: layout(['desk'], [], ['work', 'team', 'notes']) });
    render(<NavigationSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore default' }));
    expect(screen.getByText('Nothing is hidden.')).toBeInTheDocument();
    expect(labelsIn(topList()).slice(1)).toEqual(['Desk', 'Team', 'Work', 'Notes']);
  });

  it('shows the More-menu hint when a custom layout keeps pages there', () => {
    useNavPreferencesMock.mockReturnValue({ preferences: layout(['desk', 'notes'], ['team', 'work']) });
    render(<NavigationSection />);
    expect(labelsIn(moreList())).toEqual(['Team', 'Work']);
  });

  it('surfaces save failures without clearing the draft', async () => {
    saveMutateAsyncMock.mockRejectedValue(new Error('network down'));
    render(<NavigationSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Team up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));

    await vi.waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })),
    );
    expect(labelsIn(topList()).slice(1)).toEqual(['Team', 'Desk', 'Work', 'Notes']);
  });

  describe('hiding pages (docs/56 P2-04)', () => {
    it('hides a page from the top navigation and shows it in the Hidden zone', () => {
      render(<NavigationSection />);

      fireEvent.click(screen.getByRole('button', { name: 'Hide Work' }));
      expect(labelsIn(topList()).slice(1)).toEqual(['Desk', 'Team', 'Notes']);
      expect(labelsIn(hiddenList())).toEqual(['Work']);
      expect(screen.queryByText('Nothing is hidden.')).not.toBeInTheDocument();
      // A hidden page has no reorder controls, only ways back.
      expect(within(hiddenList().getAllByRole('listitem')[0]!).queryByRole('button', { name: /move work/i })).toBeNull();
    });

    it('hides a page that sits in the More menu', () => {
      useNavPreferencesMock.mockReturnValue({ preferences: layout(['desk', 'notes'], ['team', 'work']) });
      render(<NavigationSection />);
      fireEvent.click(screen.getByRole('button', { name: 'Hide Team' }));
      expect(labelsIn(moreList())).toEqual(['Work']);
      expect(labelsIn(hiddenList())).toEqual(['Team']);
    });

    it('saves hidden pages with the layout', async () => {
      render(<NavigationSection />);
      fireEvent.click(screen.getByRole('button', { name: 'Hide Work' }));
      fireEvent.click(screen.getByRole('button', { name: 'Hide Team' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
      await vi.waitFor(() => expect(saveMutateAsyncMock).toHaveBeenCalledWith({ topNav: ['desk', 'notes'], moreNav: [], hidden: ['work', 'team'] }));
    });

    it('shows a hidden page again, in the top navigation or the More menu', () => {
      useNavPreferencesMock.mockReturnValue({ preferences: layout(['desk'], [], ['work', 'team', 'notes']) });
      render(<NavigationSection />);
      expect(labelsIn(hiddenList())).toEqual(['Work', 'Team', 'Notes']);

      fireEvent.click(screen.getByRole('button', { name: 'Show Work in top navigation' }));
      fireEvent.click(screen.getByRole('button', { name: 'Show Team in More menu' }));
      expect(labelsIn(topList()).slice(1)).toEqual(['Desk', 'Work']);
      expect(labelsIn(moreList())).toEqual(['Team']);
      expect(labelsIn(hiddenList())).toEqual(['Notes']);
    });

    it('can hide every page, leaving only Today', () => {
      render(<NavigationSection />);
      for (const label of ['Desk', 'Team', 'Work', 'Notes']) fireEvent.click(screen.getByRole('button', { name: `Hide ${label}` }));
      expect(labelsIn(topList())).toHaveLength(1);
      expect(labelsIn(hiddenList())).toEqual(['Desk', 'Team', 'Work', 'Notes']);
    });

    it('treats undoing a hide as no change', () => {
      render(<NavigationSection />);
      fireEvent.click(screen.getByRole('button', { name: 'Hide Notes' }));
      fireEvent.click(screen.getByRole('button', { name: 'Show Notes in top navigation' }));
      expect(screen.getByRole('button', { name: 'Save layout' })).toBeDisabled();
    });
  });

  describe('pages held back until they have something to show', () => {
    it('explains why Team and Work are not in the header yet', () => {
      useNavAvailabilityMock.mockReturnValue({ team: false, work: false });
      render(<NavigationSection />);

      const items = topList().getAllByRole('listitem');
      const team = items.find((item) => item.textContent?.startsWith('Team'))!;
      const work = items.find((item) => item.textContent?.startsWith('Work'))!;
      expect(team).toHaveTextContent('Appears once you add people.');
      expect(work).toHaveTextContent('Appears once Jira is connected.');
      expect(items.find((item) => item.textContent?.startsWith('Notes'))!.textContent).not.toContain('Appears once');
    });

    it('shows the hint only for the page that is actually held back', () => {
      useNavAvailabilityMock.mockReturnValue({ team: true, work: false });
      render(<NavigationSection />);
      expect(screen.queryByText('Appears once you add people.')).not.toBeInTheDocument();
      expect(screen.getByText('Appears once Jira is connected.')).toBeInTheDocument();
    });

    it('keeps the hint on a hidden page too', () => {
      useNavAvailabilityMock.mockReturnValue({ team: false, work: true });
      useNavPreferencesMock.mockReturnValue({ preferences: layout(['desk', 'notes', 'work'], [], ['team']) });
      render(<NavigationSection />);
      expect(hiddenList().getByText('Appears once you add people.')).toBeInTheDocument();
    });
  });
});
