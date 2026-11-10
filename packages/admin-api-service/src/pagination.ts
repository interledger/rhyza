import {
  GrantsListGrantsRequest,
  PaymentIntentsListPaymentIntentsRequest,
  PaymentsListPaymentsRequest
} from 'admin-client-lib';
import { IPageQuery as IGrantPageQuery } from 'auth-client-lib';
import { IPageQuery as IPaymentPageQuery } from 'payments-client-lib';

export const MAX_GRANT_WALLET_ADDRESSES = 50;

export type GrantPageQuery = Omit<GrantsListGrantsRequest, 'walletAddress'> & {
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
 * The generated client types `first`/`last` as numbers, but they arrive as
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
  query: PaymentIntentsListPaymentIntentsRequest
): IPaymentPageQuery {
  return {
    ...parsePageParams(query),
    walletAddressId: query.walletAddressId
  };
}

export function parsePaymentPageQuery(
  query: PaymentsListPaymentsRequest
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
