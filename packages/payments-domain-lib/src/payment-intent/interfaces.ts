import {
  PaymentIntentState,
  SentPaymentState,
  InboundPaymentState
} from 'payments-public-types-lib';

export { PaymentIntentState, SentPaymentState, InboundPaymentState };

export const PaymentIntentDestination = {
  LOCAL: 'LOCAL',
  REMOTE: 'REMOTE'
} as const;
export type PaymentIntentDestination = keyof typeof PaymentIntentDestination;

export const QuoteState = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
} as const;
export type QuoteState = keyof typeof QuoteState;

export interface IBaseQuote {
  id: string;
  state: QuoteState;
  senderWalletAddress: string;
  senderWalletAddressId: string;
  createdAt: Date;
}

export interface IPendingQuote extends IBaseQuote {
  state: 'PENDING';
  debitAmount?: bigint;
  receiveAmount?: bigint;
  peerId?: string;
  peerAssetCode?: string;
  peerAssetScale?: number;
  sourceAmount?: bigint;
  senderAssetCode?: string;
}

export interface ICompletedQuote extends IBaseQuote {
  state: 'COMPLETED';
  expiresAt: Date;
  debitAmount: bigint;
  receiveAmount: bigint;
  exchangeRate: number;
}

export interface IFailedQuote extends IBaseQuote {
  state: 'FAILED';
  errorName: string;
  message: string;
}

export type IQuote = IPendingQuote | ICompletedQuote | IFailedQuote;

export interface ISentPayment {
  id: string;
  grantId?: string;
  state: SentPaymentState;
  senderWalletAddress: string;
  senderWalletAddressId: string;
  paymentIntentId: string;
  assetCode: string;
  assetScale: number;
  createdAt: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  quoteId?: string;
  debitAmount: bigint;
  receiveAmount: bigint;
  sentAmount: bigint;
  ledgerTransferId?: string;
  failReason?: string;
}

export interface IInboundPayment {
  id: string;
  state: InboundPaymentState;
  paymentIntentId: string;
  packetId: string;
  peerId: string;
  peerAssetCode: string;
  peerAssetScale: number;
  sourceAmount: bigint;
  receiveAmount: bigint;
  createdAt: Date;
  expiresAt?: Date;
  ledgerTransferId?: string;
  failReason?: string;
}

export interface IPaymentIntent {
  id: string;
  receiverWalletAddressId?: string;
  receiverWalletAddress: string;
  state: PaymentIntentState;
  destination: PaymentIntentDestination;
  assetCode: string;
  assetScale: number;
  createdAt: Date;
  expiresAt: Date;
  incomingAmount: bigint | null;
  receivedAmount: bigint;
  quotes: IQuote[];
  sentPayments: ISentPayment[];
  inboundPayments: IInboundPayment[];
  destinationIlpAddress?: string;
  remoteUrl?: string;
  peerId?: string;
}

export interface IWalletAddress {
  id: string;
  isActive: boolean;
  assetCode: string;
  assetScale: number;
}

export type IFxRateRequest =
  | { peerId: string; sourceAssetCode: string }
  | { peerId: string; destinationAssetCode: string }
  | { sourceAssetCode: string; destinationAssetCode: string };

export interface IPeer {
  peerId: string;
  assetCode: string;
  assetScale: number;
}

export interface IPalService {
  getWalletAddresses(ids: string[]): Promise<IWalletAddress[]>;
  getPeerByIlpAddress(ilpAddress: string): Promise<IPeer | null>;
  getPeerById(peerId: string): Promise<IPeer | null>;
  getRates(request: IFxRateRequest): Promise<number | null>;
}

export interface IRemotePaymentIntentDetails {
  walletAddress: string;
  assetCode: string;
  assetScale: number;
  incomingAmount?: bigint;
  receivedAmount: bigint;
  expiresAt?: string;
  destinationIlpAddress: string;
  sharedSecret: string;
}

export interface IRemotePaymentIntentService {
  fetchIncomingPayment(url: string): Promise<IRemotePaymentIntentDetails>;
}

export type FinalizedRemoteQuoteUpdate =
  | {
      paymentIntentId: string;
      quoteId: string;
      state: 'COMPLETED';
      debitAmount: bigint;
      receiveAmount: bigint;
      exchangeRate: number;
      expiresAt: Date;
    }
  | {
      paymentIntentId: string;
      quoteId: string;
      state: 'FAILED';
      errorName: string;
      message: string;
    };

export type SortOrder = 'asc' | 'desc';
export const DEFAULT_SORT_ORDER: SortOrder = 'desc';

export interface IPageOpts {
  walletAddressId?: string;
  cursor?: string;
  limit: number;
  /** false = forward (first/after), true = backward (last/before). */
  backwards: boolean;
  sortOrder?: SortOrder;
}

