import {
  KafkaConsumer,
  KafkaProducer,
  KafkaBuilder,
  PinoLogger,
  MessageSerializationFactory
} from 'implementations-lib';
import {
  MongoDbPaymentIntentRepo,
  RemotePaymentIntentAdapter,
  PalAdapter,
  StaticRatesAdapter
} from 'payments-implementations-lib';
import { PaymentIntentAggregate } from 'payments-domain-lib';
import { PalClient } from 'pal-client-lib';
import { PaymentsCommandHandler } from './cmd-handler';
import process from 'process';
import crypto from 'crypto';

const BC_NAME = 'PAYMENTS';
const APP_NAME = `${BC_NAME}_CMD_HANDLER_SVC`;
const INSTANCE_ID = `${APP_NAME}_${crypto.randomUUID()}`;

const KAFKA_URL = process.env['KAFKA_URL'] || 'localhost:9092';
const MONGODB_URL = process.env['MONGODB_URL'] || 'mongodb://localhost:27017';
const PAL_GRPC_URL = process.env['PAL_GRPC_URL'] || 'localhost:50051';
const CONSUMER_BATCH_SIZE =
  (process.env['CONSUMER_BATCH_SIZE'] &&
    parseInt(process.env['CONSUMER_BATCH_SIZE'])) ||
  250;
const CONSUMER_BATCH_TIMEOUT_MS =
  (process.env['CONSUMER_BATCH_TIMEOUT_MS'] &&
    parseInt(process.env['CONSUMER_BATCH_TIMEOUT_MS'])) ||
  50;

export class PaymentsCommandHandlerService {
  private static commandHandler: PaymentsCommandHandler;
  private static msgProducer: KafkaProducer;
  private static msgConsumer: KafkaConsumer;
  private static repo: MongoDbPaymentIntentRepo;

  static async start(): Promise<void> {
    const logger = new PinoLogger({
      bcName: BC_NAME,
      appName: APP_NAME,
      instanceId: INSTANCE_ID
    });

    const kafkaBuilder = new KafkaBuilder()
      .withLogger(logger.child('kafka'))
      .withBrokerList(KAFKA_URL)
      .withClientId(INSTANCE_ID)
      .withSerializerFactory(MessageSerializationFactory.instance());

    this.repo = new MongoDbPaymentIntentRepo(
      MONGODB_URL,
      logger.child('payment-intent-repo')
    );
    await this.repo.init();

    const palClient = new PalClient(PAL_GRPC_URL);

    const palAdapter = new PalAdapter(palClient);
    const staticRatesAdapter = new StaticRatesAdapter();
    const remotePaymentIntentAdapter = new RemotePaymentIntentAdapter();

    const aggregate = new PaymentIntentAggregate(
      this.repo,
      palAdapter,
      staticRatesAdapter,
      remotePaymentIntentAdapter,
      logger.child('aggregate')
    );

    this.msgProducer = kafkaBuilder.buildProducer({});
    await this.msgProducer.connect();

    this.msgConsumer = kafkaBuilder.buildConsumer({
      consumerGroupId: `payments-cmd-handler`,
      batchSize: CONSUMER_BATCH_SIZE,
      batchTimeoutMs: CONSUMER_BATCH_TIMEOUT_MS
    });

    this.commandHandler = new PaymentsCommandHandler(
      this.msgConsumer,
      this.msgProducer,
      aggregate,
      logger.child('command-handler')
    );
    await this.commandHandler.start();
  }

  static async stop(): Promise<void> {
    await this.commandHandler.stop();
    await this.msgProducer.disconnect();
    await this.repo.destroy();
  }
}
