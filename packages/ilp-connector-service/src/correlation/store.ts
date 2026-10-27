import { OutboundPacketCorrelation } from './types';

export interface ITransportCorrelationStore {
  storeOutboundCorrelation(
    packetId: string,
    correlation: OutboundPacketCorrelation
  ): Promise<void>;
  hasOutboundCorrelation(packetId: string): Promise<boolean>;
  takeOutboundCorrelation(
    packetId: string
  ): Promise<OutboundPacketCorrelation | undefined>;

  // Shared outbound expiry index (Redis ZSET otherwise in-memory in tests).
  // Any replica can claim due packetIds. takeOutboundCorrelation must be
  // atomic so only one of a late callback and the expiry worker wins.
  scheduleOutboundExpiry(packetId: string, expiresAt: string): Promise<void>;
  cancelOutboundExpiry(packetId: string): Promise<void>;
  claimExpiredOutbound(limit?: number): Promise<string[]>;
}
