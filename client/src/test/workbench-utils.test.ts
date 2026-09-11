import { describe, it, expect } from 'vitest';
import type { ManagerDeskItem } from '@/types/manager-desk';
import {
  filterItems,
  getContinuedOpenItems,
  getQuickFilterCount,
} from '@/components/manager-desk/workbench-utils';

const VIEW_DATE = '2026-03-08';

const makeItem = (overrides: Partial<ManagerDeskItem> = {}): ManagerDeskItem => ({
  id: 1,
  dayId: 1,
  originDate: VIEW_DATE,
  title: 'Desk item',
  kind: 'action',
  category: 'analysis',
  status: 'planned',
  priority: 'medium',
  createdAt: '2026-03-08T09:00:00Z',
  updatedAt: '2026-03-08T09:00:00Z',
  links: [],
  ...overrides,
});

const noStructuredFilters = { kind: null, category: null, status: null };

describe('filterItems carried lens', () => {
  it('returns open items whose originDate is earlier than the viewed date', () => {
    const items = [
      makeItem({ id: 1, title: 'Carried planned', originDate: '2026-03-06', status: 'planned' }),
      makeItem({ id: 2, title: 'Carried triage', originDate: '2026-03-07', status: 'inbox' }),
      makeItem({ id: 3, title: 'Fresh today', originDate: VIEW_DATE, status: 'planned' }),
      makeItem({ id: 4, title: 'Done carry', originDate: '2026-03-05', status: 'done' }),
      makeItem({ id: 5, title: 'Parked carry', originDate: '2026-03-05', status: 'backlog' }),
    ];

    const result = filterItems(items, '', 'carried', noStructuredFilters, VIEW_DATE);

    expect(result.map((item) => item.id)).toEqual([1, 2]);
  });

  it('matches the continued-open set used by the carried count', () => {
    const items = [
      makeItem({ id: 1, originDate: '2026-03-06', status: 'in_progress' }),
      makeItem({ id: 2, originDate: '2026-03-07', status: 'waiting' }),
      makeItem({ id: 3, originDate: VIEW_DATE, status: 'inbox' }),
      makeItem({ id: 4, originDate: '2026-03-04', status: 'cancelled' }),
    ];

    const carried = filterItems(items, '', 'carried', noStructuredFilters, VIEW_DATE);
    const continued = getContinuedOpenItems(items, VIEW_DATE);

    expect(new Set(carried.map((item) => item.id))).toEqual(new Set(continued.map((item) => item.id)));
  });

  it('combines the carried lens with search and structured filters', () => {
    const items = [
      makeItem({ id: 1, title: 'Escalate vendor issue', originDate: '2026-03-06', status: 'planned', category: 'escalation' }),
      makeItem({ id: 2, title: 'Escalate payroll', originDate: '2026-03-06', status: 'planned', category: 'admin' }),
      makeItem({ id: 3, title: 'Vendor sync today', originDate: VIEW_DATE, status: 'planned', category: 'escalation' }),
    ];

    const byCategory = filterItems(items, '', 'carried', { ...noStructuredFilters, category: 'escalation' }, VIEW_DATE);
    expect(byCategory.map((item) => item.id)).toEqual([1]);

    const bySearch = filterItems(items, 'payroll', 'carried', noStructuredFilters, VIEW_DATE);
    expect(bySearch.map((item) => item.id)).toEqual([2]);
  });
});

describe('getQuickFilterCount', () => {
  const items = [
    makeItem({ id: 1, originDate: '2026-03-06', status: 'planned' }),
    makeItem({ id: 2, originDate: '2026-03-07', status: 'inbox' }),
    makeItem({ id: 3, originDate: VIEW_DATE, status: 'planned' }),
    makeItem({ id: 4, originDate: '2026-03-05', status: 'done' }),
  ];

  it('counts carried items relative to the viewed date', () => {
    expect(getQuickFilterCount(items, 'carried', VIEW_DATE)).toBe(2);
    expect(getQuickFilterCount(items, 'all', VIEW_DATE)).toBe(4);
    expect(getQuickFilterCount(items, 'done', VIEW_DATE)).toBe(1);
  });

  it('counts zero carried items when nothing predates the viewed date', () => {
    const sameDay = [makeItem({ id: 1, originDate: VIEW_DATE, status: 'planned' })];
    expect(getQuickFilterCount(sameDay, 'carried', VIEW_DATE)).toBe(0);
  });
});
