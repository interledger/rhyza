import { KafkaJS, RdKafka } from '@confluentinc/kafka-javascript';
import {
  ConsoleLogger,
  ILogger,
  IRawMessageSerializerFactory,
  ITelemetryService
} from 'common-types-lib';
import crypto from 'crypto';
import { KafkaConsumer } from './kafka-consumer';
import {
  IKafkaAdmin,
  IKafkaBuilder,
  KafkaAuthenticationOptions,
  KafkaConsumerOptions,
  KafkaLowLevelConsumerOptions,
  KafkaProducerOptions
} from './types';

import { MessageSerializationFactory } from '../serde';
import { KafkaProducer } from './kafka-producer';
import { KafkaFetcher } from './kafka-fetcher';

import { KafkaAdmin } from './kafka-admin';
import { KafkaLowLevelConsumer } from './kafka-lowlevel-consumer';
import { KafkaLoggerWrapper } from './kafka-logger-wrapper';

export class KafkaBuilder implements IKafkaBuilder {
  constructor() {
    this._globalConfig = {};
  }

  private _logger!: ILogger;
  private _serializerFactory!: IRawMessageSerializerFactory;
  private _kafka!: KafkaJS.Kafka;
  private _globalConfig: KafkaJS.CommonConstructorConfig;
  private _telemetryService?: ITelemetryService;

  private _buildBasics() {
    if (!this._logger) {
      // use the default logger
      this._logger = new ConsoleLogger();
    }
    if (!this._serializerFactory) {
      // use the default factory
      this._serializerFactory = MessageSerializationFactory.instance();
    }
    if (!this._globalConfig || !this._globalConfig['metadata.broker.list']) {
      throw new Error(
        'KafkaBuilder - minimal kafka options (broker list) is required'
      );
    }

    // create the main kafka client if not already created
    if (!this._kafka) {
      this._kafka = new KafkaJS.Kafka(this._globalConfig);
    }
  }

  /*
   * Setup methods
   */
  withLogger(logger: ILogger): KafkaBuilder {
    this._logger = logger;
    return this;
  }

  withSerializerFactory(
    serializerFactory: IRawMessageSerializerFactory
  ): KafkaBuilder {
    this._serializerFactory = serializerFactory;
    return this;
  }

  withBrokerList(kafkaBrokerList: string): KafkaBuilder {
    this._globalConfig['metadata.broker.list'] = kafkaBrokerList;
    return this;
  }

  withClientId(clientId: string): KafkaBuilder {
    this._globalConfig['client.id'] = clientId;
    return this;
  }

  withAuthentication(authentication: KafkaAuthenticationOptions): KafkaBuilder {
    this._globalConfig['security.protocol'] = authentication.protocol;
    this._globalConfig['sasl.mechanism'] = authentication.mechanism;
    this._globalConfig['sasl.username'] = authentication.username;
    this._globalConfig['sasl.password'] = authentication.password;
    return this;
  }

  withTelemetry(telemetryService: ITelemetryService): KafkaBuilder {
    this._telemetryService = telemetryService;
    return this;
  }

  /*
   * Builder methods
   */
  buildAdmin(): IKafkaAdmin {
    this._buildBasics();
    const admin = new KafkaAdmin(this._kafka, this._logger);
    return admin;
  }

