import { api } from '@/lib/api';
import type { ListPageMetadata } from '@/types';

/**
 * Keep whole-filter client search, sorting, export and bulk actions exact. Each
 * HTTP response is bounded; publish the complete list atomically so actions
 * never silently target only the first page. TanStack cancels superseded reads.
 */
export async function readListPages<T>(url: string, field: string, signal?: AbortSignal): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    signal?.throwIfAborted();
    const params = new URLSearchParams(url.split('?')[1]);
    params.set('limit', '200');
    params.set('offset', String(offset));
    const response = await api.get<Record<string, T[]> & Partial<ListPageMetadata>>(`${url.split('?')[0]}?${params}`, { signal });
    const batch = response[field];
    if (!Array.isArray(batch)) throw new Error('Invalid list page response');
    rows.push(...batch);
    // Absence supports a rolling deploy with the previous server.
    const next = response.nextOffset;
    if (next === null || next === undefined) return rows;
    if (!Number.isSafeInteger(next) || next <= offset) throw new Error('Invalid list page cursor');
    offset = next;
  }
}
