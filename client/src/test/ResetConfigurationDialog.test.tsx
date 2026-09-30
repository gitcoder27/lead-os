import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ResetConfigurationDialog, RESET_CONFIGURATION_TEXT } from '@/components/settings/ResetConfigurationDialog';

function renderDialog(overrides: Partial<Parameters<typeof ResetConfigurationDialog>[0]> = {}) {
  const props = {
    backupBeforeReset: true,
    isResetting: false,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<ResetConfigurationDialog {...props} />);
  return props;
}

const confirmButton = () => screen.getByRole('button', { name: 'Reset configuration' });

describe('ResetConfigurationDialog (docs/56 P6-06)', () => {
  it('is an alert dialog that lists what is lost and what is kept', () => {
    renderDialog();

    const dialog = screen.getByRole('alertdialog');
    const lost = within(dialog).getByRole('list', { name: 'What is lost' });
    expect(within(lost).getByText(/Jira connection and saved API token/)).toBeInTheDocument();
    expect(within(lost).getByText(/Copilot provider, model and API key/)).toBeInTheDocument();
    expect(within(lost).getByText(/Backup schedule, day rhythm, attention rules, team mode/)).toBeInTheDocument();
    expect(within(lost).getByText(/synced Jira issues/)).toBeInTheDocument();
    expect(within(lost).getByText(/Tracked team members/)).toBeInTheDocument();
    expect(within(dialog).getByText(/your tasks, notes, Desk items/)).toBeInTheDocument();
  });

  it('keeps the destructive button disabled until the phrase is typed (case-insensitive, trimmed)', () => {
    const { onConfirm } = renderDialog();
    const input = screen.getByLabelText('Confirmation text');

    expect(confirmButton()).toBeDisabled();
    fireEvent.change(input, { target: { value: 'reset' } });
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: `  ${RESET_CONFIGURATION_TEXT.toLowerCase()} ` } });
    expect(confirmButton()).toBeEnabled();
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('focuses the confirmation field and cancels with Escape without confirming', () => {
    const { onConfirm, onClose } = renderDialog();

    expect(screen.getByLabelText('Confirmation text')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('says whether a backup is taken first', () => {
    renderDialog({ backupBeforeReset: true });
    expect(screen.getByText(/A backup is taken first/)).toBeInTheDocument();
  });

  it('warns loudly when the pre-reset backup is off', () => {
    renderDialog({ backupBeforeReset: false });
    expect(screen.getByText(/this cannot be undone/)).toBeInTheDocument();
    expect(screen.queryByText(/A backup is taken first/)).not.toBeInTheDocument();
  });

  it('shows a server error inline and locks the form while resetting', () => {
    renderDialog({ error: 'Type "RESET CONFIGURATION" to confirm this reset', isResetting: true });

    expect(screen.getByRole('alert')).toHaveTextContent('to confirm this reset');
    expect(screen.getByLabelText('Confirmation text')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Resetting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
