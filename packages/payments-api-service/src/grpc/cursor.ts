import { SortOrder } from 'common-types-lib';

/**
 * The query a cursor was issued for. Each field changes which position a
 * boundary id refers to, so a cursor is only meaningful against the same set.
 */
export interface CursorContext {
  sortOrder: SortOrder;
  walletAddressId?: string;
  paymentIntentId?: string;
}
