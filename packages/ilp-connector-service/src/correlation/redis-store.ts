import { Redis } from 'ioredis';
import { OutboundPacketCorrelation } from './types';
import { expiryScore, outboundCorrelationTtlMs } from './expiry';
import { ITransportCorrelationStore } from './store';

const OUTBOUND_KEY_PREFIX = 'ilp-connector:outbound:';
const OUTBOUND_EXPIRY_ZSET = 'ilp-connector:outbound-expiry';

const CLAIM_EXPIRED_SCRIPT = `
local members = redis.call(
  'ZRANGEBYSCORE',
  KEYS[1],
  '-inf',
  ARGV[1],
  'LIMIT',
  0,
  tonumber(ARGV[2])
)
for _, member in ipairs(members) do
  redis.call('ZREM', KEYS[1], member)
end
return members
`;

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
    await this.cancelOutboundExpiry(packetId);
    const raw = await this._redis.getdel(`${OUTBOUND_KEY_PREFIX}${packetId}`);
    if (!raw) {
      return undefined;
    }
    return JSON.parse(raw) as OutboundPacketCorrelation;
  }

  async scheduleOutboundExpiry(
    packetId: string,
    expiresAt: string
  ): Promise<void> {
    await this._redis.zadd(
      OUTBOUND_EXPIRY_ZSET,
      expiryScore(expiresAt),
      packetId
    );
  }

  async cancelOutboundExpiry(packetId: string): Promise<void> {
    await this._redis.zrem(OUTBOUND_EXPIRY_ZSET, packetId);
  }

  async claimExpiredOutbound(limit = 100): Promise<string[]> {
    const result = await this._redis.eval(
      CLAIM_EXPIRED_SCRIPT,
      1,
      OUTBOUND_EXPIRY_ZSET,
      Date.now(),
      limit
    );
    if (!Array.isArray(result)) {
      return [];
    }
    return result.map(String);
  }
}
