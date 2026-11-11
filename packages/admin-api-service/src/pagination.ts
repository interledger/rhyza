import { IPageQuery as IGrantPageQuery } from 'auth-client-lib';
import { IPageQuery as IPaymentPageQuery } from 'payments-client-lib';
import type { operations } from './types/generated/admin-api-types.js';

export const MAX_GRANT_WALLET_ADDRESSES = 50;

/**
 * The spec types `walletAddress` as an array, but a single occurrence of the
 * query parameter arrives as a bare string, so both are accepted here.
 */
export type GrantPageQuery = Omit<
  NonNullable<operations['Grants_listGrants']['parameters']['query']>,
  'walletAddress'
> & {
  walletAddress?: string | string[];
};

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
  query: GrantPageQuery
): IGrantPageQuery & { identifiers: string[] } {
  const walletAddress = query.walletAddress;
  const identifiers =
    walletAddress == null
      ? []
      : Array.isArray(walletAddress)
        ? walletAddress
        : [walletAddress];

  return {
    ...parsePageParams(query),
    identifiers: identifiers.filter((address) => address !== ''),
    state: query.state
  };
}