  buildConsumer(consumerOptions: KafkaConsumerOptions): KafkaConsumer {
    this._buildBasics();

    // consumer configs
    const consumerConfig: KafkaJS.ConsumerConstructorConfig = {};

    // group.id is required, if not provided, use a random one
    // consumerConfig['group.id'] = consumerOptions.consumerGroupId || crypto.randomUUID();
    consumerConfig['auto.offset.reset'] =
      consumerOptions.autoOffsetReset || 'latest';

    if (
      consumerOptions.batchTimeoutMs !== undefined &&
      consumerOptions.batchTimeoutMs > 0
    ) {
      consumerConfig['fetch.wait.max.ms'] = consumerOptions.batchTimeoutMs;
      consumerConfig['js.consumer.max.cache.size.per.worker.ms'] =
        consumerOptions.batchTimeoutMs;
    }

    if (consumerOptions.batchSize !== undefined) {
      consumerConfig['js.consumer.max.batch.size'] = consumerOptions.batchSize;
    }

    consumerConfig['max.partition.fetch.bytes'] = 50 * 1024 * 1024;
    if (!consumerConfig.kafkaJS) {
      consumerConfig.kafkaJS = {
        logger: this._logger
          ? new KafkaLoggerWrapper(this._logger.child(KafkaConsumer.name))
          : undefined,
        groupId: consumerOptions.consumerGroupId || crypto.randomUUID()
      };
    } else {
      consumerConfig.kafkaJS.logger = this._logger
        ? new KafkaLoggerWrapper(this._logger.child(KafkaConsumer.name))
        : undefined;
      consumerConfig.kafkaJS.groupId =
        consumerOptions.consumerGroupId || crypto.randomUUID();
    }

    //consumerConfig['log_level'] = 4; // warn;

    return new KafkaConsumer(
      this._kafka.consumer(consumerConfig),
      consumerOptions,
      this._serializerFactory,
      this._logger
    );
  }

  buildProducer(producerOptions: KafkaProducerOptions): KafkaProducer {
    this._buildBasics();

    // producer configs
    const producerConfig: KafkaJS.ProducerConstructorConfig = {};

    if (producerOptions.skipAcknowledgements !== undefined) {
      producerConfig['acks'] = producerOptions.skipAcknowledgements ? 0 : -1;
    } else {
      producerConfig['acks'] = -1; // the default is to require acknowledgements
    }

    if (producerOptions.messageMaxBytes !== undefined) {
      this._globalConfig['message.max.bytes'] = producerOptions.messageMaxBytes;
    }

    if (producerOptions.queueBufferingMaxMs !== undefined) {
      // same as linger.ms
      producerConfig['queue.buffering.max.ms'] =
        producerOptions.queueBufferingMaxMs;
    }

    if (producerOptions.queueBufferingMaxMessages !== undefined) {
      producerConfig['queue.buffering.max.messages'] =
        producerOptions.queueBufferingMaxMessages;
    }

    if (producerOptions.compressionCodec !== undefined) {
      producerConfig['compression.codec'] = producerOptions.compressionCodec;
    }
    if (producerOptions.compressionLevel !== undefined) {
      producerConfig['compression.level'] = producerOptions.compressionLevel;
    }

    if (!producerConfig.kafkaJS) {
      producerConfig.kafkaJS = {
        logger: this._logger
          ? new KafkaLoggerWrapper(this._logger.child(KafkaProducer.name))
          : undefined
      };
    } else {
      producerConfig.kafkaJS.logger = this._logger
        ? new KafkaLoggerWrapper(this._logger.child(KafkaProducer.name))
        : undefined;
    }

    producerConfig['log_level'] = 4; // warn;

    return new KafkaProducer(
      this._kafka.producer(producerConfig),
      this._serializerFactory,
      this._logger,
      this._telemetryService || null
    );
  }

  buildFetcher(consumerIdPrefix?: string): KafkaFetcher {
    this._buildBasics();
    return new KafkaFetcher(
      this._kafka,
      this._serializerFactory,
      consumerIdPrefix || null,
      this._logger
    );
  }

  buildLowLevelConsumer(
    consumerOptions: KafkaLowLevelConsumerOptions
  ): KafkaLowLevelConsumer {
    this._buildBasics();

    const globalConfig: RdKafka.ConsumerGlobalConfig = {};
    Object.assign(globalConfig, this._globalConfig);
    globalConfig['group.id'] =
      consumerOptions.consumerGroupId || crypto.randomUUID();

    if (
      consumerOptions.batchTimeoutMs !== undefined &&
      consumerOptions.batchTimeoutMs > 0
    ) {
      globalConfig['fetch.wait.max.ms'] = consumerOptions.batchTimeoutMs;
    }

    const topicConfig: RdKafka.ConsumerTopicConfig = {};
    topicConfig['auto.offset.reset'] =
      consumerOptions.autoOffsetReset ?? 'latest';

    return new KafkaLowLevelConsumer(
      globalConfig,
      consumerOptions,
      this._serializerFactory,
      this._logger,
      this._telemetryService || null
    );
  }
}
