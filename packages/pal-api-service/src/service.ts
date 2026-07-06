import {
  AssetAggregate,
  IPalAssetRepository,
  IPalWalletAddressRepository,
  WalletAddressAggregate,
  ILedgerReadSideRepository,
  PeerAggregate,
  IPalPeerRepository,
  IPalPeerAseFxService,
  PeerFxCacheExpiryService
} from 'pal-domain-lib';
import { PalGrpcServer } from './grpc/grpc-service';
import process from 'process';
import {
  AseFxServiceAdapter,
  CreateLedgerAccountForAssetCmdSerde,
  CreateLedgerAccountsForPeerCmdSerde,
  CreateLedgerCmdSerde,
  MongoDbAssetRepo,
  MongoDbLedgerReadSideRepo,
  MongoDbPeerRepo,
  MongoDbWalletRepo
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
  IKafkaBuilder,
  KafkaBuilder,
  KafkaConsumerOptions,
  KafkaProducerCompressionCodecs,
  KafkaProducerOptions,
  MessageSerializationFactory,
  PinoLogger
} from 'implementations-lib';
import crypto from 'crypto';

const SVC_PORT = process.env['SVC_PORT']
  ? parseInt(process.env['SVC_PORT'])
  : 50051;

const BC_NAME = 'PAL';
const APP_NAME = `${BC_NAME}_API_SVC`;
const INSTANCE_ID = `${APP_NAME}_${crypto.randomUUID()}`;

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
  queueBufferingMaxMessages: 100_000,
  compressionCodec: KafkaProducerCompressionCodecs.GZIP,
  messageMaxBytes: 20971520
};
const kafkaConsumerCommonOptions: KafkaConsumerOptions = {
  consumerGroupId: 'PAL_API_SVC',
  batchTimeoutMs: 50,
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

export class PalApiService {
  private static _logger: ILogger;
  private static _msgSerializationFactory: IRawMessageSerializerFactory;
  private static _kafkaBuilder: IKafkaBuilder;
  private static _assetRepo: IPalAssetRepository;
  private static _walletRepo: IPalWalletAddressRepository;
  private static _peerRepo: IPalPeerRepository;
  private static _aseFxService: IPalPeerAseFxService;
  private static _ledgerReadSideRepo: ILedgerReadSideRepository;
  private static _producer: IMessageProducer;
  private static _consumer: IMessageConsumer;
  private static grpcService: PalGrpcServer;

  static async start(
    logger?: ILogger,
    msgSerializationFactory?: IRawMessageSerializerFactory,
    kafkaBuilder?: IKafkaBuilder,
    assetRepo?: IPalAssetRepository,
    walletRepo?: IPalWalletAddressRepository,
    peerRepo?: IPalPeerRepository,
    aseFxService?: IPalPeerAseFxService,
    ledgerReadSideRepo?: ILedgerReadSideRepository
  ): Promise<void> {
    if (!logger) {
      logger = new PinoLogger({
        bcName: BC_NAME,
        appName: APP_NAME,
        instanceId: INSTANCE_ID
      });
    }
    this._logger = logger;

    this._logger.info(`Starting ${this.constructor.name}...`);

    if (!msgSerializationFactory) {
      MessageSerializationFactory.instance()
        // we only need the commands
        .register(new CreateLedgerCmdSerde())
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
        .withSerializerFactory(this._msgSerializationFactory);
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

    if (!assetRepo) {
      assetRepo = new MongoDbAssetRepo(MONGO_URL, logger);
      await (assetRepo as MongoDbAssetRepo).init();
    }
    this._assetRepo = assetRepo;

    if (!walletRepo) {
      walletRepo = new MongoDbWalletRepo(MONGO_URL, logger);
      await (walletRepo as MongoDbWalletRepo).init();
    }
    this._walletRepo = walletRepo;

    if (!peerRepo) {
      peerRepo = new MongoDbPeerRepo(MONGO_URL, logger);
      await (peerRepo as MongoDbPeerRepo).init();
    }
    this._peerRepo = peerRepo;

    if (!aseFxService) {
      aseFxService = new AseFxServiceAdapter(
        EXCHANGE_RATES_URL,
        EXCHANGE_RATES_TIMEOUT_SECS * 1000,
        EXCHANGE_RATES_LIFETIME_SECS * 1000,
        logger
      );
    }
    this._aseFxService = aseFxService;

    if (!ledgerReadSideRepo) {
      const repo = new MongoDbLedgerReadSideRepo(MONGO_URL, logger);
      await repo.init();
      ledgerReadSideRepo = repo;
    }
    this._ledgerReadSideRepo = ledgerReadSideRepo;

    // create producer from kafka builder
    this._producer = this._kafkaBuilder.buildProducer(
      kafkaProducerCommonOptions
    );
    this._consumer = this._kafkaBuilder.buildConsumer(
      kafkaConsumerCommonOptions
    );

    // create aggregates driven by this gRPC port
    const assetAggregate = new AssetAggregate(this._assetRepo, this._logger);

    const walletAggregate = new WalletAddressAggregate(
      this._walletRepo,
      this._logger
    );

    const peerAggregate = new PeerAggregate(
      this._peerRepo,
      this._aseFxService,
      new PeerFxCacheExpiryService(this._producer, this._logger),
      this._logger
    );

    this.grpcService = new PalGrpcServer(
      INSTANCE_ID,
      `0.0.0.0:${SVC_PORT}`,
      assetAggregate,
      walletAggregate,
      peerAggregate,
      this._producer,
      this._consumer,
      this._ledgerReadSideRepo,
      this._logger
    );

    await this.grpcService.start();
  }

  static async stop(): Promise<void> {
    await this.grpcService.stop();

    if (this._producer) {
      await this._producer.disconnect();
    }
  }
}
