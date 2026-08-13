import { AuthServiceServer } from './grpc/grpc-service';

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
import { MongoDbGrantRepo } from 'auth-implementations-lib';

const BC_NAME = 'AUTH';
const APP_NAME = `${BC_NAME}_API_SVC`;
const INSTANCE_ID = `${APP_NAME}_${crypto.randomUUID()}`;

const KAFKA_URL = process.env['KAFKA_URL'] || 'localhost:9092';
const MONGODB_URL = process.env['MONGODB_URL'] || 'mongodb://localhost:27017';

export class AuthApiService {
  private static grpcService: AuthServiceServer;
  private static msgProducer: KafkaProducer;
  private static msgConsumer: KafkaConsumer;
  private static repo: MongoDbGrantRepo;

  static async start(): Promise<void> {
    const logger = new PinoLogger({
      bcName: BC_NAME,
      appName: APP_NAME,
      instanceId: INSTANCE_ID
    });

    this.repo = new MongoDbGrantRepo(MONGODB_URL, logger.child('grant-repo'));
    await this.repo.init();

    const kafkaBuilder = new KafkaBuilder()
      .withLogger(logger)
      .withBrokerList(KAFKA_URL)
      .withClientId(INSTANCE_ID)
      .withSerializerFactory(MessageSerializationFactory.instance());

    this.msgProducer = kafkaBuilder.buildProducer({});
    await this.msgProducer.connect();

    this.msgConsumer = kafkaBuilder.buildConsumer({
      consumerGroupId: `auth-api-service`
    });
    this.msgConsumer.setTopics([DomainEventTopics.AuthEvents]);
    await this.msgConsumer.connect();
    await this.msgConsumer.startAndWaitForRebalance();

    this.grpcService = new AuthServiceServer(
      '1',
      '0.0.0.0:50054',
      this.msgProducer,
      this.msgConsumer,
      this.repo
    );

    await this.grpcService.start();
  }

  static async stop(): Promise<void> {
    await this.grpcService.stop();
    await this.msgConsumer.stop();
    await this.msgProducer.disconnect();
    await this.msgConsumer.disconnect();
  }
}
