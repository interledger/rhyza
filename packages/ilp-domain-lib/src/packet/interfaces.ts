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
  // Present on inbound packets so a later fulfill/reject can rebuild the
  // STREAM reply. Outbound packets never have one.
  inboundPrepare?: InboundPrepareSnapshot;
  // Outbound packets store the STREAM shared secret to decrypt the reply
  // (quote reject or payment fulfill). Dropped when the packet goes terminal.
  sharedSecret?: string;
}

interface QuotePacketCorrelation extends BasePacketCorrelation {
  kind: 'QUOTE';
  quoteId: string;
  requestId: string;
}

interface PaymentPacketCorrelation extends BasePacketCorrelation {
  kind: 'PAYMENT';
  paymentId: string;
  requestId: string;
  // Outbound prepares store the base64 execution condition so a later
  // fulfill can be hashed against it.
  executionCondition?: string;
}

export type IPacketCorrelation =
  | QuotePacketCorrelation
  | PaymentPacketCorrelation;

export interface InboundPrepareSnapshot {
  destinationIlpAddress: string;
  amount: string;
  expiresAt: string;
  executionCondition: string;
  data: string;
}

// To be implemented by the adapter for sending packets.
export interface IPeeringClient {
  dispatch(input: PacketDispatch): Promise<void>;
  dispatchReject(input: RejectDispatch): Promise<void>;
  dispatchFulfill(input: FulfillDispatch): Promise<void>;
}

export interface InboundReplyDispatch {
  peerId: string;
  packetId: string;
  // Prepare `expiresAt`, used as the RFC 0035 callback retry budget.
  // Fulfill/reject packets have no expiry of their own.
  callbackDeadline: string;
}

export interface FulfillDispatch extends InboundReplyDispatch {
  fulfillment: string;
  data?: string;
}

export interface RejectDispatch extends InboundReplyDispatch {
  rejectCode: string;
  rejectMessage?: string;
  triggeredBy?: string;
  data?: string;
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
  data: string;
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
  sharedSecret: string;
  executionCondition: string;
  data: string;
}
