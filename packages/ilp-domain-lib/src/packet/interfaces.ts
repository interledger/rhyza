export const PacketState = {
  PENDING: 'PENDING',
  FULFILLED: 'FULFILLED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED'
} as const;
export type PacketState = keyof typeof PacketState;

interface BasePacketCorrelation {
  packetId: string;
  peerId: string;
  paymentIntentId: string;
  expiresAt: Date;
  state: PacketState;
}

interface QuotePacketCorrelation extends BasePacketCorrelation {
  kind: 'QUOTE';
  quoteId: string;
}

interface PaymentPacketCorrelation extends BasePacketCorrelation {
  kind: 'PAYMENT';
  paymentId: string;
}

export type IPacketCorrelation =
  | QuotePacketCorrelation
  | PaymentPacketCorrelation;

// To be implemented by the adapter for sending packets.
export interface IPeeringClient {
  dispatch(input: PacketDispatch): Promise<void>;
}

export type PacketDispatch = QuoteDispatch | PaymentDispatch;

export interface QuoteDispatch {
  type: 'QUOTE';
  peerId: string;
  packetId: string;
  paymentIntentId: string;
  quoteId: string;
  destinationIlpAddress: string;
  sourceAmount: string;
  sourceAssetCode: string;
  sourceAssetScale: number;
  expiresAt: string;
}

export interface PaymentDispatch {
  type: 'PAYMENT';
  peerId: string;
  packetId: string;
  paymentIntentId: string;
  paymentId: string;
  destinationIlpAddress: string;
  amount: string;
  assetCode: string;
  assetScale: number;
  expiresAt: string;
}
