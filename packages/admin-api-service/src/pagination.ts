import { IPageQuery as IGrantPageQuery } from 'auth-client-lib';
import { IPageQuery as IPaymentPageQuery } from 'payments-client-lib';
import type { operations } from './types/generated/admin-api-types.js';

/**
 * Shared pagination fields, extended per endpoint with their own filters.
 */
type PageParams = {
  cursor?: string;
  first?: number;
  last?: number;
  sortOrder?: 'asc' | 'desc';
};

/**
 * The spec types `first`/`last` as numbers, but they arrive as
 * strings on the wire, so they are coerced here.
 */
function parsePageParams(query: PageParams): PageParams {
  return {
    cursor: query.cursor,
    first: query.first != null ? Number(query.first) : undefined,
    last: query.last != null ? Number(query.last) : undefined,
    sortOrder: query.sortOrder
  };
}

export function parsePaymentIntentPageQuery(
  query: NonNullable<
    operations['PaymentIntents_listPaymentIntents']['parameters']['query']
  >
): IPaymentPageQuery {
  return {
    ...parsePageParams(query),
    walletAddressId: query.walletAddressId
  };
}

export function parsePaymentPageQuery(
  query: NonNullable<operations['Payments_listPayments']['parameters']['query']>
): IPaymentPageQuery & { paymentIntentId?: string } {
  return {
    ...parsePageParams(query),
    walletAddressId: query.walletAddressId,
    paymentIntentId: query.paymentIntentId
  };
}

export function parseGrantPageQuery(
  query: NonNullable<operations['Grants_listGrants']['parameters']['query']>
): IGrantPageQuery {
  return {
    ...parsePageParams(query),
    identifier: query.walletAddress,
    state: query.state
  };
}
