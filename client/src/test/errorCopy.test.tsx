import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import { describeLoadError } from '@/lib/error-copy';
import { TaskListError } from '@/components/tasks/TaskListStates';

describe('describeLoadError (docs/73 UXD-27)', () => {
  it('never uses the server message as the headline', () => {
    const copy = describeLoadError(new ApiRequestError('boom', 500), 'Inbox');
    expect(copy.headline).toBe("Couldn't load Inbox. Something went wrong on the server; retry in a moment.");
    expect(copy.headline).not.toContain('boom');
    expect(copy.detail).toBe('boom · Status 500');
  });

  it('reads a failed fetch as a connection problem', () => {
    expect(describeLoadError(new TypeError('Failed to fetch'), 'Inbox')).toEqual({
      headline: "Couldn't load Inbox. Check your connection, then retry.",
      reason: 'Check your connection, then retry.',
      detail: 'Failed to fetch',
    });
  });

  it('names the session, access and missing cases plainly', () => {
    expect(describeLoadError(new ApiRequestError('Unauthorized', 401)).headline).toBe('Your session has ended. Sign in again to continue.');
    expect(describeLoadError(new ApiRequestError('Forbidden', 403), 'Settings').headline).toBe("You don't have access to Settings.");
    expect(describeLoadError(new ApiRequestError('Not found', 404), 'this task').headline).toBe("This task isn't available any more.");
    expect(describeLoadError(new ApiRequestError('Slow down', 429), 'Inbox').headline).toMatch(/busy/);
    expect(describeLoadError(new ApiRequestError('Bad input', 400), 'Inbox').headline).toBe("Couldn't load Inbox. Retry, or reload the page.");
  });
});

describe('TaskListError (docs/73 UXD-27)', () => {
  it('shows the plain headline and keeps the server detail behind Details', () => {
    const onRetry = vi.fn();
    const copy = describeLoadError(new ApiRequestError('boom', 500), 'Inbox');
    render(<TaskListError message={copy.headline} detail={copy.detail} onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load Inbox.");
    expect(screen.getByText('boom · Status 500')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('boom · Status 500')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('formatRelativeTime (UXD-29)', () => {
  it('reads "just now" under a minute and relative beyond it', async () => {
    const { formatRelativeTime } = await import('@/lib/utils');
    expect(formatRelativeTime(new Date(Date.now() - 5_000).toISOString())).toBe('just now');
    expect(formatRelativeTime(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('5 minutes ago');
    expect(formatRelativeTime('not a date')).toBe('not a date');
  });
});
