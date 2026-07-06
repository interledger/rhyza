import { PaymentsServiceServer } from './grpc/grpc-service';

import { DomainEventTopics } from 'common-types-lib';
import process from 'process';
import crypto from 'crypto';
import {
  KafkaBuilder,
  KafkaConsumer,
  KafkaProducer,
  MessageSerializationFactory,
  PinoLogger
} from 'implementations-lib';
import { MongoDbPaymentIntentRepo } from 'payments-implementations-lib';

const BC_NAME = 'PAYMENTS';
const APP_NAME = `${BC_NAME}_API_SVC`;
const INSTANCE_ID = `${APP_NAME}_${crypto.randomUUID()}`;

const KAFKA_URL = process.env['KAFKA_URL'] || 'localhost:9092';
const MONGODB_URL = process.env['MONGODB_URL'] || 'mongodb://localhost:27017';

export class PaymentsApiService {
  private static grpcService: PaymentsServiceServer;
  private static msgProducer: KafkaProducer;
  private static msgConsumer: KafkaConsumer;
  private static repo: MongoDbPaymentIntentRepo;

  static async start(): Promise<void> {
    const logger = new PinoLogger({
      bcName: BC_NAME,
      appName: APP_NAME,
      instanceId: INSTANCE_ID
    });

    this.repo = new MongoDbPaymentIntentRepo(
      MONGODB_URL,
      logger.child('payment-intent-repo')
    );
    await this.repo.init();

    const kafkaBuilder = new KafkaBuilder()
      .withLogger(logger.child('kafka'))
      .withBrokerList(KAFKA_URL)
      .withClientId(INSTANCE_ID)
      .withSerializerFactory(MessageSerializationFactory.instance());

    this.msgProducer = kafkaBuilder.buildProducer({});
    await this.msgProducer.connect();

    this.msgConsumer = kafkaBuilder.buildConsumer({
      consumerGroupId: `payments-api-service`
    });
    this.msgConsumer.setTopics([DomainEventTopics.PaymentEvents]);
    await this.msgConsumer.connect();
    await this.msgConsumer.startAndWaitForRebalance();

    this.grpcService = new PaymentsServiceServer(
      '1',
      '0.0.0.0:50052',
      this.msgProducer,
      this.msgConsumer,
      this.repo,
      logger.child('grpc')
    );

    await this.grpcService.start();
  }

  static async stop(): Promise<void> {
    await this.grpcService.stop();
    await this.msgConsumer.stop();
    await this.msgProducer.disconnect();
    await this.msgConsumer.disconnect();
    await this.repo.destroy();
  }
}
