import {
  KafkaBuilder,
  KafkaConsumer,
  KafkaProducer,
  PinoLogger,
  MessageSerializationFactory
} from 'implementations-lib';
import { MongoDbPaymentIntentRepo } from 'payments-implementations-lib';
import { PaymentsEventHandler } from './event-handler';
import { ExpiryCheckHandler } from './expiry-check-handler';
import process from 'process';
import crypto from 'crypto';

const BC_NAME = 'PAYMENTS';
const APP_NAME = `${BC_NAME}_EVENT_HANDLER_SVC`;
const INSTANCE_ID = `${APP_NAME}_${crypto.randomUUID()}`;

const KAFKA_URL = process.env['KAFKA_URL'] || 'localhost:9092';
const MONGODB_URL = process.env['MONGODB_URL'] || 'mongodb://localhost:27017';
const PAYMENT_EXPIRY_TICK_INTERVAL_MS =
  (process.env['PAYMENT_EXPIRY_TICK_INTERVAL_MS'] &&
    parseInt(process.env['PAYMENT_EXPIRY_TICK_INTERVAL_MS'])) ||
  1000;
// #236: query Mongo for expired payments at most once a second.
const PAYMENT_EXPIRY_MIN_CHECK_INTERVAL_MS = 1000;
const PAYMENT_EXPIRY_CHECK_LIMIT = 500;

export class PaymentsEventHandlerService {
  private static eventHandler: PaymentsEventHandler;
  private static expiryCheckHandler: ExpiryCheckHandler;
  private static msgProducer: KafkaProducer;
  private static msgConsumer: KafkaConsumer;
  private static expiryCheckConsumer: KafkaConsumer;
  private static repo: MongoDbPaymentIntentRepo;

  static async start(): Promise<void> {
    const logger = new PinoLogger({
      bcName: BC_NAME,
      appName: APP_NAME,
      instanceId: INSTANCE_ID
    });

    const kafkaBuilder = new KafkaBuilder()
      .withLogger(logger)
      .withBrokerList(KAFKA_URL)
      .withClientId(INSTANCE_ID)
      .withSerializerFactory(MessageSerializationFactory.instance());

    this.msgProducer = kafkaBuilder.buildProducer({});
    await this.msgProducer.connect();

    this.msgConsumer = kafkaBuilder.buildConsumer({
      consumerGroupId: 'payments-event-handler'
    });

    this.eventHandler = new PaymentsEventHandler(
      this.msgConsumer,
      this.msgProducer
    );

    await this.eventHandler.start();

    this.repo = new MongoDbPaymentIntentRepo(
      MONGODB_URL,
      logger.child('payment-intent-repo')
    );
    await this.repo.init();

    this.expiryCheckConsumer = kafkaBuilder.buildConsumer({
      consumerGroupId: 'payments-expiry-check'
    });

    this.expiryCheckHandler = new ExpiryCheckHandler(
      this.expiryCheckConsumer,
      this.msgProducer,
      this.repo,
      logger.child('expiry-check'),
      {
        tickIntervalMs: PAYMENT_EXPIRY_TICK_INTERVAL_MS,
        minCheckIntervalMs: PAYMENT_EXPIRY_MIN_CHECK_INTERVAL_MS,
        limit: PAYMENT_EXPIRY_CHECK_LIMIT
      }
    );

    await this.expiryCheckHandler.start();
  }

  static async stop(): Promise<void> {
    await this.expiryCheckHandler.stop();
    await this.eventHandler.stop();
    await this.msgProducer.disconnect();
    await this.repo.destroy();
  }
}
