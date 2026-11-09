/**
 * Keyset pagination over `(createdAt, id)`, shared by every bounded context
 * that paginates a collection. Each context keeps its own options type for its
 * own filters; only the cursor mechanics are common.
 */
export type SortOrder = 'asc' | 'desc';
export const DEFAULT_SORT_ORDER: SortOrder = 'desc';

/**
 * One page of stored records, in the requested sort order regardless of which
 * direction it was reached from.
 */
export interface IPage<T> {
  items: T[];
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/** The cursor fields a paginated query needs, before its own filters. */
export interface IPageOpts {
  /** Opaque to callers; the boundary record's id. */
  cursor?: string;
  limit: number;
  /** false = forward (first/after), true = backward (last/before). */
  backwards: boolean;
  sortOrder?: SortOrder;
}
