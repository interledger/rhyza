export interface ICreatePaymentIntentResponse {
  id: string;
}

export interface ICreateQuoteResponse {
  id: string;
  paymentIntentId: string;
  senderWalletAddress: string;
  senderWalletAddressId: string;
  expiresAt: string;
  debitAmount: bigint;
  receiveAmount: bigint;
  exchangeRate: number;
}

export interface ICreatePaymentResponse {
  id: string;
}

export interface IApprovePaymentResponse {
  id: string;
}

export interface IGetPaymentIntentResponse {
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

export interface IGetPaymentResponse {
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
