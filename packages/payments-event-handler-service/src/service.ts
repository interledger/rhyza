import {
  KafkaBuilder,
  KafkaConsumer,
  KafkaProducer,
  PinoLogger,
  MessageSerializationFactory
} from 'implementations-lib';
import { PaymentsEventHandler } from './handlers/payments-event-handler';
import process from 'process';
import crypto from 'crypto';
import { CheckExpirationEventHandler } from './handlers/check-expiration-event-handler';
import { MongoDbPaymentIntentRepo } from 'payments-implementations-lib';

const BC_NAME = 'PAYMENTS';
const APP_NAME = `${BC_NAME}_EVENT_HANDLER_SVC`;
const INSTANCE_ID = `${APP_NAME}_${crypto.randomUUID()}`;
const MONGODB_URL = process.env['MONGODB_URL'] || 'mongodb://localhost:27017';
const KAFKA_URL = process.env['KAFKA_URL'] || 'localhost:9092';

export class PaymentsEventHandlerService {
  private static eventHandler: PaymentsEventHandler;
  private static checkExpiredEventHandler: CheckExpirationEventHandler;
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
      .withLogger(logger)
      .withBrokerList(KAFKA_URL)
      .withClientId(INSTANCE_ID)
      .withSerializerFactory(MessageSerializationFactory.instance());

    this.msgProducer = kafkaBuilder.buildProducer({});
    await this.msgProducer.connect();

    this.msgConsumer = kafkaBuilder.buildConsumer({
      consumerGroupId: 'payments-event-handler'
    });

    this.repo = new MongoDbPaymentIntentRepo(
      MONGODB_URL,
      logger.child('payment-intent-repo')
    );

    this.eventHandler = new PaymentsEventHandler(
      this.msgConsumer,
      this.msgProducer,
      this.repo,
      INSTANCE_ID
    );

    await this.eventHandler.start();

    this.checkExpiredEventHandler = new CheckExpirationEventHandler(
      this.msgProducer,
      logger,
      INSTANCE_ID
    );

    await this.checkExpiredEventHandler.start();
  }

  static async stop(): Promise<void> {
    await this.eventHandler.stop();
    await this.checkExpiredEventHandler.stop();
    await this.msgProducer.disconnect();
    await this.repo.destroy();
  }
}
