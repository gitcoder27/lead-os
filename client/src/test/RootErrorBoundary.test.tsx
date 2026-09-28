import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RootErrorBoundary } from '@/components/layout/RootErrorBoundary';

function Boom({ message = 'kaboom' }: { message?: string }): never {
  throw new Error(message);
}

describe('RootErrorBoundary', () => {
  const reload = vi.fn();
  const assign = vi.fn();

  beforeEach(() => {
    reload.mockClear();
    assign.mockClear();
    window.sessionStorage.clear();
    vi.stubGlobal('location', { reload, assign });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders children when nothing throws', () => {
    render(
      <RootErrorBoundary>
        <p>all good</p>
      </RootErrorBoundary>,
    );
    expect(screen.getByText('all good')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a recovery screen when a child throws during render', () => {
    render(
      <RootErrorBoundary>
        <Boom />
      </RootErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();
    expect(screen.getByText('kaboom')).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it('Reload reloads the page and Go to Today navigates to /', () => {
    render(
      <RootErrorBoundary>
        <Boom />
      </RootErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Go to Today' }));
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('reloads once automatically for a chunk-load error, then shows the screen if it repeats', () => {
    const chunkError = 'Failed to fetch dynamically imported module: /assets/TasksPage-abc.js';
    const { unmount } = render(
      <RootErrorBoundary>
        <Boom message={chunkError} />
      </RootErrorBoundary>,
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    unmount();

    render(
      <RootErrorBoundary>
        <Boom message={chunkError} />
      </RootErrorBoundary>,
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
