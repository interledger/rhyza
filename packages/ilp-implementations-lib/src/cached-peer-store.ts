import { Redis } from 'ioredis';
import { ILogger } from 'common-types-lib';
import { IPeerStore } from 'ilp-domain-lib';
import { RedisCache } from 'implementations-lib';
import { MongoDbPeerRepository } from './mongo/mongodb-peer-repository';
import {
  WriteThroughPeerRepository,
  parsePacketCorrelation
} from './write-through-peer-repository';

// Composition for the ILP command handler: Mongo is always the durable store
// Redis is an optional write-through cache for packet correlations.
export class CachedPeerStore {
  readonly store: IPeerStore;

  private constructor(
    store: IPeerStore,
    private readonly _mongo: MongoDbPeerRepository,
    private readonly _redis?: Redis
  ) {
    this.store = store;
  }

  static async connect(
    mongoUrl: string,
    logger: ILogger,
    redisUrl?: string
  ): Promise<CachedPeerStore> {
    const mongo = new MongoDbPeerRepository(
      mongoUrl,
      logger.child('peer-repo')
    );
    await mongo.init();

    if (!redisUrl) {
      logger.info('REDIS_URL not set - packet correlations are Mongo-only');
      return new CachedPeerStore(mongo, mongo);
    }

    const redis = new Redis(redisUrl, { lazyConnect: true });
    await redis.connect();
    const store = new WriteThroughPeerRepository(
      mongo,
      new RedisCache(
        redis,
        logger.child('packet-cache'),
        parsePacketCorrelation
      ),
      logger.child('peer-repo')
    );
    logger.info('Using Mongo + Redis write-through for packet correlations');
    return new CachedPeerStore(store, mongo, redis);
  }

  async disconnect(): Promise<void> {
    if (this._redis) {
      await this._redis.quit();
    }
    await this._mongo.destroy();
  }
}
