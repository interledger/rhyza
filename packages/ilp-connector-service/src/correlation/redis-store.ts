import { Redis } from 'ioredis';
import { OutboundPacketCorrelation } from './types';
import { outboundCorrelationTtlMs } from './expiry';
import { ITransportCorrelationStore } from './store';

const OUTBOUND_KEY_PREFIX = 'ilp-connector:outbound:';

export class RedisTransportCorrelationStore
  implements ITransportCorrelationStore
{
  constructor(private readonly _redis: Redis) {}

  async storeOutboundCorrelation(
    packetId: string,
    correlation: OutboundPacketCorrelation
  ): Promise<void> {
    await this._redis.set(
      `${OUTBOUND_KEY_PREFIX}${packetId}`,
      JSON.stringify(correlation),
      'PX',
      outboundCorrelationTtlMs(correlation.expiresAt)
    );
  }

  async hasOutboundCorrelation(packetId: string): Promise<boolean> {
    return (
      (await this._redis.exists(`${OUTBOUND_KEY_PREFIX}${packetId}`)) === 1
    );
  }

  async takeOutboundCorrelation(
    packetId: string
  ): Promise<OutboundPacketCorrelation | undefined> {
    const raw = await this._redis.getdel(`${OUTBOUND_KEY_PREFIX}${packetId}`);
    if (!raw) {
      return undefined;
    }
    return JSON.parse(raw) as OutboundPacketCorrelation;
  }
}
