import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DayRhythmSection, validateRhythm } from '@/components/settings/DayRhythmSection';
import { TestWrapper } from '@/test/wrapper';

const mockGet = vi.fn();
const mockPut = vi.fn();
const mockAddToast = vi.fn();

vi.mock('@/lib/api', () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), put: (...args: unknown[]) => mockPut(...args) },
}));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: mockAddToast }) }));

const DEFAULTS = { standupStart: '10:00', middayStart: '12:00', wrapUpStart: '16:00' };

function renderCard() {
  return render(<TestWrapper><DayRhythmSection /></TestWrapper>);
}

/** Inputs are disabled until the saved times arrive, so waiting for enabled means loaded. */
const standup = async () => {
  const input = await screen.findByLabelText(/Standup window starts/);
  await waitFor(() => expect(input).toBeEnabled());
  return input;
};
const midday = () => screen.getByLabelText(/Midday check starts/);
const wrapUp = () => screen.getByLabelText(/Wrap-up starts/);
const save = () => screen.getByRole('button', { name: 'Save times' });

describe('DayRhythmSection (docs/56 P2-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ boundaries: DEFAULTS });
    mockPut.mockImplementation(async (_path: string, body: { boundaries: typeof DEFAULTS }) => ({ boundaries: body.boundaries }));
  });

  it('loads the saved times from GET /today/settings and starts clean', async () => {
    mockGet.mockResolvedValue({ boundaries: { standupStart: '09:15', middayStart: '11:00', wrapUpStart: '17:30' } });
    renderCard();

    expect(await standup()).toHaveValue('09:15');
    expect(midday()).toHaveValue('11:00');
    expect(wrapUp()).toHaveValue('17:30');
    expect(mockGet).toHaveBeenCalledWith('/today/settings');
    expect(save()).toBeDisabled();
  });

  it('saves changed times through PUT /today/settings and confirms', async () => {
    renderCard();
    fireEvent.change(await standup(), { target: { value: '09:30' } });
    fireEvent.change(wrapUp(), { target: { value: '17:00' } });
    expect(save()).toBeEnabled();

    fireEvent.click(save());

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith('/today/settings', {
        boundaries: { standupStart: '09:30', middayStart: '12:00', wrapUpStart: '17:00' },
      });
    });
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', title: 'Day rhythm saved' })));
    await waitFor(() => expect(save()).toBeDisabled());
  });

  it('blocks out-of-order times with a message and never calls the server', async () => {
    renderCard();
    fireEvent.change(await standup(), { target: { value: '13:00' } });

    expect(screen.getByRole('alert')).toHaveTextContent('Times must run in order');
    expect(save()).toBeDisabled();
    fireEvent.submit(save().closest('form')!);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('blocks an empty time', async () => {
    renderCard();
    fireEvent.change(await standup(), { target: { value: '' } });

    expect(screen.getByRole('alert')).toHaveTextContent('HH:MM');
    expect(save()).toBeDisabled();
  });

  it('shows the server error and keeps the edit when the save fails', async () => {
    mockPut.mockRejectedValueOnce(new Error('Stage boundaries must be in order'));
    renderCard();
    fireEvent.change(await standup(), { target: { value: '09:00' } });
    fireEvent.click(save());

    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'Stage boundaries must be in order' })));
    expect(await standup()).toHaveValue('09:00');
    expect(save()).toBeEnabled();
  });

  it('Reset to defaults restores 10:00 / 12:00 / 16:00 as an unsaved change', async () => {
    mockGet.mockResolvedValue({ boundaries: { standupStart: '09:15', middayStart: '11:00', wrapUpStart: '17:30' } });
    renderCard();
    await standup();
    const reset = screen.getByRole('button', { name: 'Reset to defaults' });
    expect(reset).toBeEnabled();

    fireEvent.click(reset);

    expect(await standup()).toHaveValue('10:00');
    expect(midday()).toHaveValue('12:00');
    expect(wrapUp()).toHaveValue('16:00');
    expect(reset).toBeDisabled();
    expect(save()).toBeEnabled();
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('offers a retry when the times cannot be loaded', async () => {
    mockGet.mockRejectedValueOnce(new Error('offline'));
    renderCard();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your day rhythm.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await standup()).toHaveValue('10:00');
  });
});

describe('validateRhythm', () => {
  it('accepts ascending times and rejects equal, descending or malformed ones', () => {
    expect(validateRhythm(DEFAULTS)).toBeUndefined();
    expect(validateRhythm({ ...DEFAULTS, middayStart: '10:00' })).toMatch(/order/);
    expect(validateRhythm({ standupStart: '16:00', middayStart: '12:00', wrapUpStart: '10:00' })).toMatch(/order/);
    expect(validateRhythm({ ...DEFAULTS, wrapUpStart: '24:00' })).toMatch(/HH:MM/);
  });
});
