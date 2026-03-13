export const PaymentIntentState = {
  CREATED: 'CREATED',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  EXPIRED: 'EXPIRED',
  COMPLETED: 'COMPLETED'
} as const;
export type PaymentIntentState = keyof typeof PaymentIntentState;

export const PaymentIntentDestination = {
  LOCAL: 'LOCAL',
  REMOTE: 'REMOTE'
} as const;
export type PaymentIntentDestination = keyof typeof PaymentIntentDestination;

export interface IPaymentIntent {
  id: string;
  receiverWalletAddressId: string;
  receiverWalletAddress: string;
  state: PaymentIntentState;
  destination: PaymentIntentDestination;
  assetCode: string;
  assetScale: number;
  expiresAt: Date;
  incomingAmount: bigint | null;
  receivedAmount: bigint;
}

export interface WalletAddress {
  id: string;
  isActive: boolean;
  assetCode: string;
  assetScale: number;
}

export interface IWalletAddressAdapter {
  fetchByIds(ids: string[]): Promise<WalletAddress[]>;
}

export interface IPaymentIntentRepository {
  storeMany(payments: IPaymentIntent[]): Promise<void>;
  fetchByIds(ids: string[]): Promise<IPaymentIntent[]>;
}
