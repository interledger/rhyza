import { IPage, IPageOpts } from 'common-types-lib';

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

export interface IQuoteRoute {
  peerId: string;
  peerAssetCode: string;
  peerAssetScale: number;
  sourceAmount: bigint;
  senderAssetCode: string;
}

export interface IBaseQuote {
  id: string;
  state: QuoteState;
  senderWalletAddress: string;
  senderWalletAddressId: string;
  createdAt: Date;

  /**
   * Remote quote route. Fixed when the quote is created, absent for a local
   * quote.
   */
  route?: IQuoteRoute;
}

export interface IPendingQuote extends IBaseQuote {
  state: 'PENDING';
  debitAmount?: bigint;
  receiveAmount?: bigint;
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

/** Fields every payment has (local or remote). */
interface IBaseSentPayment {
  id: string;
  state: SentPaymentState;
  senderWalletAddress: string;
  senderWalletAddressId: string;
  paymentIntentId: string;
  assetCode: string;
  assetScale: number;
  createdAt: Date;
  debitAmount: bigint;
  sentAmount: bigint;
  quoteId?: string;
  grantId?: string;
  cancelledAt?: Date;
  cancelReason?: string;
  metadata?: Record<string, unknown>;
}

export interface ILocalSentPayment extends IBaseSentPayment {
  destination: 'LOCAL';
  /** Computed at creation, so never unknown. */
  receiveAmount: bigint;
}

export interface IRemoteSentPayment extends IBaseSentPayment {
  destination: 'REMOTE';
  /** The peer this payment routes through. */
  peerId: string;
  /** Null when the payment was created without a quote, which fixes only the debit side. */
  receiveAmount: bigint | null;
  /** Set when the payment is prepared. */
  ledgerTransferId?: string;
  /** Set when the payment is rejected or fails. */
  failReason?: string;
}

/**
 * A payment the domain operates on. `destination` is inherited from the parent
 * intent and never changes, which is what makes it safe to discriminate on:
 * there is no transition that could drop an arm's fields.
 */
export type ISentPayment = ILocalSentPayment | IRemoteSentPayment;

export function isRemoteSentPayment(
  payment: ISentPayment
): payment is IRemoteSentPayment {
  return payment.destination === 'REMOTE';
}

/**
 * A payment as it is stored and read back out. Carries no `destination` — that
 * is the parent intent's fact, supplied when the domain object is hydrated —
 * so reads which do not need domain behaviour can use this shape directly.
 */
export interface IStoredSentPayment extends IBaseSentPayment {
  peerId?: string;
  receiveAmount: bigint | null;
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
  metadata?: Record<string, unknown>;
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
  fetchPaymentIntent(url: string): Promise<IRemotePaymentIntentDetails>;
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

/** Page opts for this bounded context's lists, which scope by wallet address. */
export interface IPaymentPageOpts extends IPageOpts {
  walletAddressId?: string;
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
    opts: IPaymentPageOpts
  ): Promise<IPage<Omit<IPaymentIntent, 'sentPayments' | 'inboundPayments'>>>;
  /**
   * Keyset-paginated sent payments, filterable by senderWalletAddressId and/or
   * paymentIntentId. Returns stored rows rather than domain objects: this read
   * does not join the parent intents, and nothing downstream of it invokes
   * payment behaviour.
   */
  fetchSentPaymentsPage(
    opts: IPaymentPageOpts & { paymentIntentId?: string }
  ): Promise<IPage<IStoredSentPayment>>;
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
