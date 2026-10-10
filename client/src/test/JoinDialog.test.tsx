import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JoinDialog } from '@/components/auth/JoinDialog';
import { ApiRequestError } from '@/lib/api';
const mocks = vi.hoisted(() => ({ get: vi.fn(), login: vi.fn(), signUp: vi.fn() }));
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), api: { get: mocks.get } }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ login: mocks.login, signUp: mocks.signUp }) }));
const show = (token: string | null = 'fixture-invite') => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><JoinDialog token={token} onClose={vi.fn()} /></QueryClientProvider>);
describe('JoinDialog', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('shows a stable loading state while checking the invite', () => { mocks.get.mockReturnValue(new Promise(() => {})); show(); expect(screen.getByRole('status')).toHaveTextContent('Checking your invite'); });
  it('shows the form only after a valid invite, and switches modes within the dialog', async () => {
    mocks.get.mockResolvedValue({ valid: true }); show(); await screen.findByLabelText('Your name');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); await waitFor(() => expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument()); expect(screen.getByRole('dialog')).toHaveAccessibleName('Sign in to LeadOS');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' })); expect(screen.getByLabelText('Your name')).toBeInTheDocument(); expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it('shows a friendly invalid-invite state with sign-in as the next action', async () => { mocks.get.mockResolvedValue({ valid: false }); show(null); expect(await screen.findByText('A fresh invite is needed')).toBeInTheDocument(); expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); expect(screen.getByLabelText('Username')).toBeInTheDocument(); expect(screen.queryByText('Create account')).not.toBeInTheDocument(); });
  it('shows closed registration without a signup affordance', async () => { mocks.get.mockRejectedValue(new ApiRequestError('Not Found', 404)); show(); expect(await screen.findByText('Registration is closed')).toBeInTheDocument(); expect(screen.queryByText('Create account')).not.toBeInTheDocument(); });
  it('offers retry when invite checking fails', async () => { mocks.get.mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce({ valid: true }); show(); fireEvent.click(await screen.findByRole('button', { name: 'Try again' })); await screen.findByLabelText('Your name'); });
});
