import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignUpForm } from '@/components/auth/SignUpForm';
const signUp = vi.fn();
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ signUp }) }));
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
function show() { const onSignIn = vi.fn(); render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><SignUpForm inviteToken="fixture-invite" onSignIn={onSignIn} /></QueryClientProvider>); return onSignIn; }
function valid() { fill('Your name', '  Friend  '); fill('Username', ' Friend.User '); fill('Password', ' fixture-password '); fill('Confirm password', ' fixture-password '); }
describe('SignUpForm', () => {
  beforeEach(() => { vi.clearAllMocks(); signUp.mockResolvedValue(undefined); });
  it('labels fields, supplies password-manager attributes and starts quietly disabled', () => {
    show(); expect(screen.getByLabelText('Your name')).toHaveFocus(); expect(screen.getByLabelText('Your name')).toHaveAttribute('autocomplete', 'name');
    expect(screen.getByLabelText('Username')).toHaveAttribute('autocomplete', 'username'); expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled(); expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.getByText(/8–200 characters/)).toBeInTheDocument();
  });
  it('validates on blur rather than each keystroke and connects the hint', () => {
    show(); fill('Username', '_bad'); expect(screen.queryByText(/starting with a letter/)).not.toBeInTheDocument();
    fireEvent.blur(screen.getByLabelText('Username')); expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Username')).toHaveAccessibleDescription(/starting with a letter/);
    fill('Username', 'root'); fireEvent.blur(screen.getByLabelText('Username')); expect(screen.getByText('Choose a different username.')).toBeInTheDocument();
  });
  it('refuses invalid submission and focuses the first invalid field', async () => {
    show(); valid(); fill('Username', '_bad'); fill('Password', 'password123'); fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(signUp).not.toHaveBeenCalled(); await waitFor(() => expect(screen.getByLabelText('Username')).toHaveFocus()); expect(screen.getByText(/less common password/)).toBeInTheDocument();
  });
  it('validates confirmation on blur and refuses a mismatched password', () => {
    show(); valid(); fill('Confirm password', 'wrong-password');
    expect(screen.queryByText('Enter the same password again.')).not.toBeInTheDocument();
    fireEvent.blur(screen.getByLabelText('Confirm password'));
    expect(screen.getByLabelText('Confirm password')).toHaveAccessibleDescription('Enter the same password again.');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(signUp).not.toHaveBeenCalled();
  });
  it('normalizes identity, preserves the password, supplies the zone and locks a pending submit', async () => {
    let resolve!: () => void; signUp.mockReturnValue(new Promise<void>(r => { resolve = r; })); show(); valid();
    const button = screen.getByRole('button', { name: 'Create account' }); fireEvent.click(button); fireEvent.submit(button.closest('form')!);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Creating account…' })).toBeDisabled());
    expect(signUp).toHaveBeenCalledTimes(1); expect(signUp).toHaveBeenCalledWith({ inviteToken: 'fixture-invite', username: 'friend.user', displayName: 'Friend', password: ' fixture-password ', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }); resolve();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create account' })).not.toBeDisabled());
  });
  it('announces a specific server error and permits retry', async () => {
    signUp.mockRejectedValueOnce(new Error('That username is taken.')); show(); valid(); fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That username is taken.'); expect(screen.getByRole('button', { name: 'Create account' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' })); await waitFor(() => expect(signUp).toHaveBeenCalledTimes(2));
  });
  it('shows and hides a password and offers the sign-in switch', () => {
    const switchMode = show(); fill('Password', 'fixture-pass'); fireEvent.click(screen.getByRole('button', { name: 'Show password' })); expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' })); expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password'); fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); expect(switchMode).toHaveBeenCalledOnce();
  });
});
