export interface WirePrepare {
  peerId: string;
  packetId: string;
  destinationIlpAddress: string;
  amount: string;
  expiresAt: string;
  // base64-encoded 32-byte execution condition.
  executionCondition: string;
  // base64-encoded opaque packet data (STREAM payload) - never decoded here.
  data?: string;
}

export interface WireFulfill {
  kind: 'FULFILL';
  packetId: string;
  fulfillment: string;
  data?: string;
}

export interface WireReject {
  kind: 'REJECT';
  packetId: string;
  rejectCode: string;
  rejectMessage?: string;
  data?: string;
}

export type WireResponse = WireFulfill | WireReject;

export interface WireFulfillOutbound {
  peerId: string;
  packetId: string;
  fulfillment: string;
  data?: string;
}

export interface WireRejectOutbound {
  peerId: string;
  packetId: string;
  rejectCode: string;
  rejectMessage?: string;
  data?: string;
}

export type WireResponseHandler = (
  response: WireResponse
) => void | Promise<void>;

export type WireInboundPrepareHandler = (
  prepare: WirePrepare
) => void | Promise<void>;

export interface IConnectorTransport {
  sendPrepare(prepare: WirePrepare): Promise<void>;

  sendFulfill(fulfill: WireFulfillOutbound): Promise<void>;
  sendReject(reject: WireRejectOutbound): Promise<void>;

  onResponse(handler: WireResponseHandler): void;

  onInboundPrepare(handler: WireInboundPrepareHandler): void;
}
