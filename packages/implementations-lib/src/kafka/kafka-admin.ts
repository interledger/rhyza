import { KafkaJS } from '@confluentinc/kafka-javascript';
import { ILogger } from 'common-types-lib';
import { IKafkaAdmin } from './types';
import { AdminConstructorConfig } from '@confluentinc/kafka-javascript/types/kafkajs';
import { KafkaLoggerWrapper } from './kafka-logger-wrapper';

const DEFAULT_TIMEOUT_MS = 10000;

export class KafkaAdmin implements IKafkaAdmin {
  private readonly _logger: ILogger;
  private readonly _admin: KafkaJS.Admin;

  constructor(kafka: KafkaJS.Kafka, logger: ILogger) {
    this._logger = logger.child(this.constructor.name);
    const loggerWrapper = new KafkaLoggerWrapper(this._logger);

    const config: AdminConstructorConfig = {
      kafkaJS: { logger: loggerWrapper }
    };

    this._admin = kafka.admin(config);
  }

  async connect(): Promise<void> {
    this._logger?.debug('RafikiKafkaAdmin - connect called...');
    await this._admin.connect();
    this._logger?.info('RafikiKafkaAdmin - connected');
  }

  async disconnect(): Promise<void> {
    this._logger?.debug('RafikiKafkaAdmin - disconnect called...');
    await this._admin.disconnect();
    this._logger?.info('RafikiKafkaAdmin - disconnected');
  }

  async createTopics(
    topics: {
      topic: string;
      numPartitions: number;
      replicationFactor: number;
    }[]
  ): Promise<void> {
    await this._admin.createTopics({
      timeout: DEFAULT_TIMEOUT_MS,
      topics: topics
    });
  }

  // async deleteTopics(
  //   topics: {
  //     topic: string;
  //     numPartitions: number;
  //     replicationFactor: number;
  //   }[]
  // ): Promise<void> {
  //   await this._admin.deleteTopicRecords({
  //     timeout: DEFAULT_TIMEOUT_MS,
  //     topics: topics
  //   });
  // }

  async hasAllTopics(topics: string[]): Promise<boolean> {
    const existingTopics = await this._admin.listTopics();
    return topics.every((topic) => existingTopics.includes(topic));
  }
}
