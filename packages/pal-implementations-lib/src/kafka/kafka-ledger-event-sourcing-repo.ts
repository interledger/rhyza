import { Redis } from 'ioredis';
import { ILogger } from 'common-types-lib';
import {
  IKafkaBuilder,
  KafkaEventSourcingRepo,
  KafkaProducerOptions,
  RedisCache
} from 'implementations-lib';
import { LedgerSnapshotEvent, LedgerStateEvent } from 'pal-domain-lib';

const CACHE_PREFIX = 'LEDGER_ES_SNAPSHOT_';

type SnapshotCacheData = {
  topic: string;
  partition: number;
  lastMsgOffset: number;
};

export class KafkaLedgerEventSourcingRepository extends KafkaEventSourcingRepo<
  LedgerStateEvent,
  LedgerSnapshotEvent
> {
  private readonly _redisClient: Redis;

  constructor(
    kafkaBuilder: IKafkaBuilder,
    producerOptions: KafkaProducerOptions,
    redisConnStr: string,
    logger: ILogger
  ) {
    const redisClient = new Redis(redisConnStr, {
      lazyConnect: true
    });

    const cache = new RedisCache<SnapshotCacheData>(redisClient, logger);
    super(kafkaBuilder, producerOptions, cache, CACHE_PREFIX, logger);

    this._redisClient = redisClient;
  }

  async init(): Promise<void> {
    await this._producer.connect();
    await this._redisClient.connect();
  }

  async publishSnapshotEvent(events: LedgerSnapshotEvent[]): Promise<void> {
    return super.publishSnapshotEvent(events);
  }

  async fetchLastSnapshot(aggId: string): Promise<LedgerSnapshotEvent | null> {
    return super.fetchLastSnapshot(aggId);
  }

  async fetchStateEvents(
    aggId: string,
    partitionAndOffset?: { partition: number; offset: number }
  ): Promise<LedgerStateEvent[]> {
    return super.fetchStateEvents(aggId, partitionAndOffset);
  }
}
