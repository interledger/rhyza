import {
  Metadata,
  RdKafka,
  TopicPartition
} from '@confluentinc/kafka-javascript';
import {
  IMessageConsumer,
  ILogger,
  IRawMessageSerializerFactory,
  IMessage,
  ITelemetryService,
  ITelemetryHistogram,
  TELEMETRY_PROPS_CALL_NAME_PROP
} from 'common-types-lib';
import { KafkaConsumerOptions } from './types';
import { KafkaUtil } from './kafka-util';
import process from 'process';

const DEFAULT_BATCH_SIZE = 1;
const DEFAULT_BATCH_TIMEOUT_MS = 50;

const HISTOGRAM_NAME = 'KafkaLowLevelConsumer_histo';

export type messageHandlerCallback = (messages: IMessage[]) => Promise<void>;

export class KafkaLowLevelConsumer implements IMessageConsumer {
  private readonly _logger: ILogger | null;
  private readonly _consumer: RdKafka.KafkaConsumer;
  private readonly _serializerFactory: IRawMessageSerializerFactory;
  private readonly _globalConfig: RdKafka.ConsumerGlobalConfig = {};
  private readonly _telemetryService: ITelemetryService | null = null;
  private readonly _histogram: ITelemetryHistogram | null = null;

  private _topics: string[] = [];
  private _batchHandlerCallback: messageHandlerCallback | null = null;
  private _rebalanceCallback: (() => Promise<void>) | null = null;
  private _batchSize: number;
  private _batchTimeoutMs: number;
  private _consuming = false;
  private _stopConsumingRequested = false;

  constructor(
    globalConfigs: RdKafka.ConsumerGlobalConfig,
    consumerConfigs: KafkaConsumerOptions,
    serializerFactory: IRawMessageSerializerFactory,
    logger: ILogger | null = null,
    telemetryService: ITelemetryService | null = null
  ) {
    this._logger = logger ? logger.child(this.constructor.name) : null;
    this._telemetryService = telemetryService;
    this._globalConfig = globalConfigs;
    this._serializerFactory = serializerFactory;
    this._batchSize = consumerConfigs.batchSize ?? DEFAULT_BATCH_SIZE;
    this._batchTimeoutMs =
      consumerConfigs.batchTimeoutMs ?? DEFAULT_BATCH_TIMEOUT_MS;

    if (this._telemetryService) {
      this._histogram = this._telemetryService.getHistogram(HISTOGRAM_NAME);
    }

    this._consumer = new RdKafka.KafkaConsumer(
      {
        ...globalConfigs,
        'group.id': consumerConfigs.consumerGroupId,
        'enable.auto.commit': false, // we do it manually
        'fetch.wait.max.ms': this._batchTimeoutMs,
        // Increase this to 1 MB to increase batching for large batchTimeoutMs,
        // because for low batchTimeoutMs fetch.min.bytes is ignored
        'fetch.min.bytes': 1024 * 1024,
        rebalance_cb: true,
        event_cb: true
      },
      {
        'auto.offset.reset': consumerConfigs.autoOffsetReset ?? 'earliest'
      }
    );
    this._consumer.setDefaultConsumeTimeout(this._batchTimeoutMs);

    this._consumer.on('rebalance', this._onRebalance.bind(this));
    this._consumer.on('event.event', this._onEvent.bind(this));
    this._consumer.on('event.error', this._onError.bind(this));
    this._consumer.on('disconnected', this._onDisconnect.bind(this));
  }

  /* istanbul ignore next */
  private _onError(error: RdKafka.LibrdKafkaError): void {
    this._logger?.error(error.message, error);
  }

  /* istanbul ignore next */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _onEvent(eventData: any): void {
    this._logger?.debug(
      `KafkaLowLevelConsumer - event.event - ${JSON.stringify(eventData, null, 2)}`
    );
  }

  /* istanbul ignore next */
  private _onRebalance(
    error: RdKafka.LibrdKafkaError,
    assignments: TopicPartition[]
  ) {
    if (error && error.code != -175 && error.code !== -174) {
      // Ignore rebalance errors (other error codes), these will emit a dedicated the "rebalance.error"
      return;
    }

    // rdkafka library code emits the event as it receives it from the
    // cluster and before actually calling the assign() or unassign(),
    // only after this finishes the rebalance completes.
    // https://github.com/Blizzard/node-rdkafka/blob/aba2011d6c1ae2a0ae745b5d71bef77aa42180cc/lib/kafka-consumer.js#L59

    const type = error.code == -175 ? 'assign' : 'revoke';
    this._logger?.debug(
      `KafkaLowLevelConsumer - event.rebalance received - type: ${type}, assignment: ${JSON.stringify(assignments)}`
    );

    if (this._rebalanceCallback) {
      this._rebalanceCallback();
      this._logger?.debug(
        'KafkaLowLevelConsumer - subscribed callback call completed'
      );
    }
  }

