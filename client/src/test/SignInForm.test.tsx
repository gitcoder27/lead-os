import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignInForm } from '@/components/auth/SignInForm';

const loginMock = vi.fn();
const postMock = vi.fn();

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ login: loginMock }),
}));

vi.mock('@/lib/api', () => ({
  api: { post: (...args: unknown[]) => postMock(...args) },
}));

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('SignInForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('trims the username, preserves the password and reports success', async () => {
    loginMock.mockResolvedValue(undefined);
    const onSignedIn = vi.fn();
    render(<SignInForm onSignedIn={onSignedIn} />);

    const submit = screen.getByRole('button', { name: 'Sign in' });
    expect(submit).toBeDisabled();
    expect(screen.getByLabelText('Username')).toHaveFocus();

    fill('Username', '  lead  ');
    fill('Password', ' secret123 ');
    fireEvent.click(submit);

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('lead', ' secret123 '));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce());
  });

  it('shows why sign-in failed and lets the person try again', async () => {
    loginMock.mockRejectedValueOnce(new Error('Invalid username or password'));
    render(<SignInForm />);
    fill('Username', 'lead');
    fill('Password', 'wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('toggles password visibility', () => {
    render(<SignInForm />);
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('checks a new password before sending it, then returns to sign-in with a notice', async () => {
    postMock.mockResolvedValue(undefined);
    const onModeChange = vi.fn();
    render(<SignInForm onModeChange={onModeChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(onModeChange).toHaveBeenLastCalledWith('change-password');

    fill('Username', 'lead');
    fill('Current password', 'old-secret');
    fill('New password', 'short');
    fill('Confirm new password', 'short');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Use at least 8 characters');
    expect(postMock).not.toHaveBeenCalled();

    fill('New password', 'long-enough-1');
    fill('Confirm new password', 'long-enough-2');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('don’t match');
    expect(postMock).not.toHaveBeenCalled();

    fill('Confirm new password', 'long-enough-1');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/auth/change-password', {
      username: 'lead',
      currentPassword: 'old-secret',
      newPassword: 'long-enough-1',
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('Password changed. Sign in with your new password.');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(onModeChange).toHaveBeenLastCalledWith('sign-in');
    // The username carries over; the old password does not.
    expect(screen.getByLabelText('Username')).toHaveValue('lead');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });
});
