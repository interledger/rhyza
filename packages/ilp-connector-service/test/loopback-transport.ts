import {
  IConnectorTransport,
  WireFulfill,
  WirePrepare,
  WireReject,
  WireResponse,
  WireResponseHandler,
  WireInboundPrepareHandler
} from '../src/transport';

export interface LoopbackTransportOptions {
  responder?: (prepare: WirePrepare) => WireResponse;
}

const defaultResponder = (prepare: WirePrepare): WireResponse => ({
  kind: 'REJECT',
  packetId: prepare.packetId,
  rejectCode: 'F99',
  rejectMessage: 'loopback: no upstream peer connected'
});

export type SentWireReply = {
  peerId: string;
  callbackDeadline: string;
  response: WireFulfill | WireReject;
};

// Loops every outbound prepare straight back into a response so the full
// Dispatch -> wire -> Process round trip can be exercised end-to-end in tests.
// Real transports implement the same port and deliver the response asynchronously
// from a connection callback instead.
export class LoopbackConnectorTransport implements IConnectorTransport {
  private _responseHandler?: WireResponseHandler;
  private _inboundPrepareHandler?: WireInboundPrepareHandler;
  private readonly _responder: (prepare: WirePrepare) => WireResponse;

  // Exposed for assertions/inspection in tests and local debugging
  readonly sentResponses: SentWireReply[] = [];

  constructor(options: LoopbackTransportOptions = {}) {
    this._responder = options.responder ?? defaultResponder;
  }

  async sendPrepare(prepare: WirePrepare): Promise<void> {
    const response = this._responder(prepare);
    if (this._responseHandler) {
      await this._responseHandler(response);
    }
  }

  async sendFulfill(
    fulfill: WireFulfill,
    peerId: string,
    callbackDeadline: string
  ): Promise<void> {
    this.sentResponses.push({ peerId, callbackDeadline, response: fulfill });
  }

  async sendReject(
    reject: WireReject,
    peerId: string,
    callbackDeadline: string
  ): Promise<void> {
    this.sentResponses.push({ peerId, callbackDeadline, response: reject });
  }

  onResponse(handler: WireResponseHandler): void {
    this._responseHandler = handler;
  }

  onInboundPrepare(handler: WireInboundPrepareHandler): void {
    this._inboundPrepareHandler = handler;
  }

  // Test helper: simulate a peer initiating an inbound prepare.
  async simulateInboundPrepare(prepare: WirePrepare): Promise<void> {
    if (this._inboundPrepareHandler) {
      await this._inboundPrepareHandler(prepare);
    }
  }
}
