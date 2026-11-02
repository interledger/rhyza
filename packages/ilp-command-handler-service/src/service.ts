import { ILogger, IMessageConsumer, IMessageProducer } from 'common-types-lib';
import {
  KafkaBuilder,
  MessageSerializationFactory,
  PinoLogger
} from 'implementations-lib';
import {
  IlpPeerAggregate,
  IPeer,
  IPeeringClient,
  IPeerRepository
} from 'ilp-domain-lib';
import {
  CachedPeerRepository,
  InMemoryPeerRepository,
  KafkaPeeringClient,
  createResolveStreamCredentials,
  createStreamServer,
  parseStreamServerSecret
} from 'ilp-implementations-lib';
import { IlpCommandHandler } from './cmd-handler';

const KAFKA_URL = process.env['KAFKA_URL'] || 'localhost:9093';
const MONGODB_URL = process.env['MONGODB_URL'] || 'mongodb://localhost:27017';
const REDIS_URL = process.env['REDIS_URL'];
const CONSUMER_GROUP_ID = 'ilp-command-handler';
const STREAM_SERVER_SECRET_RAW =
  process.env['STREAM_SERVER_SECRET'] ||
  Buffer.from('rhyza-dev-stream-secret-0001').toString('base64url');
const ILP_ADDRESS = process.env['ILP_ADDRESS'] || 'private.rhyza';

export class IlpCommandHandlerService {
  private static _logger: ILogger;
  private static _producer: IMessageProducer;
  private static _consumer: IMessageConsumer;
  private static _commandHandler: IlpCommandHandler;
  private static _peerRepo?: CachedPeerRepository;

  static async start(deps?: {
    logger?: ILogger;
    producer?: IMessageProducer;
    consumer?: IMessageConsumer;
    peeringClient?: IPeeringClient;
    peerRepo?: IPeerRepository;
    // Only used by tests / seeding InMemoryPeerRepository
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

    let peerRepo: IPeerRepository;
    if (deps?.peerRepo) {
      peerRepo = deps.peerRepo;
    } else if (deps?.seedPeers) {
      peerRepo = new InMemoryPeerRepository(deps.seedPeers);
    } else {
      this._peerRepo = await CachedPeerRepository.connect(
        MONGODB_URL,
        this._logger,
        REDIS_URL
      );
      peerRepo = this._peerRepo;
    }

    const peeringClient =
      deps?.peeringClient ??
      new KafkaPeeringClient(this._producer, this._logger);
    const serverSecret = parseStreamServerSecret(STREAM_SERVER_SECRET_RAW);
    const streamServer = createStreamServer({
      serverSecret,
      serverAddress: ILP_ADDRESS
    });
    const resolveStreamCredentials = createResolveStreamCredentials({
      streamServer,
      serverSecret,
      serverAddress: ILP_ADDRESS
    });
    const aggregate = new IlpPeerAggregate(
      peerRepo,
      peeringClient,
      resolveStreamCredentials,
      streamServer,
      ILP_ADDRESS
    );

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
    if (this._peerRepo) {
      await this._peerRepo.disconnect();
      this._peerRepo = undefined;
    }
  }
}
