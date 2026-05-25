export interface ICreateIncomingPaymentResponse {
  id: string;
}

export interface ICreateQuoteResponse {
  id: string;
  paymentIntentId: string;
}

export interface ICreateOutgoingPaymentResponse {
  id: string;
}

export interface IApproveOutgoingPaymentResponse {
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
