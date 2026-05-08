import {
  IKafkaBuilder,
  IKafkaSourcingRepository,
  KafkaProducerOptions
} from '../types';
import {
  ICache,
  ILogger,
  IMessage,
  IMessageProducer,
  SnapshotEvent,
  SnapshotEventTopics,
  StateEvent,
  StateEventTopics
} from 'common-types-lib';

export type KafkaSnapshotCacheData = {
  topic: string;
  partition: number;
  lastMsgOffset: number;
};

export class KafkaEventSourcingRepo<
  S extends StateEvent,
  T extends SnapshotEvent
> implements IKafkaSourcingRepository<S, T>
{
  protected readonly _logger: ILogger;
  protected readonly _kafkaBuilder: IKafkaBuilder;
  protected readonly _producer: IMessageProducer;
  protected readonly _cache: ICache<KafkaSnapshotCacheData>;
  protected readonly _cachePrefix: string;

  constructor(
    kafkaBuilder: IKafkaBuilder,
    producerOptions: KafkaProducerOptions,
    cache: ICache<KafkaSnapshotCacheData>,
    cachePrefix: string,
    logger: ILogger
  ) {
    this._logger = logger;
    this._kafkaBuilder = kafkaBuilder;
    this._cache = cache;
    this._cachePrefix = cachePrefix;

    this._producer = this._kafkaBuilder.buildProducer(producerOptions);
  }

  private _getCacheKey(keyId: string): string {
    return `${this._cachePrefix}_${keyId}`;
  }

  async publishEvents(events: IMessage[]): Promise<void> {
    await this._producer.send(events);
  }

  async publishSnapshotEvent(events: T[]): Promise<void> {
    // not efficient, but we don't expect to have many snapshots at the same time
    for (const evt of events) {
      const ack = await this._producer.send([evt]);

      await this._cache.set(this._getCacheKey(evt.aggregateId), {
        topic: ack[0].topic,
        partition: ack[0].partition,
        lastMsgOffset: ack[0].lastMsgOffset - 1
      });
    }
  }

  async fetchLastSnapshot(aggId: string): Promise<T | null> {
    let partitionAndOffset: { partition: number; offset: number } | undefined =
      undefined;

    const cached = await this._cache.get(this._getCacheKey(aggId));
    if (cached) {
      partitionAndOffset = {
        partition: cached.partition,
        offset: cached.lastMsgOffset
      };
    }

    const fetcher = this._kafkaBuilder.buildFetcher(this.constructor.name);
    const message = await fetcher.fetchLast(
      aggId,
      SnapshotEventTopics.LedgerSnapshotEvents,
      partitionAndOffset
    );

    return (message as T) || null;
  }

  async fetchStateEvents(
    aggId: string,
    partitionAndOffset?: { partition: number; offset: number }
  ): Promise<S[]> {
    const fetcher = this._kafkaBuilder.buildFetcher(this.constructor.name);
    const messages = await fetcher.fetchAll(
      aggId,
      StateEventTopics.LedgerStateEvents,
      partitionAndOffset
    );
    if (messages.length === 0) {
      return [];
    }

    return messages as S[];
  }
}
