export interface IClientErrorResponse {
  error: {
    code: string;
    description: string;
  };
}

export type IncomingPaymentInput =
  | { incomingPaymentId: string }
  | { incomingPaymentUrl: string };

export interface CreatePaymentIntentResult {
  id: string;
}

export interface CompletePaymentIntentResult {
  id: string;
  state: string;
}

export interface CreateQuoteResult {
  id: string;
  paymentIntentId: string;
  senderWalletAddress: string;
  senderWalletAddressId: string;
  expiresAt: string;
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
}

export interface GetPaymentResult {
  id: string;
  state: string;
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
