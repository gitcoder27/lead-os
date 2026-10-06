import { z } from "zod";
import type { ListPageMetadata } from "shared/types";

export const listPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
});

export type ListPageRequest = z.infer<typeof listPageSchema>;

/** Bound public list DTOs, after applying the complete filter and stable sort. */
export function listPage<T>(rows: T[], request: Partial<ListPageRequest> = {}): { rows: T[] } & ListPageMetadata {
  const { limit, offset } = listPageSchema.parse(request);
  const end = offset + limit;
  return { rows: rows.slice(offset, end), total: rows.length, nextOffset: end < rows.length ? end : null };
}
