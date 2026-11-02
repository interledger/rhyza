import { Redis } from 'ioredis';
import { ICache, ILogger } from 'common-types-lib';
import {
  IPacketCorrelation,
  IPeer,
  IPeerRepository,
  IPeerStore
} from 'ilp-domain-lib';
import { RedisCache } from 'implementations-lib';
import { MongoDbPeerRepository } from './mongo/mongodb-peer-repository';

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

// Mongo is the durable source of truth. Redis is an optional write-through
// cache for packet correlations so STREAM reply rebuilds stay off the
// database on the hot path. Write Mongo first; a Redis failure must not
// fail the command.
export class CachedPeerRepository implements IPeerRepository {
  private readonly _mongoLifecycle?: MongoDbPeerRepository;
  private readonly _redis?: Redis;

  constructor(
    private readonly _store: IPeerStore,
    private readonly _logger: ILogger,
    private readonly _packetCache?: ICache<IPacketCorrelation>,
    lifecycle?: { mongo: MongoDbPeerRepository; redis?: Redis }
  ) {
    this._mongoLifecycle = lifecycle?.mongo;
    this._redis = lifecycle?.redis;
  }

  static async connect(
    mongoUrl: string,
    logger: ILogger,
    redisUrl?: string
  ): Promise<CachedPeerRepository> {
    const mongo = new MongoDbPeerRepository(
      mongoUrl,
      logger.child('peer-repo')
    );
    await mongo.init();

    if (!redisUrl) {
      logger.info('REDIS_URL not set - packet correlations are Mongo-only');
      return new CachedPeerRepository(
        mongo,
        logger.child('peer-repo'),
        undefined,
        {
          mongo
        }
      );
    }

    const redis = new Redis(redisUrl, { lazyConnect: true });
    await redis.connect();
    logger.info('Using Mongo + Redis write-through for packet correlations');
    return new CachedPeerRepository(
      mongo,
      logger.child('peer-repo'),
      new RedisCache(
        redis,
        logger.child('packet-cache'),
        parsePacketCorrelation
      ),
      { mongo, redis }
    );
  }

  async disconnect(): Promise<void> {
    if (this._redis) {
      await this._redis.quit();
    }
    if (this._mongoLifecycle) {
      await this._mongoLifecycle.destroy();
    }
  }

  fetchById(peerId: string): Promise<IPeer | undefined> {
    return this._store.fetchById(peerId);
  }

  fetchAll(): Promise<IPeer[]> {
    return this._store.fetchAll();
  }

  store(peer: IPeer): Promise<void> {
    return this._store.store(peer);
  }

  update(peer: IPeer): Promise<void> {
    return this._store.update(peer);
  }

  async fetchPacketById(
    packetId: string
  ): Promise<IPacketCorrelation | undefined> {
    const cached = await this._cacheGet(packetId);
    if (cached) {
      return cached;
    }

    const stored = await this._store.fetchPacketById(packetId);
    if (stored) {
      await this._cacheSet(stored);
    }
    return stored;
  }

  async storePacket(packet: IPacketCorrelation): Promise<void> {
    await this._store.storePacket(packet);
    await this._cacheSet(packet);
  }

  async updatePacket(packet: IPacketCorrelation): Promise<void> {
    await this._store.updatePacket(packet);
    await this._cacheSet(packet);
  }

  private async _cacheGet(
    packetId: string
  ): Promise<IPacketCorrelation | undefined> {
    if (!this._packetCache) {
      return undefined;
    }
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
    if (!this._packetCache) {
      return;
    }
    try {
      await this._packetCache.delete(packetCacheKey(packetId));
    } catch (err) {
      this._logger.warn(
        `Packet cache invalidate failed for ${packetId}; next read may serve a stale row. ${(err as Error).message}`
      );
    }
  }

  private async _cacheSet(packet: IPacketCorrelation): Promise<void> {
    if (!this._packetCache) {
      return;
    }
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
