import {
  IConnectorTransport,
  WireFulfillOutbound,
  WirePrepare,
  WireRejectOutbound,
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

// Loops every outbound prepare straight back into a response so the full
// Dispatch -> wire -> Process round trip can be exercised end-to-end in tests.
// Real transports implement the same port and deliver the response asynchronously
// from a connection callback instead.
export class LoopbackConnectorTransport implements IConnectorTransport {
  private _responseHandler?: WireResponseHandler;
  private _inboundPrepareHandler?: WireInboundPrepareHandler;
  private readonly _responder: (prepare: WirePrepare) => WireResponse;

  // Exposed for assertions/inspection in tests and local debugging
  readonly sentResponses: Array<WireFulfillOutbound | WireRejectOutbound> = [];

  constructor(options: LoopbackTransportOptions = {}) {
    this._responder = options.responder ?? defaultResponder;
  }

  async sendPrepare(prepare: WirePrepare): Promise<void> {
    const response = this._responder(prepare);
    if (this._responseHandler) {
      await this._responseHandler(response);
    }
  }

  async sendFulfill(fulfill: WireFulfillOutbound): Promise<void> {
    this.sentResponses.push(fulfill);
  }

  async sendReject(reject: WireRejectOutbound): Promise<void> {
    this.sentResponses.push(reject);
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
