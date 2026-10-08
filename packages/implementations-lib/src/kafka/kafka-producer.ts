import { KafkaJS } from '@confluentinc/kafka-javascript';
import {
  ILogger,
  IMessage,
  IMessageProducer,
  IMessageProducerAcks,
  IRawMessageSerializerFactory,
  ITelemetryHistogram,
  ITelemetryService,
  TELEMETRY_PROPS_CALL_NAME_PROP
} from 'common-types-lib';
import { KafkaUtil } from './kafka-util';
import process from 'process';

const HISTOGRAM_NAME = 'KafkaProducer_histo';

export class KafkaProducer implements IMessageProducer {
  private readonly _logger: ILogger;
  private readonly _producer: KafkaJS.Producer;
  private readonly _serializerFactory: IRawMessageSerializerFactory;
  private readonly _telemetryService: ITelemetryService | null = null;
  private _histogram: ITelemetryHistogram | null = null;

  constructor(
    producer: KafkaJS.Producer,
    serializerFactory: IRawMessageSerializerFactory,
    logger: ILogger,
    telemetryService: ITelemetryService | null = null
  ) {
    this._logger = logger.child(this.constructor.name);
    this._telemetryService = telemetryService;
    this._serializerFactory = serializerFactory;

    this._producer = producer;

    if (this._telemetryService) {
      this._histogram = this._telemetryService.getHistogram(HISTOGRAM_NAME);
    }
  }

  private _convertIMessageArrayToTopicMessages(
    messages: IMessage | IMessage[]
  ): KafkaJS.TopicMessages[] {
    if (!Array.isArray(messages)) messages = [messages];

    const retTopicMessages: KafkaJS.TopicMessages[] = [];

    for (const msg of messages) {
      const topicMsg = KafkaUtil.convertToKafkaMsg(
        this._serializerFactory.serialize(msg)
      );
      let topic = retTopicMessages.find((tp) => tp.topic === msg.msgTopic);
      if (!topic) {
        topic = { topic: msg.msgTopic, messages: [topicMsg] };
        retTopicMessages.push(topic);
      } else {
        topic.messages.push(topicMsg);
      }
    }

    return retTopicMessages;
  }

  async sendWithoutAcks(message: IMessage | IMessage[]): Promise<void> {
    const startTs = process.hrtime.bigint();
    const topicMessages = this._convertIMessageArrayToTopicMessages(message);
    const convertTookNs = Number(process.hrtime.bigint() - startTs);

    // we're ignoring the promise on purpose
    this._producer.sendBatch({ topicMessages }).catch((e) => {
      this._logger?.error(e, `Error sending message to Kafka - ${e.message}}`);
      throw e;
    });

    if (this._histogram) {
      this._histogram.observe(Number(process.hrtime.bigint() - startTs), {
        [TELEMETRY_PROPS_CALL_NAME_PROP]: 'sendWithoutAcks'
      });
      this._histogram.observe(convertTookNs, {
        [TELEMETRY_PROPS_CALL_NAME_PROP]: 'sendWithoutAcks_convert'
      });
    }
  }

  async send(message: IMessage | IMessage[]): Promise<IMessageProducerAcks[]> {
    const startTs = process.hrtime.bigint();
    const topicMessages = this._convertIMessageArrayToTopicMessages(message);
    const convertTookNs = Number(process.hrtime.bigint() - startTs);

    const acks: KafkaJS.RecordMetadata[] = await this._producer.sendBatch({
      topicMessages
    });

    const resIMessageProducerSendAcks: IMessageProducerAcks[] = acks.map(
      (item) => {
        const sentTopicMsg = topicMessages.find(
          (tm) => tm.topic === item.topicName
        );

        return {
          topic: item.topicName,
          partition: item.partition,
          lastMsgOffset:
            Number(item.baseOffset) +
            (sentTopicMsg ? sentTopicMsg.messages.length : 0)
        };
      }
    );

    if (this._histogram) {
      this._histogram.observe(Number(process.hrtime.bigint() - startTs), {
        [TELEMETRY_PROPS_CALL_NAME_PROP]: 'send'
      });
      this._histogram.observe(convertTookNs, {
        [TELEMETRY_PROPS_CALL_NAME_PROP]: 'send_convert'
      });
    }

    return resIMessageProducerSendAcks;
  }

  async destroy(): Promise<void> {
    this._logger?.info(`${this.constructor.name} - destroy called...`);
    return await this.disconnect();
  }

  async connect(): Promise<void> {
    this._logger?.info(`${this.constructor.name} - connect called...`);
    await this._producer.connect();
  }

  async disconnect(): Promise<void> {
    this._logger?.info(`${this.constructor.name} - disconnect called...`);
    // automatically flushes
    await this._producer.disconnect();
  }
}
