import {
  KafkaConsumer,
  KafkaProducer,
  KafkaBuilder,
  PinoLogger,
  MessageSerializationFactory
} from 'implementations-lib';
import {
  MongoDbGrantRepo,
  WalletAddressAdapter
} from 'auth-implementations-lib';
import {
  DEFAULT_GRANT_CONTINUE_WAIT_SECONDS,
  GrantAggregate
} from 'auth-domain-lib';
import { AuthCommandHandler } from './cmd-handler';
import process from 'process';
import crypto from 'crypto';
import { ILogger } from 'common-types-lib';

const BC_NAME = 'AUTH';
const APP_NAME = `${BC_NAME}_CMD_HANDER_SVC`;
const INSTANCE_ID = `${APP_NAME}_${crypto.randomUUID()}`;

const KAFKA_URL = process.env['KAFKA_URL'] || 'localhost:9092';
const MONGODB_URL = process.env['MONGODB_URL'] || 'mongodb://localhost:27017';
const CONSUMER_BATCH_SIZE =
  (process.env['CONSUMER_BATCH_SIZE'] &&
    parseInt(process.env['CONSUMER_BATCH_SIZE'])) ||
  250;
const CONSUMER_BATCH_TIMEOUT_MS =
  (process.env['CONSUMER_BATCH_TIMEOUT_MS'] &&
    parseInt(process.env['CONSUMER_BATCH_TIMEOUT_MS'])) ||
  50;
const GRANT_CONTINUE_WAIT_SECONDS =
  (process.env['GRANT_CONTINUE_WAIT_SECONDS'] &&
    parseInt(process.env['GRANT_CONTINUE_WAIT_SECONDS'])) ||
  DEFAULT_GRANT_CONTINUE_WAIT_SECONDS;

export class AuthCommandHandlerService {
  private static _logger: ILogger;
  private static commandHandler: AuthCommandHandler;
  private static msgProducer: KafkaProducer;
  private static msgConsumer: KafkaConsumer;
  private static repo: MongoDbGrantRepo;

  static async start(): Promise<void> {
    this._logger = new PinoLogger({
      bcName: BC_NAME,
      appName: APP_NAME,
      instanceId: INSTANCE_ID
    });

    const kafkaBuilder = new KafkaBuilder()
      .withLogger(this._logger.child('kafka'))
      .withBrokerList(KAFKA_URL)
      .withClientId(INSTANCE_ID)
      .withSerializerFactory(MessageSerializationFactory.instance());

    this.repo = new MongoDbGrantRepo(
      MONGODB_URL,
      this._logger.child('grant-repo')
    );
    await this.repo.init();

    const walletAddressAdapter = new WalletAddressAdapter();

    const aggregate = new GrantAggregate(
      this.repo,
      walletAddressAdapter,
      this._logger,
      { continueWaitSeconds: GRANT_CONTINUE_WAIT_SECONDS }
    );

    this.msgProducer = kafkaBuilder.buildProducer({});
    await this.msgProducer.connect();

    this.msgConsumer = kafkaBuilder.buildConsumer({
      consumerGroupId: `auth-cmd-handler`,
      batchSize: CONSUMER_BATCH_SIZE,
      batchTimeoutMs: CONSUMER_BATCH_TIMEOUT_MS
    });

    this.commandHandler = new AuthCommandHandler(
      this.msgConsumer,
      this.msgProducer,
      aggregate,
      this._logger.child('command-handler')
    );
    await this.commandHandler.start();
  }

  static async stop(): Promise<void> {
    await this.commandHandler.stop();
    await this.msgProducer.disconnect();
    await this.repo.destroy();
  }
}
