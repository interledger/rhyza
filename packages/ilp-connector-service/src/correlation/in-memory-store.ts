import { OutboundPacketCorrelation } from './types';
import { ITransportCorrelationStore } from './store';

export class InMemoryTransportCorrelationStore
  implements ITransportCorrelationStore
{
  private readonly _outboundByPacketId = new Map<
    string,
    OutboundPacketCorrelation
  >();

  async storeOutboundCorrelation(
    packetId: string,
    correlation: OutboundPacketCorrelation
  ): Promise<void> {
    this._outboundByPacketId.set(packetId, correlation);
  }

  async hasOutboundCorrelation(packetId: string): Promise<boolean> {
    return this._outboundByPacketId.has(packetId);
  }

  async takeOutboundCorrelation(
    packetId: string
  ): Promise<OutboundPacketCorrelation | undefined> {
    const correlation = this._outboundByPacketId.get(packetId);
    if (correlation) {
      this._outboundByPacketId.delete(packetId);
    }
    return correlation;
  }
}
