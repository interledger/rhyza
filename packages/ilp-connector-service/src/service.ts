import {
  CommandTopics,
  ILogger,
  IMessage,
  IMessageConsumer,
  IMessageProducer
} from 'common-types-lib';
import {
  KafkaBuilder,
  MessageSerializationFactory,
  PinoLogger
} from 'implementations-lib';
import { IlpConnector } from './connector';
import { LoopbackConnectorTransport } from '../test/loopback-transport';
import { IConnectorTransport } from './transport';

const KAFKA_URL = process.env['KAFKA_URL'] || 'localhost:9093';
const CONSUMER_GROUP_ID = 'ilp-connector';

export class IlpConnectorService {
  private static _logger: ILogger;
  private static _producer: IMessageProducer;
  private static _consumer: IMessageConsumer;
  private static _connector: IlpConnector;

  static async start(deps?: {
    logger?: ILogger;
    producer?: IMessageProducer;
    consumer?: IMessageConsumer;
    transport?: IConnectorTransport;
  }): Promise<void> {
    this._logger = deps?.logger ?? new PinoLogger();
    this._logger.info('Starting IlpConnectorService...');

    let producer = deps?.producer;
    let consumer = deps?.consumer;

    if (!producer || !consumer) {
      const kafkaBuilder = new KafkaBuilder()
        .withBrokerList(KAFKA_URL)
        .withClientId(`ILP_CONNECTOR_SVC_${crypto.randomUUID()}`)
        .withSerializerFactory(MessageSerializationFactory.instance())
        .withLogger(this._logger);

      producer = producer ?? kafkaBuilder.buildProducer({});
      consumer =
        consumer ??
        kafkaBuilder.buildConsumer({ consumerGroupId: CONSUMER_GROUP_ID });
    }
    this._producer = producer;
    this._consumer = consumer;

    const transport = deps?.transport ?? new LoopbackConnectorTransport();

    this._connector = new IlpConnector(this._producer, transport, this._logger);
    this._connector.init();

    await this._producer.connect();

    this._consumer.setTopics([CommandTopics.IlpConnectorCommands]);
    this._consumer.setBatchCallbackFn(async (messages: IMessage[]) => {
      await this._connector.handleConnectorCommands(messages);
    });
    await this._consumer.connect();
    await this._consumer.startAndWaitForRebalance();

    this._logger.info(
      'IlpConnectorService ready to receive connector commands'
    );
  }

  static async stop(): Promise<void> {
    if (this._consumer) {
      await this._consumer.stop();
      await this._consumer.disconnect(true);
    }
    if (this._producer) {
      await this._producer.disconnect();
    }
  }
}
