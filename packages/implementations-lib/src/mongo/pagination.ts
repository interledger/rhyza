import { Collection, Filter } from 'mongodb';
import {
  DEFAULT_SORT_ORDER,
  InvalidArgument,
  InvalidCursorError,
  IPage,
  IPageOpts
} from 'common-types-lib';

/**
 * Walks the `(createdAt, id)` index from an optional cursor, returning one
 * page plus whether more exist on either side.
 *
 * Shared by every bounded context that paginates a Mongo collection. The
 * caller supplies its own `filter`, so only the cursor mechanics live here —
 * which is the part that is subtle and the part that has to agree everywhere.
 */
export async function fetchPageDocs<T extends { id: string; createdAt: Date }>(
  collection: Collection<T>,
  filter: Record<string, unknown>,
  opts: IPageOpts
): Promise<IPage<T>> {
  const { cursor, limit, backwards } = opts;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new InvalidArgument(`limit must be a positive integer, got ${limit}`);
  }
  const descending = (opts.sortOrder ?? DEFAULT_SORT_ORDER) === 'desc';

  let boundary: { id: string; createdAt: Date } | null = null;
  if (cursor != null) {
    boundary = (await collection.findOne({ id: cursor } as Filter<T>, {
      projection: { _id: 0, id: 1, createdAt: 1 }
    })) as { id: string; createdAt: Date } | null;
    if (!boundary) {
      throw new InvalidCursorError(`Unknown cursor: ${cursor}`);
    }
  }

  // Which way we walk the index from the cursor. Paging forward through a
  // descending list moves towards *older*.
  const scanAscending = backwards === descending;

  const cmp = scanAscending ? '$gt' : '$lt';
  const range = boundary
    ? {
        $or: [
          { createdAt: { [cmp]: boundary.createdAt } },
          { createdAt: boundary.createdAt, id: { [cmp]: boundary.id } }
        ]
      }
    : {};

  const docs = (await collection
    .find({ ...filter, ...range } as Filter<T>, { projection: { _id: 0 } })
    .sort(scanAscending ? { createdAt: 1, id: 1 } : { createdAt: -1, id: -1 })
    .limit(limit + 1)
    .toArray()) as T[];

  const hasMore = docs.length > limit;
  const items = docs.slice(0, limit);
  if (backwards) items.reverse();

  return {
    items,
    hasNextPage: backwards ? cursor != null : hasMore,
    hasPreviousPage: backwards ? hasMore : cursor != null
  };
}
