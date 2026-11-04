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
  triggeredBy?: string;
  data?: string;
}

export type WireResponse = WireFulfill | WireReject;

export type WireResponseHandler = (
  response: WireResponse
) => void | Promise<void>;

export type WireInboundPrepareHandler = (
  prepare: WirePrepare
) => void | Promise<void>;

export type WireOutboundPrepareAcceptedHandler = (
  prepare: WirePrepare
) => void | Promise<void>;

export interface IConnectorTransport {
  sendPrepare(prepare: WirePrepare): Promise<void>;

  sendFulfill(
    fulfill: WireFulfill,
    peerId: string,
    callbackDeadline: string
  ): Promise<void>;
  sendReject(
    reject: WireReject,
    peerId: string,
    callbackDeadline: string
  ): Promise<void>;

  onResponse(handler: WireResponseHandler): void;

  onInboundPrepare(handler: WireInboundPrepareHandler): void;

  onOutboundPrepareAccepted?(handler: WireOutboundPrepareAcceptedHandler): void;

  // Lifecycle hooks for transports that own a resource (e.g. an HTTP
  // listener). Optional since the in-memory loopback transport used in
  // tests needs neither.
  start?(): Promise<void>;
  stop?(): Promise<void>;
}
