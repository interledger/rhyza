import { ICache, ILogger } from 'common-types-lib';
import { IPacketCorrelation, IPeer, IPeerStore } from 'ilp-domain-lib';

const PACKET_CACHE_KEY_PREFIX = 'ilp:packet:';

function packetCacheKey(packetId: string): string {
  return `${PACKET_CACHE_KEY_PREFIX}${packetId}`;
}

function packetCacheTtlMs(expiresAt: Date): number {
  return Math.max(expiresAt.getTime() - Date.now(), 1);
}

export function revivePacketCorrelation(
  packet: IPacketCorrelation
): IPacketCorrelation {
  return {
    ...packet,
    expiresAt:
      packet.expiresAt instanceof Date
        ? packet.expiresAt
        : new Date(packet.expiresAt)
  };
}

export function parsePacketCorrelation(value: string): IPacketCorrelation {
  return revivePacketCorrelation(JSON.parse(value) as IPacketCorrelation);
}

// Mongo is the durable source of truth. Redis is a cache in front of packet
// rows so STREAM reply rebuilds stay off the database on the hot path.
// Write Mongo first; a Redis failure must not fail the command.
export class WriteThroughPeerRepository implements IPeerStore {
  constructor(
    private readonly _inner: IPeerStore,
    private readonly _packetCache: ICache<IPacketCorrelation>,
    private readonly _logger: ILogger
  ) {}

  fetchById(peerId: string): Promise<IPeer | undefined> {
    return this._inner.fetchById(peerId);
  }

  fetchAll(): Promise<IPeer[]> {
    return this._inner.fetchAll();
  }

  store(peer: IPeer): Promise<void> {
    return this._inner.store(peer);
  }

  update(peer: IPeer): Promise<void> {
    return this._inner.update(peer);
  }

  async fetchPacketById(
    packetId: string
  ): Promise<IPacketCorrelation | undefined> {
    const cached = await this._cacheGet(packetId);
    if (cached) {
      return cached;
    }

    const stored = await this._inner.fetchPacketById(packetId);
    if (stored) {
      await this._cacheSet(stored);
    }
    return stored;
  }

  async storePacket(packet: IPacketCorrelation): Promise<void> {
    await this._inner.storePacket(packet);
    await this._cacheSet(packet);
  }

  async updatePacket(packet: IPacketCorrelation): Promise<void> {
    await this._inner.updatePacket(packet);
    await this._cacheSet(packet);
  }

  private async _cacheGet(
    packetId: string
  ): Promise<IPacketCorrelation | undefined> {
    try {
      const cached = await this._packetCache.get(packetCacheKey(packetId));
      return cached ? revivePacketCorrelation(cached) : undefined;
    } catch (err) {
      this._logger.warn(
        `Packet cache get failed for ${packetId}; reading Mongo. ${(err as Error).message}`
      );
      return undefined;
    }
  }

  private async _cacheDelete(packetId: string): Promise<void> {
    try {
      await this._packetCache.delete(packetCacheKey(packetId));
    } catch (err) {
      this._logger.warn(
        `Packet cache invalidate failed for ${packetId}; next read may serve a stale row. ${(err as Error).message}`
      );
    }
  }

  private async _cacheSet(packet: IPacketCorrelation): Promise<void> {
    try {
      await this._packetCache.setWithTtl(
        packetCacheKey(packet.packetId),
        packet,
        packetCacheTtlMs(
          packet.expiresAt instanceof Date
            ? packet.expiresAt
            : new Date(packet.expiresAt)
        )
      );
    } catch (err) {
      this._logger.warn(
        `Packet cache set failed for ${packet.packetId}; Mongo write stands. ${(err as Error).message}`
      );
      await this._cacheDelete(packet.packetId);
    }
  }
}
