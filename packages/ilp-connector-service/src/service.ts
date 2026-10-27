import { Redis } from 'ioredis';
import {
  CommandTopics,
  DomainEventTopics,
  ILogger,
  IMessageConsumer,
  IMessageProducer
} from 'common-types-lib';
import {
  KafkaBuilder,
  MessageSerializationFactory,
  PinoLogger
} from 'implementations-lib';
import { InMemoryTransportCorrelationStore } from './correlation/in-memory-store';
import { RedisTransportCorrelationStore } from './correlation/redis-store';
import { ITransportCorrelationStore } from './correlation/store';
import { IlpConnector } from './connector';
import { HttpConnectorTransport } from './http-connector-transport';
import { OutboundExpiryWorker } from './outbound-expiry-worker';
import { PeerDirectory } from './peer-directory';
import { IConnectorTransport } from './transport';

const KAFKA_URL = process.env['KAFKA_URL'] || 'localhost:9093';
const CONNECTOR_COMMANDS_GROUP_ID = 'ilp-connector';
const DEFAULT_HTTP_PORT = 4000;
const DEFAULT_OUTBOUND_EXPIRY_POLL_MS = 250;
const HTTP_PORT = process.env['ILP_CONNECTOR_HTTP_PORT']
  ? Number.parseInt(process.env['ILP_CONNECTOR_HTTP_PORT'], 10)
  : DEFAULT_HTTP_PORT;
const HTTP_PATH = process.env['ILP_CONNECTOR_HTTP_PATH'] || '/ilp';
const PUBLIC_BASE_URL =
  process.env['ILP_CONNECTOR_PUBLIC_URL'] || `http://localhost:${HTTP_PORT}`;
const REDIS_URL = process.env['REDIS_URL'];
const ILP_ADDRESS = process.env['ILP_ADDRESS'] || 'private.rhyza';
const OUTBOUND_EXPIRY_POLL_MS = process.env[
  'ILP_CONNECTOR_OUTBOUND_EXPIRY_POLL_MS'
]
  ? Number.parseInt(process.env['ILP_CONNECTOR_OUTBOUND_EXPIRY_POLL_MS'], 10)
  : DEFAULT_OUTBOUND_EXPIRY_POLL_MS;

export class IlpConnectorService {
  private static _logger: ILogger;
  private static _producer: IMessageProducer;
  private static _consumer: IMessageConsumer;
  private static _directoryConsumer: IMessageConsumer;
  private static _connector: IlpConnector;
  private static _transport: IConnectorTransport;
  private static _directory: PeerDirectory;
  private static _correlationStore: ITransportCorrelationStore;
  private static _outboundExpiryWorker?: OutboundExpiryWorker;
  private static _redis?: Redis;

  static async start(deps?: {
    logger?: ILogger;
    producer?: IMessageProducer;
    consumer?: IMessageConsumer;
    directoryConsumer?: IMessageConsumer;
    transport?: IConnectorTransport;
    directory?: PeerDirectory;
    correlationStore?: ITransportCorrelationStore;
    outboundExpiryWorker?: OutboundExpiryWorker;
  }): Promise<void> {
    this._logger = deps?.logger ?? new PinoLogger();
    this._logger.info('Starting IlpConnectorService...');

    let producer = deps?.producer;
    let consumer = deps?.consumer;
    let directoryConsumer = deps?.directoryConsumer;

    if (!producer || !consumer || !directoryConsumer) {
      const kafkaBuilder = new KafkaBuilder()
        .withBrokerList(KAFKA_URL)
        .withClientId(`ILP_CONNECTOR_SVC_${crypto.randomUUID()}`)
        .withSerializerFactory(MessageSerializationFactory.instance())
        .withLogger(this._logger);

      producer = producer ?? kafkaBuilder.buildProducer({});
      consumer =
        consumer ??
        kafkaBuilder.buildConsumer({
          consumerGroupId: CONNECTOR_COMMANDS_GROUP_ID
        });
      // Peer directory is an address book, not a work queue: each replica needs
      // the full peer set. A unique consumer group + earliest replay rebuilds
      // that view on every start. Sharing CONNECTOR_COMMANDS_GROUP_ID here
      // would partition events across replicas and leave each half-blind.
      directoryConsumer =
        directoryConsumer ??
        kafkaBuilder.buildConsumer({ autoOffsetReset: 'earliest' });
    }
    this._producer = producer;
    this._consumer = consumer;
    this._directoryConsumer = directoryConsumer;

    this._correlationStore =
      deps?.correlationStore ?? (await this._buildCorrelationStore());
    this._directory = deps?.directory ?? new PeerDirectory();
    this._transport =
      deps?.transport ??
      new HttpConnectorTransport({
        directory: this._directory,
        port: HTTP_PORT,
        publicBaseUrl: PUBLIC_BASE_URL,
        path: HTTP_PATH,
        logger: this._logger,
        ilpAddress: ILP_ADDRESS
      });
    await this._transport.start?.();

    this._connector = new IlpConnector(
      this._producer,
      this._transport,
      this._correlationStore,
      this._logger,
      ILP_ADDRESS
    );
    this._connector.init();

    this._outboundExpiryWorker =
      deps?.outboundExpiryWorker ??
      new OutboundExpiryWorker(
        this._connector,
        OUTBOUND_EXPIRY_POLL_MS,
        this._logger
      );
    this._outboundExpiryWorker.start();

    await this._producer.connect();

    this._consumer.setTopics([CommandTopics.IlpConnectorCommands]);
    this._consumer.setBatchCallbackFn((messages) =>
      this._connector.handleConnectorCommands(messages)
    );
    await this._consumer.connect();
    await this._consumer.startAndWaitForRebalance();

    this._directoryConsumer.setTopics([DomainEventTopics.IlpEvents]);
    this._directoryConsumer.setBatchCallbackFn(async (messages) => {
      for (const message of messages) {
        this._directory.upsertFromEvent(message);
      }
    });
    await this._directoryConsumer.connect();
    await this._directoryConsumer.startAndWaitForRebalance();

    this._logger.info(
      'IlpConnectorService ready to receive connector commands'
    );
  }

  static async stop(): Promise<void> {
    this._outboundExpiryWorker?.stop();
    this._outboundExpiryWorker = undefined;
    if (this._consumer) {
      await this._consumer.stop();
      await this._consumer.disconnect(true);
    }
    if (this._directoryConsumer) {
      await this._directoryConsumer.stop();
      await this._directoryConsumer.disconnect(true);
    }
    if (this._producer) {
      await this._producer.disconnect();
    }
    await this._transport?.stop?.();
    if (this._redis) {
      await this._redis.quit();
      this._redis = undefined;
    }
  }

  private static async _buildCorrelationStore(): Promise<ITransportCorrelationStore> {
    if (!REDIS_URL) {
      this._logger.info(
        'REDIS_URL not set; using in-memory transport correlation store'
      );
      return new InMemoryTransportCorrelationStore();
    }

    this._redis = new Redis(REDIS_URL, { lazyConnect: true });
    await this._redis.connect();
    this._logger.info('Using Redis transport correlation store');
    return new RedisTransportCorrelationStore(this._redis);
  }
}
