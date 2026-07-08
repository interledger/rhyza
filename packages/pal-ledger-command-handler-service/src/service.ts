import {
  PinoLogger,
  MessageSerializationFactory,
  KafkaProducerOptions,
  KafkaProducerCompressionCodecs,
  KafkaBuilder,
  IKafkaBuilder,
  KafkaConsumerOptions,
  KafkaLowLevelConsumerOptions
} from 'implementations-lib';
import {
  ILedgerEventSourcingRepository,
  LedgerAggregate
} from 'pal-domain-lib';
import {
  CreateLedgerAccountsForPeerCmdSerde,
  CreateLedgerAccountForAssetCmdSerde,
  CreateLedgerCmdSerde,
  KafkaLedgerEventSourcingRepository,
  LedgerCreatedStateEventSerde,
  LedgerSnapshotSerde,
  LedgerAccountsCreatedStateEventSerde
} from 'pal-implementations-lib';
import { LedgerTransactionRecordedStateEventSerde } from 'pal-implementations-lib';
import crypto from 'crypto';
import process from 'process';
import {
  CommandMsg,
  CommandTopics,
  DomainEventTopics,
  ILogger,
  IMessage,
  IMessageConsumer,
  IMessageProducer,
  IRawMessageSerializerFactory,
  MessageTypes,
  SnapshotEventTopics,
  StateEventTopics
} from 'common-types-lib';

const BC_NAME = 'PAL';
const APP_NAME = `${BC_NAME}_LEDGER_CMD_HANDLER_SVC`;
const INSTANCE_ID = `${APP_NAME}_${crypto.randomUUID()}`;

const REDIS_URL = process.env['REDIS_URL'] || 'redis://localhost:6379';

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
  CommandTopics.LedgerCommands,
  DomainEventTopics.FxRateEvents
];

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
  consumerGroupId: 'ES_LEDGER_POC_COMMAND_SVC',
  batchTimeoutMs: 50,
  batchSize: 50_000
};

export class PalLedgerCommandHandlerService {
  private static _logger: ILogger;
  private static _msgSerializationFactory: IRawMessageSerializerFactory;
  private static _ledgerAggregate: LedgerAggregate;
  private static _esRepo: ILedgerEventSourcingRepository;
  private static _producer: IMessageProducer;
  private static _consumer: IMessageConsumer;
  private static _kafkaBuilder: IKafkaBuilder;

  static async start(
    logger?: ILogger,
    msgSerializationFactory?: IRawMessageSerializerFactory,
    kafkaBuilder?: IKafkaBuilder,
    esRepo?: ILedgerEventSourcingRepository,
    producer?: IMessageProducer,
    consumer?: IMessageConsumer
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
        // snapshots
        .register(new LedgerSnapshotSerde())
        // state events
        .register(new LedgerCreatedStateEventSerde())
        .register(new LedgerAccountsCreatedStateEventSerde())
        .register(new LedgerTransactionRecordedStateEventSerde())
        // commands
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

    if (!producer) {
      producer = this._kafkaBuilder.buildProducer(kafkaProducerCommonOptions);
      await producer.connect();
    }
    this._producer = producer;

    // before continuing, we need to ensure that the topics exist
    const requiredTopics = [
      CommandTopics.LedgerCommands,
      StateEventTopics.LedgerStateEvents,
      DomainEventTopics.LedgerEvents
    ];
    const admin = this._kafkaBuilder.buildAdmin();
    await admin.connect();
    if (!(await admin.hasAllTopics(requiredTopics))) {
      throw new Error(
        'Kafka topics do not exist. Please create them before starting the service.'
      );
    }
    await admin.disconnect();

    this._ledgerAggregate = new LedgerAggregate(
      this._esRepo,
      this._producer,
      this._logger
    );

    this._ledgerAggregate.printStats();
    this._logger.info('Ledger initialized');

    // TODO confirm topics exist using admin client?

    if (!consumer) {
      // consumer = this._kafkaBuilder.buildConsumer(kafkaConsumerCommonOptions);

      const consumerOpts: KafkaLowLevelConsumerOptions = {
        consumerGroupId: kafkaConsumerCommonOptions.consumerGroupId,
        batchSize: kafkaConsumerCommonOptions.batchSize,
        batchTimeoutMs: kafkaConsumerCommonOptions.batchTimeoutMs,
        autoOffsetReset: kafkaConsumerCommonOptions.autoOffsetReset
      };

      consumer = this._kafkaBuilder.buildLowLevelConsumer(consumerOpts);

      // const lowLevelConsumerOptions:KafkaLowLevelConsumerOptions ={
      //   ...kafkaConsumerCommonOptions,
      //   kafkaBrokerList: KAFKA_URL,
      //   kafkaGroupId: INSTANCE_ID
      // }
      // consumer = new KafkaLowLevelConsumer(
      //   lowLevelConsumerOptions, MessageSerializationFactory.instance(), this._logger
      // );
    }
    this._consumer = consumer;

    this._consumer.setTopics([CommandTopics.LedgerCommands]);
    this._consumer.setBatchCallbackFn(async (messages: IMessage[]) => {
      // filter out only commands (sort of redundant but good practice)
      const cmds = messages.filter((m) => m.msgType === MessageTypes.COMMAND);
      if (cmds.length === 0) return;
      // TODO hook telemetry here
      await this._ledgerAggregate.processCommands(cmds as CommandMsg[]);
    });

    await this._consumer.connect();
    await this._consumer.startAndWaitForRebalance();

    this._logger.info(
      `${PalLedgerCommandHandlerService.name} ready to receive commands`
    );
  }

  static async stop(): Promise<void> {
    // first stop consuming
    if (this._consumer) {
      await this._consumer.stop();
      await this._consumer.disconnect(false);
    }

    // now stop the publisher, disconnect with flush any pending messages
    if (this._producer) {
      await this._producer.disconnect();
    }
  }
}
