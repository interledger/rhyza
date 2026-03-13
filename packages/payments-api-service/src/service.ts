import { PaymentsServiceServer } from './grpc/grpc-service';
import {
  RafikiKafkaJsonProducer,
  RafikiKafkaJsonConsumer
} from 'implementations-lib';
import { EventTopics } from 'common-types-lib';
import process from 'process';

const KAFKA_URL = process.env['KAFKA_URL'] || 'localhost:9092';

export class PaymentsApiService {
  private static grpcService: PaymentsServiceServer;
  private static msgProducer: RafikiKafkaJsonProducer;
  private static msgConsumer: RafikiKafkaJsonConsumer;

  static async start(): Promise<void> {
    this.msgProducer = new RafikiKafkaJsonProducer({
      kafkaBrokerList: KAFKA_URL,
      producerClientId: `payments-api-service-${crypto.randomUUID()}`
    });
    await this.msgProducer.connect();

    this.msgConsumer = new RafikiKafkaJsonConsumer({
      kafkaBrokerList: KAFKA_URL,
      kafkaGroupId: `payments-api-service`
    });
    this.msgConsumer.setTopics([EventTopics.PaymentEvents]);
    await this.msgConsumer.connect();
    await this.msgConsumer.startAndWaitForRebalance();

    this.grpcService = new PaymentsServiceServer(
      '1',
      '0.0.0.0:50052',
      this.msgProducer,
      this.msgConsumer
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
