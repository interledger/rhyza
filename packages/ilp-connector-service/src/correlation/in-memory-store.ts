import { OutboundPacketCorrelation } from './types';
import { expiryScore } from './expiry';
import { ITransportCorrelationStore } from './store';

export class InMemoryTransportCorrelationStore
  implements ITransportCorrelationStore
{
  private readonly _outboundByPacketId = new Map<
    string,
    OutboundPacketCorrelation
  >();
  private readonly _outboundExpiryAt = new Map<string, number>();

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
    this._outboundExpiryAt.delete(packetId);
    const correlation = this._outboundByPacketId.get(packetId);
    if (correlation) {
      this._outboundByPacketId.delete(packetId);
    }
    return correlation;
  }

  async scheduleOutboundExpiry(
    packetId: string,
    expiresAt: string
  ): Promise<void> {
    this._outboundExpiryAt.set(packetId, expiryScore(expiresAt));
  }

  async cancelOutboundExpiry(packetId: string): Promise<void> {
    this._outboundExpiryAt.delete(packetId);
  }

  async claimExpiredOutbound(limit = 100): Promise<string[]> {
    const now = Date.now();
    const due: string[] = [];
    for (const [packetId, deadline] of this._outboundExpiryAt) {
      if (deadline <= now) {
        due.push(packetId);
        if (due.length >= limit) {
          break;
        }
      }
    }
    for (const packetId of due) {
      this._outboundExpiryAt.delete(packetId);
    }
    return due;
  }
}
