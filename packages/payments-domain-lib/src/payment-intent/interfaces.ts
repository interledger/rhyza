export const PaymentIntentState = {
  CREATED: 'CREATED',
  COMPLETED: 'COMPLETED'
} as const;
export type PaymentIntentState = keyof typeof PaymentIntentState;

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

export const PaymentState = {
  CREATED: 'CREATED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED'
} as const;
export type PaymentState = keyof typeof PaymentState;

export interface IPayment {
  id: string;
  state: PaymentState;
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
  payments: IPayment[];
  destinationIlpAddress?: string;
  remoteUrl?: string;
}

export interface IWalletAddress {
  id: string;
  isActive: boolean;
  assetCode: string;
  assetScale: number;
}

export interface IRatesService {
  getRate(
    sourceAssetCode: string,
    destinationAssetCode: string
  ): Promise<number | undefined>;
}

export type IFxRateRequest =
  | { peerId: string; sourceAssetCode: string }
  | { peerId: string; destinationAssetCode: string };

export interface IPeer {
  peerId: string;
  assetCode: string;
  assetScale: number;
}

export interface IPalService {
  getWalletAddresses(ids: string[]): Promise<IWalletAddress[]>;
  getPeerByIlpAddress(ilpAddress: string): Promise<IPeer | null>;
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

export interface IPaymentIntentRepository {
  storeMany(paymentIntents: IPaymentIntent[]): Promise<void>;
  fetchByIds(ids: string[]): Promise<Omit<IPaymentIntent, 'payments'>[]>;
  fetchByIdsWithPayments(ids: string[]): Promise<IPaymentIntent[]>;
  fetchIdsByRemoteUrls(
    urls: string[]
  ): Promise<Array<{ id: string; remoteUrl: string }>>;
  storeQuotes(
    quoteUpdates: { quoteIds: string[]; paymentIntent: IPaymentIntent }[]
  ): Promise<void>;
  storePayments(
    paymentUpdates: { paymentIds: string[]; paymentIntent: IPaymentIntent }[]
  ): Promise<void>;
  storeCompletedLocalPayments(
    paymentUpdates: {
      paymentIntent: {
        id: string;
        receivedAmount: bigint;
        state: PaymentIntentState;
      };
      payments: { id: string; state: PaymentState; sentAmount: bigint }[];
    }[]
  ): Promise<void>;
  storeCancelledPayments(
    paymentUpdates: {
      payments: {
        id: string;
        state: PaymentState;
        cancelledAt: Date;
        cancelReason?: string;
      }[];
    }[]
  ): Promise<void>;
  storeFinalizedRemoteQuotes(
    updates: FinalizedRemoteQuoteUpdate[]
  ): Promise<void>;
}
