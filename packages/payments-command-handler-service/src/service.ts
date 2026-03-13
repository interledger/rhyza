import {
  RafikiKafkaJsonProducer,
  RafikiKafkaJsonConsumer
} from 'implementations-lib';
import {
  MongoDbPaymentIntentRepo,
  PalWalletAddressAdapter
} from 'payments-implementations-lib';
import { PaymentIntentAggregate } from 'payments-domain-lib';
import { PalClient } from 'pal-client-lib';
import { PaymentsCommandHandler } from './cmd-handler';
import process from 'process';

const KAFKA_URL = process.env['KAFKA_URL'] || 'localhost:9092';
const MONGODB_URL = process.env['MONGODB_URL'] || 'mongodb://localhost:27017';
const PAL_GRPC_URL = process.env['PAL_GRPC_URL'] || 'localhost:50051';
const CONSUMER_BATCH_SIZE =
  (process.env['CONSUMER_BATCH_SIZE'] &&
    parseInt(process.env['CONSUMER_BATCH_SIZE'])) ||
  250;
const CONSUMER_BATCH_TIMEOUT_MS =
  (process.env['CONSUMER_BATCH_TIMEOUT_MS'] &&
    parseInt(process.env['CONSUMER_BATCH_TIMEOUT_MS'])) ||
  50;

export class PaymentsCommandHandlerService {
  private static commandHandler: PaymentsCommandHandler;
  private static msgProducer: RafikiKafkaJsonProducer;
  private static msgConsumer: RafikiKafkaJsonConsumer;
  private static repo: MongoDbPaymentIntentRepo;

  static async start(): Promise<void> {
    this.repo = new MongoDbPaymentIntentRepo(MONGODB_URL);
    await this.repo.init();

    const palClient = new PalClient(PAL_GRPC_URL);
    const walletAddressAdapter = new PalWalletAddressAdapter(palClient);

    const aggregate = new PaymentIntentAggregate(
      this.repo,
      walletAddressAdapter
    );

    this.msgProducer = new RafikiKafkaJsonProducer({
      kafkaBrokerList: KAFKA_URL,
      producerClientId: `payments-cmd-handler-${crypto.randomUUID()}`
    });
    await this.msgProducer.connect();

    this.msgConsumer = new RafikiKafkaJsonConsumer({
      kafkaBrokerList: KAFKA_URL,
      kafkaGroupId: 'payments-cmd-handler',
      batchSize: CONSUMER_BATCH_SIZE,
      batchTimeoutMs: CONSUMER_BATCH_TIMEOUT_MS
    });

    this.commandHandler = new PaymentsCommandHandler(
      this.msgConsumer,
      this.msgProducer,
      aggregate
    );
    await this.commandHandler.start();
  }

  static async stop(): Promise<void> {
    await this.commandHandler.stop();
    await this.msgProducer.disconnect();
    await this.repo.destroy();
  }
}
