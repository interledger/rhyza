import { IntegrationEventHandler } from './handlers/integration-event-handler';
import {
  KafkaBuilder,
  KafkaConsumer,
  KafkaProducer,
  MessageSerializationFactory,
  PinoLogger
} from 'implementations-lib';
import { RetryEventHandler } from './handlers/retry-event-handler';
import { MongoDbNotificationRepo } from 'notifications-implementations-lib';

const KAFKA_URL = process.env.KAFKA_URL || 'localhost:9093';
const BC_NAME = process.env.BC_NAME || 'NOTIFICATIONS';
const APP_NAME = process.env.APP_NAME || 'NOTIFICATIONS_EVENT_HANDLER_SVC';
const INSTANCE_ID = `${APP_NAME}_${crypto.randomUUID()}`;
const MONGODB_URL = process.env['MONGODB_URL'] || 'mongodb://localhost:27018';

export class NotificationsEventHandlerService {
  private static integrationEventHandler: IntegrationEventHandler;
  private static notificationRepository: MongoDbNotificationRepo;
  private static retryEventHandler: RetryEventHandler;
  private static msgProducer: KafkaProducer;
  private static msgConsumer: KafkaConsumer;

  static async start(): Promise<void> {
    const logger = new PinoLogger({
      bcName: BC_NAME,
      appName: APP_NAME,
      instanceId: INSTANCE_ID
    });
    const kafkaBuilder = new KafkaBuilder();
    kafkaBuilder
      .withBrokerList(KAFKA_URL)
      .withClientId(`NOTIFICATIONS_EVENT_HANDLER_SVC_${crypto.randomUUID()}`)
      .withSerializerFactory(MessageSerializationFactory.instance())
      .withLogger(logger);

    this.msgProducer = kafkaBuilder.buildProducer({});
    await this.msgProducer.connect();

    this.msgConsumer = kafkaBuilder.buildConsumer({
      consumerGroupId: 'notifications-event-handler'
    });

    this.integrationEventHandler = new IntegrationEventHandler(
      this.msgConsumer,
      this.msgProducer
    );

    await this.integrationEventHandler.start();

    this.notificationRepository = new MongoDbNotificationRepo(MONGODB_URL);
    await this.notificationRepository.init();

    this.retryEventHandler = new RetryEventHandler(
      this.msgProducer,
      this.notificationRepository,
      logger,
      INSTANCE_ID
    );

    await this.retryEventHandler.start();
  }

  static async stop(): Promise<void> {
    await this.integrationEventHandler.stop();
    await this.retryEventHandler.stop();
    await this.msgProducer.disconnect();
    await this.notificationRepository.destroy();
  }
}
