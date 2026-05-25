import { PacketInvalidState } from './errors';
import { IPacketCorrelation, PacketState } from './interfaces';

export class PacketCorrelation {
  private constructor(private readonly _data: IPacketCorrelation) {}

  static createQuote(args: {
    packetId: string;
    peerId: string;
    paymentIntentId: string;
    expiresAt: Date;
    quoteId: string;
  }): PacketCorrelation {
    return new PacketCorrelation({ ...args, kind: 'QUOTE', state: 'PENDING' });
  }

  static createPayment(args: {
    packetId: string;
    peerId: string;
    paymentIntentId: string;
    expiresAt: Date;
    paymentId: string;
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

  private withState(state: PacketState): PacketCorrelation {
    return new PacketCorrelation({ ...this._data, state });
  }
}
