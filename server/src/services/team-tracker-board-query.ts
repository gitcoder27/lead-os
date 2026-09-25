import type {
  TeamTrackerBoardGroupBy,
  TeamTrackerBoardQuery,
  TeamTrackerBoardResolvedQuery,
  TeamTrackerBoardSort,
  TrackerBoardSummaryFilter,
} from "shared/types";

export const DEFAULT_BOARD_QUERY: TeamTrackerBoardResolvedQuery = {
  q: "",
  summaryFilter: "all",
  sortBy: "name",
  groupBy: "none",
};

export function normalizeBoardSearchQuery(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Phase 3 (§7.1): capacity tracking is removed; stored "over_capacity"
 *  filters (saved views, old URLs) degrade to the unfiltered board. */
function normalizeSummaryFilter(value: TrackerBoardSummaryFilter | string | undefined): TrackerBoardSummaryFilter {
  return !value || (value as string) === "over_capacity"
    ? DEFAULT_BOARD_QUERY.summaryFilter
    : (value as TrackerBoardSummaryFilter);
}

export function resolveUnsavedBoardQuery(
  rawQuery?: TeamTrackerBoardQuery
): TeamTrackerBoardResolvedQuery {
  const normalizedRawQuery = rawQuery ?? {};

  return {
    ...DEFAULT_BOARD_QUERY,
    q: normalizeBoardSearchQuery(normalizedRawQuery.q),
    summaryFilter: normalizeSummaryFilter(normalizedRawQuery.summaryFilter),
    sortBy: normalizedRawQuery.sortBy ?? DEFAULT_BOARD_QUERY.sortBy,
    groupBy: normalizedRawQuery.groupBy ?? DEFAULT_BOARD_QUERY.groupBy,
  };
}

export function normalizeSavedViewQuery(input: {
  q?: string;
  summaryFilter?: TrackerBoardSummaryFilter;
  sortBy?: TeamTrackerBoardSort;
  groupBy?: TeamTrackerBoardGroupBy;
}): Omit<TeamTrackerBoardResolvedQuery, "viewId"> {
  return {
    q: normalizeBoardSearchQuery(input.q),
    summaryFilter: normalizeSummaryFilter(input.summaryFilter),
    sortBy: input.sortBy ?? DEFAULT_BOARD_QUERY.sortBy,
    groupBy: input.groupBy ?? DEFAULT_BOARD_QUERY.groupBy,
  };
}
