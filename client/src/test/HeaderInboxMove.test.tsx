import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkAttentionSignals } from '@/components/work/WorkAttentionSignals';
import { TodayCountLink } from '@/components/layout/TodayCountLink';
import { TestWrapper } from './wrapper';
import type { Alert } from '@/types';

const mockDismiss = vi.fn();
let alerts: Alert[] = [];
let todayTotal: number | undefined = 14;

vi.mock('@/hooks/useAlerts', () => ({
  useAlerts: () => ({ data: alerts }),
  useDismissAlerts: () => ({ mutate: mockDismiss, isPending: false }),
}));
vi.mock('@/hooks/useManagerActions', () => ({
  useManagerActions: () => ({ data: todayTotal === undefined ? undefined : { totalCount: todayTotal } }),
}));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

beforeEach(() => {
  vi.clearAllMocks();
  alerts = [{ id: 'a1', type: 'overdue', severity: 'high', issueKey: 'AM-4100', message: 'Checkout fails on Safari is overdue', detectedAt: '2026-10-04T10:00:00Z' }];
  todayTotal = 14;
});

describe('header inbox becomes updates-only (UX-30)', () => {
  it('Work lists the Jira attention signals, opens one and dismisses one', () => {
    const onOpenTarget = vi.fn();
    render(<TestWrapper><WorkAttentionSignals onOpenTarget={onOpenTarget} /></TestWrapper>);
    fireEvent.click(screen.getByRole('button', { name: 'Attention signals, 1' }));
    expect(screen.getByText('Checkout fails on Safari is overdue')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Overdue signal' }));
    expect(mockDismiss).toHaveBeenCalledWith({ alertIds: ['a1'] }, expect.anything());
    fireEvent.click(screen.getByText('Checkout fails on Safari is overdue'));
    expect(onOpenTarget).toHaveBeenCalledWith(expect.objectContaining({ view: 'work', issueKey: 'AM-4100' }));
  });

  it('Work shows nothing when there are no signals', () => {
    alerts = [];
    const { container } = render(<TestWrapper><WorkAttentionSignals /></TestWrapper>);
    expect(container).toBeEmptyDOMElement();
  });

  it('"Today N" links to Today and hides at zero', () => {
    const onOpenToday = vi.fn();
    const { rerender } = render(<TodayCountLink onOpenToday={onOpenToday} />);
    const link = screen.getByRole('link', { name: 'Today: 14 to look at' });
    expect(link).toHaveAttribute('href', '/');
    fireEvent.click(link);
    expect(onOpenToday).toHaveBeenCalled();
    todayTotal = 0;
    rerender(<TodayCountLink onOpenToday={onOpenToday} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