  private _onDisconnect(metrics: RdKafka.ClientMetrics): void {
    /* istanbul ignore else */
    if (metrics?.connectionOpened) {
      this._logger?.info(
        `KafkaLowLevelConsumer - event.disconnected - connected for ${
          (Date.now() - metrics.connectionOpened) / 1000
        } secs`
      );
    } else {
      this._logger?.info(
        `KafkaLowLevelConsumer - event.disconnected - ${JSON.stringify(
          metrics,
          null,
          2
        )}`
      );
    }
  }

  private async _fetchBatch(): Promise<RdKafka.Message[]> {
    return new Promise((resolve, reject) => {
      this._consumer.consume(this._batchSize, (err, messages) => {
        if (err) {
          return reject(err);
        }
        resolve(messages);
      });
    });
  }

  private async _consumeLoop(): Promise<void> {
    if (!this._consumer.isConnected())
      throw new Error('Kafka consumer not connected');
    if (this._consuming) {
      this._logger?.warn(
        `${this.constructor.name} - consume loop already running, skipping`
      );
      return;
    }

    if (!this._batchHandlerCallback) {
      throw new Error(
        `${this.constructor.name} - batchHandlerCallback not set, cannot consume`
      );
    }

    this._consuming = true;
    this._logger?.info(
      `${this.constructor.name} - starting consume loop with batch size ${this._batchSize} and timeout ${this._batchTimeoutMs}ms...`
    );

    let cycleStartTs: bigint,
      beforeDeserializeTs: bigint,
      beforeHandlerTs: bigint,
      beforeCommitTs: bigint;
    let fetchBatchTookNs: number,
      deserializeTookNs: number,
      handlerTookNs: number,
      commitTookNs: number,
      cycleTookNs: number;
    let kafkaMessages: RdKafka.Message[] = [];
    let deserializedMessages: IMessage[] = [];

    while (this._consuming) {
      if (this._stopConsumingRequested) break;

      kafkaMessages.length = 0;
      cycleStartTs = process.hrtime.bigint();
      kafkaMessages = await this._fetchBatch();
      fetchBatchTookNs = Number(process.hrtime.bigint() - cycleStartTs);

      if (kafkaMessages.length <= 0) {
        continue;
      }

      // NOTE: we only measure when there are messages to process
      deserializedMessages.length = 0;

      beforeDeserializeTs = process.hrtime.bigint();
      deserializedMessages = kafkaMessages.map((msg) =>
        this._serializerFactory.deserialize(
          KafkaUtil.convertFromKafkaMsg(msg, msg.topic, msg.partition)
        )
      );
      deserializeTookNs = Number(process.hrtime.bigint() - beforeDeserializeTs);

      beforeHandlerTs = process.hrtime.bigint();
      await this._batchHandlerCallback(deserializedMessages);
      handlerTookNs = Number(process.hrtime.bigint() - beforeHandlerTs);

      // Commit offsets after successful processing
      beforeCommitTs = process.hrtime.bigint();
      this._consumer.commit();
      commitTookNs = Number(process.hrtime.bigint() - beforeCommitTs);

      cycleTookNs = Number(process.hrtime.bigint() - cycleStartTs);

      if (this._histogram) {
        this._histogram.observe(cycleTookNs, {
          [TELEMETRY_PROPS_CALL_NAME_PROP]: 'consumeCycle'
        });
        this._histogram.observe(fetchBatchTookNs, {
          [TELEMETRY_PROPS_CALL_NAME_PROP]: 'fetchBatch'
        });
        this._histogram.observe(deserializeTookNs, {
          [TELEMETRY_PROPS_CALL_NAME_PROP]: 'deserialize'
        });
        this._histogram.observe(handlerTookNs, {
          [TELEMETRY_PROPS_CALL_NAME_PROP]: 'handler'
        });
        this._histogram.observe(commitTookNs, {
          [TELEMETRY_PROPS_CALL_NAME_PROP]: 'commit'
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      this._logger?.isDebugEnabled() &&
        this._logger?.debug(
          `Consume cycle took:  ${Math.round(cycleTookNs / 1e6)}ms - parts: ${Math.round(fetchBatchTookNs / 1e6)}ms / ${Math.round(deserializeTookNs / 1e6)}ms / ${Math.round(handlerTookNs / 1e6)}ms / ${Math.round(commitTookNs / 1e6)}ms (fetch/deserialization/handler/commit)`
        );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setCallbackFn(handlerCallback: (message: IMessage) => Promise<void>): void {
    throw new Error('setCallbackFn is not supported for KafkaLowLevelConsumer');
  }

  setOnRebalanceFn(onRebalanceFn: () => Promise<void>): void {
    this._rebalanceCallback = onRebalanceFn;
  }

  setBatchCallbackFn(
    batchHandlerCallback: (messages: IMessage[]) => Promise<void>
  ): void {
    this._batchHandlerCallback = batchHandlerCallback;
  }

  setTopics(topics: string[]): void {
    this._topics = topics;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async destroy(force: boolean): Promise<void> {
    this._logger?.info('RafikiKafkaProducer - destroy called...');
    return await this.disconnect();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._consumer.connect(
        {},
        async (err: RdKafka.LibrdKafkaError, metadata: RdKafka.Metadata) => {
          /* istanbul ignore if */
          if (err) {
            this._logger?.error(
              'KafkaLowLevelConsumer - error connecting to cluster',
              err
            );
            return reject(
              new Error(
                `KafkaLowLevelConsumer - error connecting to cluster: ${err.message}`
              )
            );
          }

          if (!this._topics.length) {
            throw new Error('No topics specified for Kafka consumer');
          }

          // throw if topics not found in metadata
          this._topics.forEach((topicName) => {
            this._logger?.debug(
              `KafkaLowLevelConsumer - checking if topic '${topicName}' exists in kafka...`,
              metadata
            );
            const found = metadata.topics.find(
              (value) => value.name.toUpperCase() === topicName.toUpperCase()
            );
            if (!found) {
              throw new Error(
                `Topic ${topicName} not found in kafka, cannot continue`
              );
            }
          });

          // metadata is handled by the onReady event
          this._logger?.info('KafkaLowLevelConsumer - connected!');
          resolve();
        }
      );
    });
  }

  async disconnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._logger?.info('KafkaLowLevelConsumer - disconnect called...');
      if (!this._consumer.isConnected()) {
        this._logger?.warn(
          'KafkaLowLevelConsumer - disconnect called but consumer is not connected'
        );
        return resolve();
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unused-vars
      this._consumer.disconnect((err: any, data: RdKafka.ClientMetrics) => {
        /* istanbul ignore if */
        if (err) {
          this._logger?.error('KafkaLowLevelConsumer - disconnect failed', err);
          return reject(err);
        }
        this._logger?.info('KafkaLowLevelConsumer - disconnected.');
        resolve();
      });
    });
  }

  startAndWaitForRebalance(): Promise<void> {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      this._consumer.prependOnceListener(
        'rebalance',
        (error: RdKafka.LibrdKafkaError, assignments: TopicPartition[]) => {
          if (
            error.code != RdKafka.CODES.ERRORS.ERR__ASSIGN_PARTITIONS ||
            !assignments ||
            assignments.length == 0
          ) {
            throw new Error(
              'KafkaLowLevelConsumer - didnt get an assign on first rebalance event (startAndWaitForRebalance)'
            );
          }

          this._logger?.info(
            'KafkaLowLevelConsumer - got rebalance on startAndWaitForRebalance()'
          );
          setImmediate(() => {
            this._consumeLoop();
          });
          resolve();
        }
      );

      // manually reject (so we don't lose this because of the async executor function
      await this.start().catch((reason) => reject(reason));
    });
  }

