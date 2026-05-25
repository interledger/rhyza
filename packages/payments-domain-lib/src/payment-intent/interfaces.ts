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
  COMPLETED: 'COMPLETED'
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

export interface IWalletAddressService {
  fetchByIds(ids: string[]): Promise<IWalletAddress[]>;
}

export interface IRatesService {
  getRate(
    sourceAssetCode: string,
    destinationAssetCode: string
  ): Promise<number | undefined>;
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
  fetchById(id: string): Promise<IPaymentIntent | undefined>;
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
  storeFinalizedRemoteQuotes(
    updates: FinalizedRemoteQuoteUpdate[]
  ): Promise<void>;
}
