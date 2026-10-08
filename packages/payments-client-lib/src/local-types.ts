export interface IClientErrorResponse {
  error: {
    code: string;
    description: string;
  };
}

export interface IAmount {
  value: bigint;
  assetCode: string;
  assetScale: number;
}

/** Order of a page's results by creation time. */
export type PageSortOrder = 'asc' | 'desc';

export interface IPageQuery {
  walletAddressId?: string;
  /** Opaque cursor from a previous page's startCursor/endCursor. */
  cursor?: string;
  /** Page size, paginating forward from the cursor. Mutually exclusive with `last`. */
  first?: number;
  /** Page size, paginating backward from the cursor (requires `cursor`). */
  last?: number;
  /** Ordering by creation time. Omit to use the server default (newest first). */
  sortOrder?: PageSortOrder;
}

export interface IPageInfo {
  startCursor?: string;
  endCursor?: string;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface IPage<T> {
  /**
   * In the requested (createdAt, id) sortOrder, regardless of whether the
   * page was reached by paginating forward or backward.
   */
  items: T[];
  pagination: IPageInfo;
}

export type IncomingPaymentInput =
  | { incomingPaymentId: string }
  | { incomingPaymentUrl: string };

export interface CreatePaymentIntentResult {
  id: string;
  receiverWalletAddress: string;
  state: string;
  destination: string;
  receivedAmount: bigint;
  assetCode: string;
  assetScale: number;
  incomingAmount?: bigint;
  expiresAt?: string;
  createdAt: string;
}

export interface CompletePaymentIntentResult {
  id: string;
  receiverWalletAddress: string;
  state: string;
  destination: string;
  receivedAmount: bigint;
  assetCode: string;
  assetScale: number;
  incomingAmount?: bigint;
  expiresAt?: string;
  createdAt: string;
}

export interface CreateQuoteResult {
  id: string;
  paymentIntentId: string;
  senderWalletAddress: string;
  senderWalletAddressId: string;
  expiresAt: string;
  createdAt: string;
  debitAmount: bigint;
  receiveAmount: bigint;
  exchangeRate: number;
}

export interface CreatePaymentResult {
  id: string;
}

export interface ApprovePaymentResult {
  id: string;
  state?: string;
}

export interface CancelPaymentResult {
  id: string;
}

export interface GetPaymentIntentResult {
  id: string;
  receiverWalletAddress: string;
  state: string;
  destination: string;
  receivedAmount: bigint;
  assetCode: string;
  assetScale: number;
  incomingAmount?: bigint;
  expiresAt?: string;
  destinationIlpAddress?: string;
  createdAt: string;
  remoteUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface GetQuoteResult {
  id: string;
  paymentIntentId: string;
  state: string;
  senderWalletAddress: string;
  senderWalletAddressId: string;
  createdAt: string;
  expiresAt?: string;
  debitAmount?: bigint;
  receiveAmount?: bigint;
  exchangeRate?: number;
  sourceAmount?: bigint;
  senderAssetCode?: string;
  errorName?: string;
  message?: string;
}

export interface GetPaymentResult {
  id: string;
  state: string;
  senderWalletAddress: string;
  senderWalletAddressId: string;
  paymentIntentId: string;
  quoteId?: string;
  /** Denominated in the sender-side asset. */
  debitAmount: IAmount;
  /** Denominated in the receive-side asset (the parent intent's), which differs for cross-currency payments. */
  receiveAmount: IAmount;
  /** Denominated in the sender-side asset. */
  sentAmount: IAmount;
  createdAt: string;
  /** Parent intent's remoteUrl, set for REMOTE intents. */
  remoteUrl?: string;
  failReason?: string;
  metadata?: Record<string, unknown>;
}
