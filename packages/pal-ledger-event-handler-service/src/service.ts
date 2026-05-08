import crypto from 'crypto';
import process from 'process';
import {
  PinoLogger,
  MessageSerializationFactory,
  KafkaProducerOptions,
  IKafkaBuilder,
  KafkaBuilder,
  KafkaConsumerOptions,
  KafkaLowLevelConsumerOptions
} from 'implementations-lib';
import {
  ILedgerEventSourcingRepository,
  LedgerAggregate,
  ILedgerReadSideRepository
} from 'pal-domain-lib';
import {
  CreateLedgerAccountCmdSerde,
  CreateLedgerAccountForAssetCmdSerde,
  CreateLedgerAccountForPeerCmdSerde,
  CreateLedgerCmdSerde,
  KafkaLedgerEventSourcingRepository,
  LedgerAccountCreatedStateEventSerde,
  LedgerCreatedStateEventSerde,
  LedgerSnapshotSerde,
  LedgerTransactionRecordedStateEventSerde,
  MongoDbLedgerReadSideRepo,
  PostTransactionCmdSerde
} from 'pal-implementations-lib';

import {
  ILogger,
  IMessageConsumer,
  IMessageProducer,
  IRawMessageSerializerFactory
} from 'common-types-lib';
import {
  LedgerStateEventHandler,
  LedgerStateEventHandlerConfigs
} from './handlers/ledger-state-event-handler';
import { IntegrationEventHandler } from './handlers/integration-event-handler';

const INSTANCE_ID = `ES_LEDGER_POC_SVC__${crypto.randomUUID()}`;
const REDIS_URL = process.env['REDIS_URL'] || 'redis://localhost:6379';

const MAX_EVENTS_PER_SNAPSHOT = 10;
const MAX_SECS_SINCE_LAST_SNAPSHOT = 600;
const MIN_SECS_SINCE_LAST_SNAPSHOT = 10;

// Message Consumer/Publisher
const KAFKA_URL =
  process.env['KAFKA_URL'] || '127.0.0.1:29092,127.0.0.1:39092,127.0.0.1:49092';
// const KAFKA_AUTH_ENABLED = process.env["KAFKA_AUTH_ENABLED"] && process.env["KAFKA_AUTH_ENABLED"].toUpperCase()==="TRUE" || false;
// const KAFKA_AUTH_PROTOCOL = process.env["KAFKA_AUTH_PROTOCOL"] || "sasl_plaintext";
// const KAFKA_AUTH_MECHANISM = process.env["KAFKA_AUTH_MECHANISM"] || "plain";
// const KAFKA_AUTH_USERNAME = process.env["KAFKA_AUTH_USERNAME"] || "user";
// const KAFKA_AUTH_PASSWORD = process.env["KAFKA_AUTH_PASSWORD"] || "password";

// kafka common options
const kafkaProducerCommonOptions: KafkaProducerOptions = {
  queueBufferingMaxMessages: 500_000,
  messageMaxBytes: 20971520
};
const kafkaConsumerCommonOptions: KafkaConsumerOptions = {
  consumerGroupId: 'ES_LEDGER_POC_STATE_EVENTHANDLER_SVC',
  batchTimeoutMs: 500,
  batchSize: 50_000
};
const MONGO_URL = process.env['MONGO_URL'] || 'mongodb://localhost:27017/';

/**
 * This service behaves as 3 separate services for now:
 * 1. Snapshotter - takes snapshots of the ledger state when needed
 * 2. Projector - updates the read side projections of the ledger state
 * 3. Integration event handler - handles integration events from the payments domain
 */

export class PalLedgerEventHandlerService {
  private static _logger: ILogger;
  private static _esRepo: ILedgerEventSourcingRepository;
  private static _producer: IMessageProducer;
  private static _stateEventsConsumer: IMessageConsumer;
  private static _domainEventsConsumer: IMessageConsumer;
  private static _kafkaBuilder: IKafkaBuilder;
  private static _msgSerializationFactory: IRawMessageSerializerFactory;
  private static _readSideRepo: ILedgerReadSideRepository;

  private static _stateEventHandler: LedgerStateEventHandler;
  private static _integrationEventHandler: IntegrationEventHandler;

