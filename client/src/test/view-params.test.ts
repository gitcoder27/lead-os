import { describe, expect, it } from 'vitest';
import { DEFAULT_DASHBOARD_FILTER_STATE } from '@/components/layout/dashboard-state';
import {
  dashboardFilterStateFromParams,
  dashboardFilterStateToSearch,
  deskDateFromParams,
  deskDateToSearch,
  notesDateFromParams,
  taskKeyFromParams,
  taskKeyToParams,
  teamBoardQueryFromParams,
  teamBoardQueryToSearch,
  writeTaskParam,
} from '@/lib/view-params';

function paramsFromSearch(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

describe('dashboardFilterState serialization', () => {
  it('emits nothing for the default state', () => {
    expect(dashboardFilterStateToSearch(DEFAULT_DASHBOARD_FILTER_STATE)).toBe('');
  });

  it('round-trips a fully populated filter state', () => {
    const state = {
      activeFilter: 'blocked' as const,
      activeDeveloper: 'dev-1',
      selectedTagId: 3,
      noTagsFilter: true,
    };

    const search = dashboardFilterStateToSearch(state);
    expect(search).toBe('?filter=blocked&dev=dev-1&tag=3&noTags=1');
    expect(dashboardFilterStateFromParams(paramsFromSearch(search))).toEqual(state);
  });

  it('drops unknown filter values and malformed numbers on parse', () => {
    const state = dashboardFilterStateFromParams(paramsFromSearch('?filter=banana&tag=abc&dev=dev-2'));

    expect(state.activeFilter).toBe('all');
    expect(state.selectedTagId).toBeUndefined();
    expect(state.activeDeveloper).toBe('dev-2');
  });
});

describe('teamBoardQuery serialization', () => {
  it('omits default sort and grouping', () => {
    expect(teamBoardQueryToSearch({ sortBy: 'attention', q: 'priya', summaryFilter: 'blocked' })).toBe(
      '?q=priya&filter=blocked',
    );
  });

  it('round-trips a saved-view query', () => {
    const query = { q: 'rollout', summaryFilter: 'stale' as const, sortBy: 'load' as const, groupBy: 'status' as const, viewId: 12 };

    const search = teamBoardQueryToSearch(query);
    expect(search).toBe('?q=rollout&filter=stale&sort=load&group=status&view=12');
    expect(teamBoardQueryFromParams(paramsFromSearch(search))).toEqual(query);
  });

  it('drops unknown enum values on parse', () => {
    const query = teamBoardQueryFromParams(paramsFromSearch('?filter=banana&sort=sideways&group=circle'));

    expect(query).toEqual({ summaryFilter: undefined, sortBy: undefined, groupBy: undefined, viewId: undefined, q: undefined });
  });
});

describe('desk date serialization', () => {
  it('round-trips a valid date and rejects malformed ones', () => {
    expect(deskDateToSearch('2026-03-07')).toBe('?date=2026-03-07');
    expect(deskDateToSearch(undefined)).toBe('');
    expect(deskDateFromParams(paramsFromSearch('?date=2026-03-07'))).toBe('2026-03-07');
    expect(deskDateFromParams(paramsFromSearch('?date=yesterday'))).toBeUndefined();
    expect(deskDateFromParams(paramsFromSearch('?date=2026-13-99'))).toBeUndefined();
  });
});

describe('notes date serialization', () => {
  it('returns a valid ISO date and rejects invalid values', () => {
    expect(notesDateFromParams(paramsFromSearch('?date=2026-09-12'))).toBe('2026-09-12');
    expect(notesDateFromParams(paramsFromSearch('?date=2026-02-30'))).toBeUndefined();
    expect(notesDateFromParams(paramsFromSearch('?date=tomorrow'))).toBeUndefined();
    expect(notesDateFromParams(paramsFromSearch('?other=1'))).toBeUndefined();
  });
});

describe('task key params', () => {
  it('parses and canonicalizes task keys', () => {
    expect(taskKeyFromParams(paramsFromSearch('?task=T-5'))).toBe('T-5');
    expect(taskKeyFromParams(paramsFromSearch('?task=t-42'))).toBe('T-42');
    expect(taskKeyFromParams(paramsFromSearch('?task=T-007'))).toBe('T-7');
    expect(taskKeyFromParams(paramsFromSearch('?task=banana'))).toBeUndefined();
    expect(taskKeyFromParams(paramsFromSearch('?task=T5'))).toBeUndefined();
    expect(taskKeyFromParams(paramsFromSearch('?task=T-1234567890'))).toBeUndefined();
    expect(taskKeyFromParams(paramsFromSearch('?other=1'))).toBeUndefined();
  });

  it('serializes task keys', () => {
    expect(taskKeyToParams('T-9')).toEqual({ task: 'T-9' });
    expect(taskKeyToParams(undefined)).toEqual({ task: undefined });
  });

  it('writes and removes the task param without touching other params', () => {
    window.history.replaceState(null, '', '/team?q=alice');
    writeTaskParam('T-3');
    expect(window.location.search).toBe('?q=alice&task=T-3');
    writeTaskParam('T-3');
    expect(window.location.search).toBe('?q=alice&task=T-3');
    writeTaskParam(undefined);
    expect(window.location.search).toBe('?q=alice');
    window.history.replaceState(null, '', '/');
  });
});
