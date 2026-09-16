import {
  KafkaBuilder,
  KafkaConsumer,
  KafkaProducer,
  MessageSerializationFactory,
  PinoLogger
} from 'implementations-lib';
import { NotificationAggregate } from 'notifications-domain-lib';
import {
  MongoDbNotificationRepo,
  WebhookSenderAdapter
} from 'notifications-implementations-lib';
import { NotificationsCommandHandler } from './cmd-handler';

const MONGODB_URL = process.env['MONGODB_URL'] || 'mongodb://localhost:27018';
const KAFKA_URL = process.env['KAFKA_URL'] || 'localhost:9093';

export class NotificationsCommandHandlerService {
  private static repo: MongoDbNotificationRepo;
  private static msgProducer: KafkaProducer;
  private static msgConsumer: KafkaConsumer;
  private static commandHandler: NotificationsCommandHandler;

  static async start(): Promise<void> {
    const logger = new PinoLogger();
    this.repo = new MongoDbNotificationRepo(MONGODB_URL);
    await this.repo.init();

    const notificationSenderService = new WebhookSenderAdapter();

    const aggregate = new NotificationAggregate(
      this.repo,
      notificationSenderService,
      logger
    );

    const kafkaBuilder = new KafkaBuilder()
      .withBrokerList(KAFKA_URL)
      .withClientId(`NOTIFICATIONS_CMD_HANDLER_SVC_${crypto.randomUUID()}`)
      .withSerializerFactory(MessageSerializationFactory.instance())
      .withLogger(logger);

    this.msgProducer = kafkaBuilder.buildProducer({});

    await this.msgProducer.connect();

    this.msgConsumer = kafkaBuilder.buildConsumer({
      consumerGroupId: 'notifications-command-handler'
    });

    this.commandHandler = new NotificationsCommandHandler(
      this.msgConsumer,
      aggregate,
      logger
    );

    await this.commandHandler.start();
  }

  static async stop(): Promise<void> {
    await this.commandHandler.stop();
    await this.msgProducer.disconnect();
    await this.repo.destroy();
  }
}
