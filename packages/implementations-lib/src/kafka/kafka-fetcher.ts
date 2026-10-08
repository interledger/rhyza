import { KafkaJS } from '@confluentinc/kafka-javascript';
import {
  ILogger,
  IMessage,
  IMessageFetcher,
  IRawMessage,
  IRawMessageSerializerFactory
} from 'common-types-lib';
import { randomBytes } from 'node:crypto';
import { KafkaLoggerWrapper } from './kafka-logger-wrapper';
import { AdminConstructorConfig } from '@confluentinc/kafka-javascript/types/kafkajs';

const DEFAULT_BATCH_SIZE = 25000;
const DEFAULT_BATCH_TIMEOUT_MS = 500;

export class KafkaFetcher implements IMessageFetcher {
  private readonly _logger: ILogger | null;
  private readonly _kafka: KafkaJS.Kafka;
  private readonly _consumerIdPrefix: string;
  private readonly _serializerFactory: IRawMessageSerializerFactory;
  private readonly _loggerWrapper: KafkaLoggerWrapper | null;

  constructor(
    kafka: KafkaJS.Kafka,
    serializerFactory: IRawMessageSerializerFactory,
    consumerIdPrefix: string | null,
    logger: ILogger | null = null
  ) {
    this._logger = logger ? logger.child(this.constructor.name) : null;
    this._kafka = kafka;
    this._serializerFactory = serializerFactory;

    // make sure the consumer group id is random
    this._consumerIdPrefix =
      consumerIdPrefix || `${this.constructor.name}_${crypto.randomUUID()}`;

    this._loggerWrapper = null;
    if (this._logger) {
      this._loggerWrapper = new KafkaLoggerWrapper(this._logger);
    }
  }

  private _formatMessage(
    kafkaMsg: KafkaJS.KafkaMessage,
    topic: string,
    partition: number
  ): IMessage {
    const retMsg: IRawMessage = {
      topic: topic,
      partition: partition,
      offset: Number(kafkaMsg.offset),
      key: kafkaMsg.key ? kafkaMsg.key.toString() : null,
      timestamp: Number(kafkaMsg.timestamp),
      value: kafkaMsg.value || null,
      headers: null
    };

    // parse headers
    if (kafkaMsg.headers != null && Object.keys(kafkaMsg.headers).length > 0) {
      retMsg.headers = [];
      for (const k of Object.keys(kafkaMsg.headers)) {
        if (kafkaMsg.headers[k] != null) {
          retMsg.headers.push({ [k]: kafkaMsg.headers[k].toString() });
        }
      }
    }

    return this._serializerFactory.deserialize(retMsg);
  }

  private async _fetch(
    topic: string,
    msgKey: string,
    partitionAndOffset?: { partition: number; offset: number }
  ): Promise<IMessage[]> {
    const config: AdminConstructorConfig = {};
    if (this._loggerWrapper) {
      if (config.kafkaJS) {
        config.kafkaJS.logger = this._loggerWrapper;
      } else {
        config.kafkaJS = { logger: this._loggerWrapper };
      }
    }

    const admin = this._kafka.admin(config);
    await admin.connect();

    // from the topic offsets, get the partitions that have messages
    const topicOffsets = await admin.fetchTopicOffsets(topic);
    let partitionsReading = topicOffsets
      .filter((t) => {
        return (
          t.low != t.high &&
          (!partitionAndOffset ||
            t.partition === partitionAndOffset.partition) &&
          (!partitionAndOffset || Number(t.offset) > partitionAndOffset.offset)
        );
      })
      .map((t) => {
        return { partition: t.partition, high: t.high };
      });

    if (partitionsReading.length === 0) {
      return [];
    }

    const consumer = this._kafka.consumer({
      kafkaJS: {
        groupId: `${this._consumerIdPrefix}-${randomBytes(3).toString('hex')}`,
        fromBeginning: true,
        partitionAssigners: [KafkaJS.PartitionAssigners.roundRobin],
        autoCommit: false,
        logger: this._loggerWrapper || undefined
      },
      'js.consumer.max.batch.size': DEFAULT_BATCH_SIZE,
      'fetch.wait.max.ms': DEFAULT_BATCH_TIMEOUT_MS
    });
    await consumer.connect();
    await consumer.subscribe({ topic: topic });

    if (partitionAndOffset) {
      consumer.seek({
        topic: topic,
        partition: partitionAndOffset.partition,
        offset: partitionAndOffset.offset.toString()
      });
    }

    let msgsRead = 0;

    return new Promise((resolve) => {
      const retMsgs: IMessage[] = [];

      const checkIfMoreMsgsOrExit = (
        partition: number,
        lastMsgOffset: number
      ) => {
        const offset = topicOffsets.find((o) => o.partition === partition);
        if (offset && Number(offset.high) === lastMsgOffset + 1) {
          partitionsReading = partitionsReading.filter(
            (p) => p.partition !== partition
          );
          if (partitionsReading.length > 0) return;

          consumer.disconnect().then(() => {
            this._logger?.debug(
              `Fetched ${msgsRead} messages from topic ${topic} partition ${partitionAndOffset?.partition || 0} first offset ${partitionAndOffset?.offset || 0} last offset ${lastMsgOffset}`
            );
            return resolve(retMsgs);
          });
        }
      };

      consumer.run({
        eachBatch: async (batchPayload: KafkaJS.EachBatchPayload) => {
          //this._logger?.debug(`Got batch with ${batchPayload.batch.messages.length} messages from topic ${batchPayload.batch.topic} partition ${batchPayload.batch.partition} first offset ${batchPayload.batch.firstOffset()} last offset ${batchPayload.batch.lastOffset()}`);
          for (const kafkaMsg of batchPayload.batch.messages) {
            const msg = this._formatMessage(
              kafkaMsg,
              batchPayload.batch.topic,
              batchPayload.batch.partition
            );
            if (msg.msgKey === msgKey) {
              retMsgs.push(msg);
            }

            msgsRead++;
            checkIfMoreMsgsOrExit(
              batchPayload.batch.partition,
              Number(kafkaMsg.offset)
            );
          }
        }
      });
    });
  }

  async fetchLast(
    msgKey: string,
    topic: string,
    partitionAndOffset?: { partition: number; offset: number }
  ): Promise<IMessage | null> {
    const msgs = await this._fetch(topic, msgKey, partitionAndOffset);
    return msgs?.[msgs.length - 1] || null;
  }
  async fetchAll(
    msgKey: string,
    topic: string,
    partitionAndOffset?: { partition: number; offset: number }
  ): Promise<IMessage[]> {
    const msgs = await this._fetch(topic, msgKey, partitionAndOffset);
    return msgs;
  }
}
