import { KafkaJS, TopicPartition } from '@confluentinc/kafka-javascript';
import {
  ILogger,
  IMessage,
  IMessageConsumer,
  IRawMessage,
  IRawMessageSerializerFactory
} from 'common-types-lib';
import { KafkaConsumerDefaults, KafkaConsumerOptions } from './types';
import { KafkaUtil } from './kafka-util';

export class KafkaConsumer implements IMessageConsumer {
  private readonly _logger: ILogger;
  private readonly _consumerOptions: KafkaConsumerOptions;
  private readonly _consumer: KafkaJS.Consumer;
  private readonly _serializerFactory: IRawMessageSerializerFactory;
  private _batchSize: number;
  private _topics: string[];

  private _handlerCallback: ((message: IRawMessage) => Promise<void>) | null;
  private _batchHandlerCallback:
    | ((messages: IMessage[]) => Promise<void>)
    | null;
  private _rebalanceCallback:
    | ((assignments: TopicPartition[]) => Promise<void>)
    | null;

  constructor(
    consumer: KafkaJS.Consumer,
    options: KafkaConsumerOptions,
    serializerFactory: IRawMessageSerializerFactory,
    logger: ILogger
  ) {
    this._logger = logger.child(this.constructor.name);
    this._serializerFactory = serializerFactory;
    this._consumerOptions = options;

    this._handlerCallback = null;
    this._batchHandlerCallback = null;
    this._rebalanceCallback = null;

    this._batchSize =
      this._consumerOptions.batchSize || KafkaConsumerDefaults.batchSize;
    this._topics = [];

    this._consumer = consumer;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setOnRebalanceFn(onRebalanceFn: () => Promise<void>): void {
    throw new Error('Method not implemented.');
  }

  // IMessageConsumer members
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async destroy(force: boolean): Promise<void> {
    this._logger?.info('RafikiKafkaProducer - destroy called...');
    return await this.disconnect();
  }

  async connect(): Promise<void> {
    await this._consumer.connect();
    // get metadata?

    this._logger?.info(`${this.constructor.name} - connected.`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async disconnect(force: boolean = false): Promise<void> {
    await this._consumer.disconnect();
    this._logger?.info(`${this.constructor.name} - disconnected.`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setCallbackFn(handlerCallback: (message: IMessage) => Promise<void>): void {
    throw new Error(
      'Method not implemented, must use setBatchCallbackFn() instead'
    );
  }

  setBatchCallbackFn(
    batchHandlerCallback: (messages: IMessage[]) => Promise<void>
  ): void {
    this._batchHandlerCallback = batchHandlerCallback;
  }

  setBatchSize(size: number): void {
    this._batchSize = size;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setFilteringFn(filterFn: (message: IMessage) => boolean): void {}

  setTopics(topics: string[]): void {
    this._topics = topics;
  }

  async start(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async startAndWaitForRebalance(): Promise<void> {
    await this._consumer.subscribe({ topics: this._topics });

    await this._consumer.run({
      eachBatch: async (batchPayload: KafkaJS.EachBatchPayload) => {
        // Shouldn't happen, for debug
        if (
          batchPayload.batch.isEmpty() ||
          batchPayload.batch.messages.length <= 0
        ) {
          return;
        }

        const msgs = batchPayload.batch.messages.map((m) =>
          this._serializerFactory.deserialize(
            KafkaUtil.convertFromKafkaMsg(
              m,
              batchPayload.batch.topic,
              batchPayload.batch.partition
            )
          )
        );

        // call the provided handler and then commit
        if (this._batchHandlerCallback) {
          await this._batchHandlerCallback(msgs);
        }

        if (this._consumerOptions.autoCommit === true) return;

        await this._consumer.commitOffsets(
          batchPayload.batch.messages.map((msg) => {
            return {
              topic: batchPayload.batch.topic,
              partition: batchPayload.batch.partition,
              offset: msg.offset.toString()
            };
          })
        );
      }
    });
  }

  async stop(): Promise<void> {
    this._consumer.paused();
  }
}
