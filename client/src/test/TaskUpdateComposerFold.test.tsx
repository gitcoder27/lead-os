import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TaskUpdateComposer } from '@/components/tasks/TaskUpdateComposer';
import { clearTaskUpdateDraftsForScope } from '@/lib/task-update-drafts';

vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('@/context/AuthContext', () => ({ useAuthScopeKey: () => 'dev-1' }));
vi.mock('@/hooks/useTasks', () => ({
  useAddMyDayTaskEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddTaskEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const reduced = (on: boolean) => {
  window.matchMedia = ((query: string) => ({ matches: on && query.includes('reduce'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
};

function mount() {
  return render(
    <div>
      <button type="button">elsewhere</button>
      <TaskUpdateComposer taskKey="T-1" mode="developer" date="2026-10-12" collapsed quiet placeholder="Update on this task…" />
    </div>,
  );
}
const trigger = () => screen.queryByRole('button', { name: /Update on this task/ });
const field = () => screen.queryByLabelText('Add an update to T-1');

describe('collapsed update form', () => {
  beforeEach(() => { clearTaskUpdateDraftsForScope('dev-1'); reduced(true); });

  it('folds back to the one-line trigger when you click away from an empty form', () => {
    mount();
    fireEvent.click(trigger()!);
    expect(field()).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(field()).not.toBeInTheDocument();
    expect(trigger()).toBeInTheDocument();
  });

  it('stays open while clicking inside it', () => {
    mount();
    fireEvent.click(trigger()!);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Blocker' }));
    expect(field()).toBeInTheDocument();
  });

  it('keeps a draft open when you click away, so typed text is never hidden', () => {
    mount();
    fireEvent.click(trigger()!);
    fireEvent.change(field()!, { target: { value: 'half written' } });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(field()).toHaveValue('half written');
  });

  it('closes after the fold animation ends when motion is allowed', () => {
    reduced(false);
    mount();
    fireEvent.click(trigger()!);
    const reveal = field()!.closest('.task-composer-reveal') as HTMLElement;
    expect(reveal).toHaveAttribute('data-motion', 'in');
    fireEvent.animationEnd(reveal);
    expect(reveal).toHaveAttribute('data-motion', 'idle');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(reveal).toHaveAttribute('data-motion', 'out');
    expect(field()).toBeInTheDocument();
    act(() => { fireEvent.animationEnd(reveal); });
    expect(field()).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute('data-motion', 'settle');
  });
});
