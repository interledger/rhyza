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
  ILedgerReadSideRepository,
  PeerAggregate,
  IPalPeerRepository,
  IPalAssetRepository,
  AssetAggregate,
  IPalPeerAseFxService,
  PeerFxCacheExpiryService
} from 'pal-domain-lib';
import {
  AseFxServiceAdapter,
  CreateLedgerAccountForAssetCmdSerde,
  CreateLedgerAccountsForPeerCmdSerde,
  CreateLedgerCmdSerde,
  KafkaLedgerEventSourcingRepository,
  LedgerAccountsCreatedStateEventSerde,
  LedgerCreatedStateEventSerde,
  LedgerSnapshotSerde,
  LedgerTransactionRecordedStateEventSerde,
  MongoDbAssetRepo,
  MongoDbLedgerReadSideRepo,
  MongoDbPeerRepo,
  PostTransactionCmdSerde
} from 'pal-implementations-lib';

import {
  CommandTopics,
  DomainEventTopics,
  ILogger,
  IMessageConsumer,
  IMessageProducer,
  IRawMessageSerializerFactory,
  SnapshotEventTopics,
  StateEventTopics
} from 'common-types-lib';
import {
  LedgerStateEventHandler,
  LedgerStateEventHandlerConfigs
} from './handlers/ledger-state-event-handler';
import { IntegrationEventHandler } from './handlers/integration-event-handler';
import { InternalEventHandler } from './handlers/internal-event-handler';

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

const EXCHANGE_RATES_URL =
  process.env['SVCEXCHANGE_RATES_URL_PORT'] || 'http://localhost:7000/rates';
// Original param in milliseconds is called EXCHANGE_RATES_LIFETIME
const EXCHANGE_RATES_LIFETIME_SECS = process.env['EXCHANGE_RATES_LIFETIME']
  ? parseInt(process.env['EXCHANGE_RATES_LIFETIME'])
  : 3600;

const EXCHANGE_RATES_TIMEOUT_SECS = process.env['EXCHANGE_RATES_TIMEOUT_SECS']
  ? parseInt(process.env['EXCHANGE_RATES_TIMEOUT_SECS'])
  : 10;

// these params are for non-productive environments, by default we don't create topics
const CREATE_TOPICS =
  (process.env['CREATE_TOPICS'] &&
    process.env['CREATE_TOPICS'].toUpperCase() === 'TRUE') ||
  false;
const DEFAULT_PARTITION_COUNT = 3;
const DEFAULT_ISR = 2;
const REQUIRED_TOPICS = [
  SnapshotEventTopics.LedgerSnapshotEvents,
  StateEventTopics.LedgerStateEvents,
  DomainEventTopics.LedgerEvents,
  DomainEventTopics.AssetEvents,
  DomainEventTopics.PeerEvents,
  CommandTopics.LedgerCommands
];

/**
 * This service behaves as 3 separate services for now:
 * 1. Snapshotter - takes snapshots of the ledger state when needed
 * 2. Projector - updates the read side projections of the ledger state
 * 3. Internal BC event handler - handles internal events for saga like internal
 * 4. Integration event handler - handles integration events from the external domains
 */

export class PalLedgerEventHandlerService {
  private static _logger: ILogger;
  private static _esRepo: ILedgerEventSourcingRepository;
  private static _producer: IMessageProducer;
  private static _stateEventsConsumer: IMessageConsumer;
  private static _integrationEventsConsumer: IMessageConsumer;
  private static _internalEventsConsumer: IMessageConsumer;
  private static _kafkaBuilder: IKafkaBuilder;
  private static _msgSerializationFactory: IRawMessageSerializerFactory;
  private static _readSideRepo: ILedgerReadSideRepository;
  private static _assetRepo: IPalAssetRepository;
  private static _peerRepo: IPalPeerRepository;
  private static _aseFxService: IPalPeerAseFxService;

  private static _stateEventHandler: LedgerStateEventHandler;
  private static _integrationEventHandler: IntegrationEventHandler;
  private static _internalEventHandler: InternalEventHandler;