export interface IPage<T> {
  items: T[];
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface IPaymentIntentRepository {
  storeMany(paymentIntents: IPaymentIntent[]): Promise<void>;
  storeCompletedPaymentIntents(
    paymentIntents: { id: string; state: PaymentIntentState }[]
  ): Promise<void>;
  fetchByIds(
    ids: string[]
  ): Promise<Omit<IPaymentIntent, 'sentPayments' | 'inboundPayments'>[]>;
  fetchByIdsWithPayments(ids: string[]): Promise<IPaymentIntent[]>;
  fetchIdsByRemoteUrls(
    urls: string[]
  ): Promise<Array<{ id: string; remoteUrl: string }>>;
  /** Keyset-paginated payment intents, filterable by receiverWalletAddressId. */
  fetchPaymentIntentsPage(
    opts: IPageOpts
  ): Promise<IPage<Omit<IPaymentIntent, 'sentPayments' | 'inboundPayments'>>>;
  /** Keyset-paginated sent payments, filterable by senderWalletAddressId and/or paymentIntentId. */
  fetchSentPaymentsPage(
    opts: IPageOpts & { paymentIntentId?: string }
  ): Promise<IPage<ISentPayment>>;
  storeQuotes(
    quoteUpdates: { quoteIds: string[]; paymentIntent: IPaymentIntent }[]
  ): Promise<void>;
  storeSentPayments(
    paymentUpdates: { paymentIds: string[]; paymentIntent: IPaymentIntent }[]
  ): Promise<void>;
  storeInboundPayments(
    inboundPaymentUpdates: {
      inboundPaymentIds: string[];
      paymentIntent: IPaymentIntent;
    }[]
  ): Promise<void>;
  storeAcceptedInboundPayments(
    inboundPaymentUpdates: {
      inboundPayments: {
        id: string;
        state: InboundPaymentState;
        ledgerTransferId: string;
      }[];
    }[]
  ): Promise<void>;
  storeFailedInboundPayments(
    inboundPaymentUpdates: {
      inboundPayments: {
        id: string;
        state: InboundPaymentState;
        failReason?: string;
      }[];
    }[]
  ): Promise<void>;
  storeFulfillableInboundPayments(
    inboundPaymentUpdates: {
      inboundPayments: { id: string; state: InboundPaymentState }[];
    }[]
  ): Promise<void>;
  storeFinalizedInboundPayments(
    inboundPaymentUpdates: {
      paymentIntent: {
        id: string;
        receivedAmount: bigint;
        state: PaymentIntentState;
      };
      inboundPayments: { id: string; state: InboundPaymentState }[];
    }[]
  ): Promise<void>;
  storeCompletedLocalPayments(
    paymentUpdates: {
      paymentIntent: {
        id: string;
        receivedAmount: bigint;
        state: PaymentIntentState;
      };
      sentPayments: {
        id: string;
        state: SentPaymentState;
        sentAmount: bigint;
      }[];
    }[]
  ): Promise<void>;
  storeCancelledPayments(
    paymentUpdates: {
      sentPayments: {
        id: string;
        state: SentPaymentState;
        cancelledAt: Date;
        cancelReason?: string;
      }[];
    }[]
  ): Promise<void>;
  storeApprovedRemotePayments(
    paymentUpdates: {
      sentPayments: { id: string; state: SentPaymentState }[];
    }[]
  ): Promise<void>;
  storeSendingRemotePayments(
    paymentUpdates: {
      sentPayments: {
        id: string;
        state: SentPaymentState;
        ledgerTransferId: string;
      }[];
    }[]
  ): Promise<void>;
  storeFailedRemotePayments(
    paymentUpdates: {
      sentPayments: {
        id: string;
        state: SentPaymentState;
        failReason?: string;
      }[];
    }[]
  ): Promise<void>;
  storeConfirmedRemotePayments(
    paymentUpdates: {
      sentPayments: { id: string; state: SentPaymentState }[];
    }[]
  ): Promise<void>;
  storeRejectedRemotePayments(
    paymentUpdates: {
      sentPayments: {
        id: string;
        state: SentPaymentState;
        failReason?: string;
      }[];
    }[]
  ): Promise<void>;
  storeCompletedRemotePayments(
    paymentUpdates: {
      paymentIntent: {
        id: string;
        receivedAmount: bigint;
        state: PaymentIntentState;
      };
      sentPayments: {
        id: string;
        state: SentPaymentState;
        sentAmount: bigint;
      }[];
    }[]
  ): Promise<void>;
  storeFinalizedRemoteQuotes(
    updates: FinalizedRemoteQuoteUpdate[]
  ): Promise<void>;
}
