import {
  IMessageConsumer,
  IMessageFetcher,
  IMessageProducer,
  SnapshotEvent,
  StateEvent
} from 'common-types-lib';
import { KafkaLowLevelConsumer } from './kafka-lowlevel-consumer';

export declare interface KafkaAuthenticationOptions {
  protocol: 'plaintext' | 'ssl' | 'sasl_plaintext' | 'sasl_ssl';
  mechanism: 'PLAIN' | 'GSSAPI' | 'SCRAM-SHA-256' | 'SCRAM-SHA-512';
  username: string;
  password: string;
}

export class KafkaConsumerOptions {
  consumerGroupId?: string;
  autoOffsetReset?: 'earliest' | 'latest' | 'error'; // default is latest
  batchSize?: number;
  batchTimeoutMs?: number;
  autoCommit?: boolean;
}

export const KafkaConsumerDefaults = {
  // useSyncCommit: false,
  batchSize: 1,
  batchTimeoutMs: 1000
};

export enum KafkaProducerCompressionCodecs {
  NONE = 'none',
  GZIP = 'gzip',
  SNAPPY = 'snappy',
  LZ4 = 'lz4',
  ZSTD = 'zstd'
}

export enum KafkaProducerPartitioner {
  RANDOM = 'random',
  MURMUR2 = 'murmur2',
  MURMUR2_RANDOM = 'murmur2_random'
  // We'll only use these for now, so no need to add others and couple it even further
  // Better to use "murmur2*" algorithms family instead of the "consistent*" for consistency across stacks
}

export class KafkaProducerOptions {
  skipAcknowledgements?: boolean;
  messageMaxBytes?: number;
  compressionCodec?: KafkaProducerCompressionCodecs;
  compressionLevel?: number;
  partitioner?: KafkaProducerPartitioner;
  queueBufferingMaxMs?: number;
  queueBufferingMaxMessages?: number;
}

export interface IKafkaBuilder {
  buildAdmin(): IKafkaAdmin;
  buildConsumer(consumerOptions: KafkaConsumerOptions): IMessageConsumer;
  buildLowLevelConsumer(
    consumerOptions: KafkaLowLevelConsumerOptions
  ): KafkaLowLevelConsumer;
  buildProducer(producerOptions: KafkaProducerOptions): IMessageProducer;
  buildFetcher(consumerIdPrefix?: string): IMessageFetcher;
}

export interface IKafkaSourcingRepository<
  S extends StateEvent,
  T extends SnapshotEvent
> {
  // for any events other than snapshot events
  // publishEvents(events: IMessage[]): Promise<void>;

  // specific for snapshot events
  publishSnapshotEvent(events: T[]): Promise<void>;

  fetchLastSnapshot(aggId: string): Promise<T | null>;

  fetchStateEvents(
    aggId: string,
    partitionAndOffset?: { partition: number; offset: number }
  ): Promise<S[]>;
}

export interface IKafkaAdmin {
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  createTopics(
    topics: {
      topic: string;
      numPartitions: number;
      replicationFactor: number;
    }[]
  ): Promise<void>;
  hasAllTopics(topics: string[]): Promise<boolean>;
}

export class KafkaLowLevelConsumerOptions extends KafkaConsumerOptions {
  useSyncCommit?: boolean;
}