  static async start(
    logger?: ILogger,
    msgSerializationFactory?: IRawMessageSerializerFactory,
    kafkaBuilder?: IKafkaBuilder,
    esRepo?: ILedgerEventSourcingRepository,
    readSideRepo?: ILedgerReadSideRepository,
    stateEventsConsumer?: IMessageConsumer,
    integrationEventsConsumer?: IMessageConsumer,
    internalEventsConsumer?: IMessageConsumer,
    producer?: IMessageProducer,
    peerRepo?: IPalPeerRepository,
    aseFxService?: IPalPeerAseFxService,
    assetRepo?: IPalAssetRepository
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
        .register(new LedgerAccountsCreatedStateEventSerde())
        .register(new LedgerTransactionRecordedStateEventSerde())
        // commands
        .register(new CreateLedgerCmdSerde())
        .register(new PostTransactionCmdSerde())
        .register(new CreateLedgerAccountForAssetCmdSerde())
        .register(new CreateLedgerAccountsForPeerCmdSerde());

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

    if (CREATE_TOPICS) {
      const topicsToCreate = REQUIRED_TOPICS.map((topicName) => {
        return {
          topic: topicName,
          numPartitions: DEFAULT_PARTITION_COUNT,
          replicationFactor: DEFAULT_ISR
        };
      });
      const admin = this._kafkaBuilder.buildAdmin();
      await admin.connect();
      // if the topics already exist, this won't have an effect
      await admin.createTopics(topicsToCreate);
    }

    if (!esRepo) {
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

    /*
     * Instantiate state event habdlers - snapshotter and projector
     */

    if (!stateEventsConsumer) {
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

    // Instantiate the aggregate to be used by the snapshotter and read side projections
    const ledgerAggregate = new LedgerAggregate(
      this._esRepo,
      this._producer,
      logger
    );

    const configs: LedgerStateEventHandlerConfigs = {
      maxStateEventsBetweenSnapshots: MAX_EVENTS_PER_SNAPSHOT,
      maxTimeBetweenSnapshotsMs: MAX_SECS_SINCE_LAST_SNAPSHOT * 1000,
      minTimeBetweenSnapshotsMs: MIN_SECS_SINCE_LAST_SNAPSHOT * 1000
    };

    this._stateEventHandler = new LedgerStateEventHandler(
      configs,
      ledgerAggregate,
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
     * Instantiate the Internal Event Handler
     */

    if (!internalEventsConsumer) {
      const consumerOpts: KafkaLowLevelConsumerOptions = {
        consumerGroupId: kafkaConsumerCommonOptions.consumerGroupId,
        batchSize: kafkaConsumerCommonOptions.batchSize,
        batchTimeoutMs: kafkaConsumerCommonOptions.batchTimeoutMs,
        autoOffsetReset: kafkaConsumerCommonOptions.autoOffsetReset
      };

      internalEventsConsumer =
        this._kafkaBuilder.buildLowLevelConsumer(consumerOpts);
    }
    this._internalEventsConsumer = internalEventsConsumer;

    if (!assetRepo) {
      assetRepo = new MongoDbAssetRepo(MONGO_URL, this._logger);
      await (assetRepo as MongoDbAssetRepo).init();
    }
    this._assetRepo = assetRepo;

    const assetAggregate = new AssetAggregate(this._assetRepo, this._logger);

    if (!aseFxService) {
      aseFxService = new AseFxServiceAdapter(
        EXCHANGE_RATES_URL,
        EXCHANGE_RATES_TIMEOUT_SECS * 1000,
        EXCHANGE_RATES_LIFETIME_SECS * 1000,
        logger
      );
    }
    this._aseFxService = aseFxService;

    if (!peerRepo) {
      peerRepo = new MongoDbPeerRepo(MONGO_URL, this._logger);
      await (peerRepo as MongoDbPeerRepo).init();
    }
    this._peerRepo = peerRepo;

    const peerAggregate = new PeerAggregate(
      this._peerRepo,
      this._aseFxService,
      new PeerFxCacheExpiryService(this._producer, this._logger),
      this._logger
    );

    this._internalEventHandler = new InternalEventHandler(
      peerAggregate,
      assetAggregate,
      this._internalEventsConsumer,
      this._producer,
      this._logger
    );
    await this._internalEventHandler.init();
    this._logger.info(
      `${this._internalEventHandler.constructor.name} ready to receive internal events`
    );

    /*
     * Instantiate the integration event handler (external BC events)
     */
    if (!integrationEventsConsumer) {
      const consumerOpts: KafkaLowLevelConsumerOptions = {
        consumerGroupId: kafkaConsumerCommonOptions.consumerGroupId,
        batchSize: kafkaConsumerCommonOptions.batchSize,
        batchTimeoutMs: kafkaConsumerCommonOptions.batchTimeoutMs,
        autoOffsetReset: kafkaConsumerCommonOptions.autoOffsetReset
      };

      integrationEventsConsumer =
        this._kafkaBuilder.buildLowLevelConsumer(consumerOpts);
    }
    this._integrationEventsConsumer = integrationEventsConsumer;

    this._integrationEventHandler = new IntegrationEventHandler(
      this._integrationEventsConsumer,
      this._producer,
      this._logger
    );
    await this._integrationEventHandler.init();
    this._logger.info(
      `${this._integrationEventHandler.constructor.name} ready to receive integration events`
    );

    /*
     * All done
     */
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

    if (this._integrationEventsConsumer) {
      await this._integrationEventsConsumer.stop();
      await this._integrationEventsConsumer.disconnect(false);
    }

    if (this._producer) {
      await this._producer.disconnect();
    }
  }
}
