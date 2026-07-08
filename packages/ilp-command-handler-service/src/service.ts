import { ILogger, IMessageConsumer, IMessageProducer } from 'common-types-lib';
import {
  KafkaBuilder,
  MessageSerializationFactory,
  PinoLogger
} from 'implementations-lib';
import { IlpPeerAggregate, IPeer, IPeeringClient } from 'ilp-domain-lib';
import {
  InMemoryPeerRepository,
  KafkaPeeringClient
} from 'ilp-implementations-lib';
import { IlpCommandHandler } from './cmd-handler';

const KAFKA_URL = process.env['KAFKA_URL'] || 'localhost:9093';
const CONSUMER_GROUP_ID = 'ilp-command-handler';

export class IlpCommandHandlerService {
  private static _logger: ILogger;
  private static _producer: IMessageProducer;
  private static _consumer: IMessageConsumer;
  private static _commandHandler: IlpCommandHandler;

  static async start(deps?: {
    logger?: ILogger;
    producer?: IMessageProducer;
    consumer?: IMessageConsumer;
    peeringClient?: IPeeringClient;
    seedPeers?: IPeer[];
  }): Promise<void> {
    this._logger = deps?.logger ?? new PinoLogger();
    this._logger.info('Starting IlpCommandHandlerService...');

    let producer = deps?.producer;
    let consumer = deps?.consumer;

    if (!producer || !consumer) {
      const kafkaBuilder = new KafkaBuilder()
        .withBrokerList(KAFKA_URL)
        .withClientId(`ILP_CMD_HANDLER_SVC_${crypto.randomUUID()}`)
        .withSerializerFactory(MessageSerializationFactory.instance())
        .withLogger(this._logger);

      producer = producer ?? kafkaBuilder.buildProducer({});
      consumer =
        consumer ??
        kafkaBuilder.buildConsumer({ consumerGroupId: CONSUMER_GROUP_ID });
    }
    this._producer = producer;
    this._consumer = consumer;

    await this._producer.connect();

    const peerRepo = new InMemoryPeerRepository(deps?.seedPeers);
    const peeringClient =
      deps?.peeringClient ??
      new KafkaPeeringClient(this._producer, this._logger);
    const aggregate = new IlpPeerAggregate(peerRepo, peeringClient);

    this._commandHandler = new IlpCommandHandler(
      this._consumer,
      this._producer,
      aggregate,
      this._logger
    );
    await this._commandHandler.start();

    this._logger.info('IlpCommandHandlerService ready to receive commands');
  }

  static async stop(): Promise<void> {
    if (this._commandHandler) {
      await this._commandHandler.stop();
    }
    if (this._producer) {
      await this._producer.disconnect();
    }
  }
}
