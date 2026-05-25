import {
  KafkaBuilder,
  KafkaConsumer,
  KafkaProducer,
  PinoLogger,
  MessageSerializationFactory
} from 'implementations-lib';
import { PaymentsEventHandler } from './event-handler';
import process from 'process';
import crypto from 'crypto';

const INSTANCE_ID = `PAYMENTS_EVENT_HANDLER_SVC_${crypto.randomUUID()}`;
const KAFKA_URL = process.env['KAFKA_URL'] || 'localhost:9092';

export class PaymentsEventHandlerService {
  private static eventHandler: PaymentsEventHandler;
  private static msgProducer: KafkaProducer;
  private static msgConsumer: KafkaConsumer;

  static async start(): Promise<void> {
    const logger = new PinoLogger();

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
  }

  static async stop(): Promise<void> {
    await this.eventHandler.stop();
    await this.msgProducer.disconnect();
  }
}
