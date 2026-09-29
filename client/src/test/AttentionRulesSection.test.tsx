import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionRulesSection, validateAttentionDraft } from '@/components/settings/AttentionRulesSection';
import { TestWrapper } from '@/test/wrapper';
import type { AttentionRules, TeamMode } from '@/types';

const mockGet = vi.fn();
const mockPut = vi.fn();
const mockAddToast = vi.fn();
let mockTeamMode: TeamMode = 'solo';

vi.mock('@/lib/api', () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), put: (...args: unknown[]) => mockPut(...args) },
}));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: mockAddToast }) }));
vi.mock('@/hooks/useTeamMode', () => ({ useTeamMode: () => mockTeamMode }));

const DEFAULTS: AttentionRules = {
  staleHours: 4,
  noCurrentHours: 2,
  statusFollowUpHours: 2,
  managerTouchDays: 5,
  jiraStaleHours: 48,
  dayStart: '09:00',
  dayEnd: '18:00',
  timeZone: 'UTC',
};

function renderCard() {
  return render(<TestWrapper><AttentionRulesSection /></TestWrapper>);
}

const field = (name: string | RegExp) => screen.getByLabelText(name);
const save = () => screen.getByRole('button', { name: 'Save rules' });
const loaded = () => screen.findByRole('form', { name: 'Attention rules' });

describe('AttentionRulesSection (docs/56 P1-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTeamMode = 'solo';
    mockGet.mockResolvedValue({ rules: DEFAULTS, defaults: DEFAULTS });
    mockPut.mockImplementation(async (_path: string, body: AttentionRules) => ({ rules: body, defaults: DEFAULTS }));
  });

  it('loads the rules from the server and starts clean', async () => {
    mockGet.mockResolvedValue({ rules: { ...DEFAULTS, staleHours: 6, dayStart: '08:30', timeZone: 'Europe/Berlin' }, defaults: DEFAULTS });
    renderCard();
    await loaded();

    expect(mockGet).toHaveBeenCalledWith('/config/attention-rules');
    expect(field('Stale check-in after')).toHaveValue(6);
    expect(field('Untouched after')).toHaveValue(5);
    expect(field('Jira issue stale after')).toHaveValue(48);
    expect(field('Day starts')).toHaveValue('08:30');
    expect(field('Time zone')).toHaveValue('Europe/Berlin');
    expect(save()).toBeDisabled();
  });

  it('marks the check-in threshold as collaborative-only in solo mode', async () => {
    renderCard();
    await loaded();
    expect(screen.getByText('Collaborative mode only')).toBeInTheDocument();
  });

  it('hides the collaborative-only note in collab mode', async () => {
    mockTeamMode = 'collab';
    renderCard();
    await loaded();
    expect(screen.queryByText('Collaborative mode only')).not.toBeInTheDocument();
  });

  it('saves the full rule set through PUT /config/attention-rules', async () => {
    renderCard();
    await loaded();
    fireEvent.change(field('Stale check-in after'), { target: { value: '6' } });
    fireEvent.change(field('Day ends'), { target: { value: '17:30' } });
    fireEvent.click(save());

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith('/config/attention-rules', { ...DEFAULTS, staleHours: 6, dayEnd: '17:30' });
    });
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', title: 'Attention rules saved' })));
    await waitFor(() => expect(save()).toBeDisabled());
  });

  it('blocks invalid values with a message and never calls the server', async () => {
    renderCard();
    await loaded();

    fireEvent.change(field('No current work after'), { target: { value: '0' } });
    expect(screen.getByRole('alert')).toHaveTextContent('No current work after: enter a whole number from 1 to 168.');
    expect(save()).toBeDisabled();

    fireEvent.change(field('No current work after'), { target: { value: '2' } });
    fireEvent.change(field('Day starts'), { target: { value: '19:00' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Day start must be before day end.');

    fireEvent.change(field('Day starts'), { target: { value: '09:00' } });
    fireEvent.change(field('Time zone'), { target: { value: 'Mars/Olympus' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Time zone');
    fireEvent.submit(save().closest('form')!);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('shows the server error and keeps the edit when the save fails', async () => {
    mockPut.mockRejectedValueOnce(new Error('Time zone must be a valid IANA zone'));
    renderCard();
    await loaded();
    fireEvent.change(field('Untouched after'), { target: { value: '3' } });
    fireEvent.click(save());

    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'Time zone must be a valid IANA zone' })));
    expect(field('Untouched after')).toHaveValue(3);
    expect(save()).toBeEnabled();
  });

  it('Reset to defaults restores the server defaults as an unsaved change', async () => {
    mockGet.mockResolvedValue({ rules: { ...DEFAULTS, jiraStaleHours: 96, dayStart: '07:00' }, defaults: DEFAULTS });
    renderCard();
    await loaded();
    const reset = screen.getByRole('button', { name: 'Reset to defaults' });
    expect(reset).toBeEnabled();

    fireEvent.click(reset);

    expect(field('Jira issue stale after')).toHaveValue(48);
    expect(field('Day starts')).toHaveValue('09:00');
    expect(reset).toBeDisabled();
    expect(save()).toBeEnabled();
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('offers a retry when the rules cannot be loaded', async () => {
    mockGet.mockRejectedValueOnce(new Error('offline'));
    renderCard();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your attention rules.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await loaded();
    expect(field('Stale check-in after')).toHaveValue(4);
  });
});

describe('validateAttentionDraft', () => {
  it('accepts the defaults and names the bad field otherwise', () => {
    expect(validateAttentionDraft(DEFAULTS)).toBeUndefined();
    expect(validateAttentionDraft({ ...DEFAULTS, jiraStaleHours: Number.NaN })).toMatch(/^Jira issue stale after/);
    expect(validateAttentionDraft({ ...DEFAULTS, managerTouchDays: 2.5 })).toMatch(/^Untouched after/);
    expect(validateAttentionDraft({ ...DEFAULTS, dayEnd: '09:00' })).toMatch(/before day end/);
    expect(validateAttentionDraft({ ...DEFAULTS, timeZone: '' })).toMatch(/^Time zone/);
  });
});
