import { SortOrder } from 'common-types-lib';
import { GrantState } from 'auth-domain-lib';

/**
 * The query a cursor was issued for. Each field changes which position a
 * boundary id refers to, so a cursor is only meaningful against the same set.
 */
export type CursorContext = {
  sortOrder: SortOrder;
  /** Compared as a set: the same wallet addresses in any order paginate on. */
  identifiers?: readonly string[];
  state?: GrantState;
};