  static async start(
    logger?: ILogger,
    msgSerializationFactory?: IRawMessageSerializerFactory,
    kafkaBuilder?: IKafkaBuilder,
    esRepo?: ILedgerEventSourcingRepository,
    readSideRepo?: ILedgerReadSideRepository,
    stateEventsConsumer?: IMessageConsumer,
    domainEventsConsumer?: IMessageConsumer,
    producer?: IMessageProducer
  ): Promise<void> {
    if (!logger) {
      logger = new PinoLogger();
    }
    this._logger = logger;

    this._logger.info(`Starting ${PalLedgerEventHandlerService.name}...`);

    if (!msgSerializationFactory) {
      MessageSerializationFactory.instance()
        // snapshots
        .register(new LedgerSnapshotSerde())
        // state events
        .register(new LedgerCreatedStateEventSerde())
        .register(new LedgerAccountCreatedStateEventSerde())
        .register(new LedgerTransactionRecordedStateEventSerde())
        // commands
        .register(new CreateLedgerCmdSerde())
        .register(new CreateLedgerAccountCmdSerde())
        .register(new PostTransactionCmdSerde())
        .register(new CreateLedgerAccountForAssetCmdSerde())
        .register(new CreateLedgerAccountForPeerCmdSerde());

      msgSerializationFactory = MessageSerializationFactory.instance();
    }
    this._msgSerializationFactory = msgSerializationFactory;

    if (!kafkaBuilder) {
      kafkaBuilder = new KafkaBuilder()
        .withLogger(this._logger)
        .withBrokerList(KAFKA_URL)
        .withClientId(INSTANCE_ID)
        .withSerializerFactory(MessageSerializationFactory.instance());
    }
    this._kafkaBuilder = kafkaBuilder;

    if (!esRepo) {
      // TODO remove
      // const admin = this._kafkaBuilder.buildAdmin();
      // await admin.createTopics([
      //   SnapshotEventTopics.LedgerSnapshotEvents,
      //   StateEventTopics.LedgerStateEvents,
      //   DomainEventTopics.LedgerEvents,
      //   CommandTopics.LedgerCommands
      // ]);

      const kafkaEsRepo = new KafkaLedgerEventSourcingRepository(
        this._kafkaBuilder,
        kafkaProducerCommonOptions,
        REDIS_URL,
        this._logger
      );
      await kafkaEsRepo.init();
      esRepo = kafkaEsRepo;
    }
    this._esRepo = esRepo;

    if (!readSideRepo) {
      const repo = new MongoDbLedgerReadSideRepo(MONGO_URL, logger);
      await repo.init();
      readSideRepo = repo;
    }
    this._readSideRepo = readSideRepo;

    if (!producer) {
      producer = this._kafkaBuilder.buildProducer(kafkaProducerCommonOptions);
      await producer.connect();
    }
    this._producer = producer;

    if (!stateEventsConsumer) {
      // stateEventsConsumer = this._kafkaBuilder.buildConsumer(kafkaConsumerCommonOptions);

      const consumerOpts: KafkaLowLevelConsumerOptions = {
        consumerGroupId: kafkaConsumerCommonOptions.consumerGroupId,
        batchSize: kafkaConsumerCommonOptions.batchSize,
        batchTimeoutMs: kafkaConsumerCommonOptions.batchTimeoutMs,
        autoOffsetReset: kafkaConsumerCommonOptions.autoOffsetReset
      };

      stateEventsConsumer =
        this._kafkaBuilder.buildLowLevelConsumer(consumerOpts);
    }
    this._stateEventsConsumer = stateEventsConsumer;

    /*
     * Instantiate the aggregate to be used by the snapshotter and read side projections
     */
    const aggregate = new LedgerAggregate(this._esRepo, this._producer, logger);

    /*
     * Instantiate the snapshotter
     */
    const configs: LedgerStateEventHandlerConfigs = {
      maxStateEventsBetweenSnapshots: MAX_EVENTS_PER_SNAPSHOT,
      maxTimeBetweenSnapshotsMs: MAX_SECS_SINCE_LAST_SNAPSHOT * 1000,
      minTimeBetweenSnapshotsMs: MIN_SECS_SINCE_LAST_SNAPSHOT * 1000
    };

    this._stateEventHandler = new LedgerStateEventHandler(
      configs,
      aggregate,
      this._esRepo,
      this._stateEventsConsumer,
      this._readSideRepo,
      this._logger
    );

    await this._stateEventHandler.init();
    this._logger.info(
      `${this._stateEventHandler.constructor.name} ready to receive state events`
    );

    /*
     * Instantiate the read side projector svc
     */

    if (!domainEventsConsumer) {
      //domainEventsConsumer = this._kafkaBuilder.buildConsumer(kafkaConsumerCommonOptions);

      const consumerOpts: KafkaLowLevelConsumerOptions = {
        consumerGroupId: kafkaConsumerCommonOptions.consumerGroupId,
        batchSize: kafkaConsumerCommonOptions.batchSize,
        batchTimeoutMs: kafkaConsumerCommonOptions.batchTimeoutMs,
        autoOffsetReset: kafkaConsumerCommonOptions.autoOffsetReset
      };

      domainEventsConsumer =
        this._kafkaBuilder.buildLowLevelConsumer(consumerOpts);
    }
    this._domainEventsConsumer = domainEventsConsumer;

    /*
     * Instantiate the integration event handler
     */
    this._integrationEventHandler = new IntegrationEventHandler(
      this._domainEventsConsumer,
      this._producer,
      this._logger
    );
    await this._integrationEventHandler.init();
    this._logger.info(
      `${this._integrationEventHandler.constructor.name} ready to receive integration events`
    );

    this._logger.info(
      `${PalLedgerEventHandlerService.name} started successfully`
    );
  }

  static async stop(): Promise<void> {
    if (this._stateEventHandler) {
      await this._stateEventHandler.destroy();
    }

    if (this._stateEventsConsumer) {
      await this._stateEventsConsumer.stop();
      await this._stateEventsConsumer.disconnect(false);
    }

    if (this._domainEventsConsumer) {
      await this._domainEventsConsumer.stop();
      await this._domainEventsConsumer.disconnect(false);
    }

    if (this._producer) {
      await this._producer.disconnect();
    }
  }
}