  start(): Promise<void> {
    // reset flag
    this._stopConsumingRequested = false;
    return new Promise((resolve) => {
      if (!Array.isArray(this._topics) || this._topics.length == 0) {
        this._logger?.warn(
          'KafkaLowLevelConsumer - no topics subscribed on start()'
        );
        resolve();
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      this._consumer.prependOnceListener('subscribed', async (topics) => {
        this._logger?.info('KafkaLowLevelConsumer - subscribed');
        setImmediate(() => {
          this._consumeLoop();
        });
        resolve();
      });

      this._logger?.info(
        `KafkaLowLevelConsumer - Subscribing to topics ${JSON.stringify(this._topics)}`
      );
      this._consumer.subscribe(this._topics);
    });
  }

  async stop(): Promise<void> {
    this._stopConsumingRequested = true;
    this._consumer.unsubscribe();
    this._logger?.info(
      'KafkaLowLevelConsumer - stop called, unsubscribed from previously subscribed topics'
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setFilteringFn(filterFn: (message: IMessage) => boolean): void {
    throw new Error('Method not implemented.');
  }

  setBatchSize(size: number): void {
    this._batchSize = size;
  }

  private async _getMetadata(): Promise<RdKafka.Metadata> {
    return new Promise<RdKafka.Metadata>((resolve, reject) => {
      this._consumer.getMetadata(
        { allTopics: true },
        (err: RdKafka.LibrdKafkaError, data: Metadata) => {
          if (err) {
            this._logger?.error(
              `KafkaLowLevelConsumer - error requesting metadata from RdKaf client - error-no: ${err.errno} message: ${err.message}`,
              err
            );
            return reject(err);
          }
          return resolve(data);
        }
      );
    });
  }
}
