import { NotificationsEventHandler } from './event-handler';
import {
  KafkaBuilder,
  KafkaConsumer,
  KafkaProducer,
  MessageSerializationFactory,
  PinoLogger
} from 'implementations-lib';

const KAFKA_URL = process.env.KAFKA_URL || 'localhost:9093';

export class NotificationsEventHandlerService {
  private static eventHandler: NotificationsEventHandler;
  private static msgProducer: KafkaProducer;
  private static msgConsumer: KafkaConsumer;

  static async start(): Promise<void> {
    const kafkaBuilder = new KafkaBuilder();
    kafkaBuilder
      .withBrokerList(KAFKA_URL)
      .withClientId(`NOTIFICATIONS_EVENT_HANDLER_SVC_${crypto.randomUUID()}`)
      .withSerializerFactory(MessageSerializationFactory.instance())
      .withLogger(new PinoLogger());

    this.msgProducer = kafkaBuilder.buildProducer({});
    await this.msgProducer.connect();

    this.msgConsumer = kafkaBuilder.buildConsumer({
      consumerGroupId: 'notifications-event-handler'
    });

    this.eventHandler = new NotificationsEventHandler(
      this.msgConsumer,
      this.msgProducer
    );

    await this.eventHandler.start();
  }

  static async stop(): Promise<void> {
    await this.eventHandler.stop();
    await this.msgProducer.disconnect();
  }
}
