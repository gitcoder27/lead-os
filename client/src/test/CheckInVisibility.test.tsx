import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TodayCheckInDialog } from '@/components/today/TodayCheckInDialog';
import { CheckInForm } from '@/components/team-tracker/standup/StandupLayers';

const tasks = [{ taskKey: 'T-7', title: 'Vendor contract' }];

function renderToday(note = false) {
  const onSave = vi.fn();
  render(
    <TodayCheckInDialog developerName="Alice Smith" note={note} tasks={tasks} isSaving={false} onClose={vi.fn()} onSave={onSave} />,
  );
  return onSave;
}

describe('Today check-in visibility (docs/56 P0-S6)', () => {
  it('says the check-in is visible to the developer and saves it shared by default', () => {
    const onSave = renderToday();
    expect(screen.getByRole('radio', { name: 'Visible to Alice' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Alice sees this on My Day.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Check-in note'), { target: { value: 'Talked about T-7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));
    expect(onSave).toHaveBeenCalledWith('Talked about T-7', ['T-7']);
  });

  it('saves a private check-in without task refs and hides the task picker', () => {
    const onSave = renderToday();
    fireEvent.click(screen.getByRole('radio', { name: 'Private — only you' }));
    expect(screen.queryByText('Vendor contract')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Check-in note'), { target: { value: 'Worried about T-7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));
    expect(onSave).toHaveBeenCalledWith('Worried about T-7', [], 'private');
  });

  it('has no visibility choice for a note (the person does not log in)', () => {
    renderToday(true);
    expect(screen.queryByTestId('checkin-visibility')).not.toBeInTheDocument();
  });
});

describe('Standup check-in visibility (docs/56 P0-S6)', () => {
  it('shows the choice for a check-in and reports changes', () => {
    const onVisibilityChange = vi.fn();
    render(
      <CheckInForm
        inputRef={createRef()}
        developerName="Alice Smith"
        visibility="shared"
        onVisibilityChange={onVisibilityChange}
        value=""
        pending={false}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Private — only you' }));
    expect(onVisibilityChange).toHaveBeenCalledWith('private');
  });

  it('has no choice for a note', () => {
    render(
      <CheckInForm
        inputRef={createRef()}
        note
        developerName="Alice Smith"
        visibility="shared"
        onVisibilityChange={vi.fn()}
        value=""
        pending={false}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('checkin-visibility')).not.toBeInTheDocument();
  });
});
