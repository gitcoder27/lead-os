import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { ToastProvider } from '@/context/ToastContext';
import { ReviewSendStep } from '@/components/review/ReviewSendStep';
import { blankSavedState, withLineIncluded, type ReviewStepContext } from '@/lib/weekly-review';
import { reportReview, reportTask } from './fixtures/weekly-review';
const save = vi.fn(),
  finish = vi.fn(),
  clipboard = vi.fn();
vi.mock('@/hooks/useWeeklyReview', () => ({
  useReviewPastWeeks: () => ({ data: { weeks: [] }, isError: false, isPending: false }),
}));
vi.mock('@/lib/report-clipboard', () => ({ copyReport: (...args: unknown[]) => clipboard(...args) }));
function Harness() {
  const [saved, setSaved] = useState(blankSavedState('2026-09-28'));
  const review = reportReview({
    sections: [
      { id: 'closed', status: 'ready', rows: [reportTask(1, 'Shipped flow', { details: 'PRIVATE BODY' })] },
      {
        id: 'people',
        status: 'ready',
        rows: [
          {
            developerAccountId: 'dev',
            developerName: 'Priya',
            status: 'blocked',
            note: 'Private by default',
            statusUpdatedAt: null,
          },
        ],
      },
    ],
  });
  const ctx = {
    review,
    today: review.today,
    saved,
    pins: [],
    decisions: new Map(),
    personName: () => 'Priya',
    setIncluded: (id: string, defaultIncluded: boolean, included: boolean) =>
      setSaved((prev) => ({ ...prev, excluded: withLineIncluded(prev.excluded, id, defaultIncluded, included) })),
    editReport: (markdown: string | null) => setSaved((prev) => ({ ...prev, reportMarkdown: markdown })),
    saveReport: save,
    finishReview: finish,
  } as unknown as ReviewStepContext;
  return (
    <ToastProvider>
      <ReviewSendStep ctx={ctx} />
    </ToastProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  save.mockResolvedValue(undefined);
  clipboard.mockResolvedValue('text');
});
describe('Send update', () => {
  it('defaults named risks out, gives an accessible hint and toggles with x from the checkbox; y copies acknowledged text', async () => {
    render(<Harness />);
    const person = screen.getByRole('checkbox', { name: /Priya blocked/ });
    expect(person).not.toBeChecked();
    expect(person).toHaveAccessibleDescription('Names a person');
    person.focus();
    fireEvent.keyDown(person, { key: 'x' });
    expect(person).toBeChecked();
    fireEvent.keyDown(document.body, { key: 'y' });
    await waitFor(() => expect(clipboard).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith(expect.stringContaining('Priya blocked'), false);
    expect(clipboard.mock.calls[0]?.[0]).not.toContain('PRIVATE BODY');
    expect(finish).not.toHaveBeenCalled();
  });
  it('retains edited text on save failure, does not copy or finish, and succeeds on an explicit retry', async () => {
    save.mockRejectedValueOnce(new Error('Offline'));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit text' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Update text' }), {
      target: { value: '**Edited update**\n- Safe <title>' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    await screen.findByText("Couldn't finish review");
    expect(finish).not.toHaveBeenCalled();
    expect(clipboard).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Update text' })).toHaveValue('**Edited update**\n- Safe <title>');
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    await waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenLastCalledWith('**Edited update**\n- Safe <title>', true);
  });
  it('does not intercept typing y in the editor or copy empty text', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit text' }));
    const editor = screen.getByRole('textbox');
    fireEvent.keyDown(editor, { key: 'y' });
    fireEvent.change(editor, { target: { value: '' } });
    expect(clipboard).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copy for Teams' })).toBeDisabled();
  });
});
