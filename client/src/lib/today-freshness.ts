/**
 * docs/53 U8: the freshness line must not read "Updated 6 min ago" in muted
 * text after polls start failing. One failure is a blip (still muted); two or
 * more consecutive failures mark the snapshot stale (warning tint + Retry).
 */
export type TodayFreshnessState = 'fresh' | 'retrying' | 'stale';

export interface TodayFreshness {
  state: TodayFreshnessState;
  /** Last successful fetch (ms epoch); 0 when only cached/initial data exists. */
  updatedAt: number;
  /** Consecutive failed polls since the last success. */
  failedPolls: number;
  /** Most recent failure (ms epoch), if the latest fetch failed. */
  lastErrorAt?: number;
  lastErrorMessage?: string;
}

export const TODAY_STALE_AFTER_FAILED_POLLS = 2;

export function getTodayFreshness(params: {
  dataUpdatedAt: number;
  errorUpdatedAt: number;
  failedPolls: number;
  error?: unknown;
}): TodayFreshness {
  const latestFailed = params.errorUpdatedAt > params.dataUpdatedAt;
  const failedPolls = latestFailed ? Math.max(params.failedPolls, 1) : 0;
  return {
    state: failedPolls >= TODAY_STALE_AFTER_FAILED_POLLS ? 'stale' : failedPolls > 0 ? 'retrying' : 'fresh',
    updatedAt: params.dataUpdatedAt,
    failedPolls,
    ...(latestFailed
      ? {
          lastErrorAt: params.errorUpdatedAt,
          lastErrorMessage: params.error instanceof Error ? params.error.message : undefined,
        }
      : {}),
  };
}
