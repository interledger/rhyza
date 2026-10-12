import { PacketInvalidState } from './errors';
import {
  IPacketCorrelation,
  InboundPrepareSnapshot,
  PacketState
} from './interfaces';

export class PacketCorrelation {
  private constructor(private readonly _data: IPacketCorrelation) {}

  static createQuote(args: {
    packetId: string;
    peerId: string;
    paymentIntentId: string;
    expiresAt: Date;
    quoteId: string;
    requestId: string;
    sharedSecret?: string;
    inboundPrepare?: InboundPrepareSnapshot;
  }): PacketCorrelation {
    return new PacketCorrelation({ ...args, kind: 'QUOTE', state: 'PENDING' });
  }

  static createPayment(args: {
    packetId: string;
    peerId: string;
    paymentIntentId: string;
    expiresAt: Date;
    paymentId: string;
    requestId: string;
    executionCondition?: string;
    sharedSecret?: string;
    inboundPrepare?: InboundPrepareSnapshot;
  }): PacketCorrelation {
    return new PacketCorrelation({
      ...args,
      kind: 'PAYMENT',
      state: 'PENDING'
    });
  }

  static fromObject(obj: IPacketCorrelation): PacketCorrelation {
    return new PacketCorrelation(obj);
  }

  toObject(): IPacketCorrelation {
    return this._data;
  }

  fulfill(): PacketCorrelation {
    this.assertPending();
    return this.withState('FULFILLED');
  }

  reject(): PacketCorrelation {
    this.assertPending();
    return this.withState('REJECTED');
  }

  expire(): PacketCorrelation {
    this.assertPending();
    return this.withState('EXPIRED');
  }

  private assertPending(): void {
    if (this._data.state !== 'PENDING') {
      throw new PacketInvalidState(
        `Packet ${this._data.packetId} is already terminal (${this._data.state})`
      );
    }
  }

  // Every transition here is to a terminal state, so the STREAM shared secret
  // has done its job: it exists only to decrypt the probe or fulfill reply,
  // which has either arrived or never will. Dropping it keeps a live key out
  // of a record that outlives the 30-second packet by design.
  private withState(state: PacketState): PacketCorrelation {
    const next = { ...this._data, state };
    delete next.sharedSecret;
    return new PacketCorrelation(next);
  }
}
