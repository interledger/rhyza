import {
  IMessage,
  IRawMessage,
  IRawMessageHeader,
  IRawMessageSerializerFactory,
  MessageDataFormats,
  MissingSerializerError
} from 'common-types-lib';
import {
  IRawMessageSerializer,
  MSG_HEADER_MSG_DATA_FORMAT,
  MSG_HEADER_MSG_NAME,
  MSG_HEADER_MSG_TYPE
} from './types';
import { JsonCommandSerializer } from './json/json-command-serializer';
import { JsonDomainEventSerializer } from './json/json-domain-event-serializer';
import { JsonSnapshotSerializer } from './json/json-snapshot-serializer';
import { JsonStateEventSerializer } from './json/json-state-event-serializer';

export class MessageSerializationFactory implements IRawMessageSerializerFactory {
  private static _instance: MessageSerializationFactory | null = null;
  private _serializers: IRawMessageSerializer[];

  private constructor() {
    this._serializers = [];

    // automatically register the JSON serdes
    this.register(new JsonCommandSerializer());
    this.register(new JsonDomainEventSerializer());
    this.register(new JsonStateEventSerializer());
    this.register(new JsonSnapshotSerializer());
  }

  static instance(): MessageSerializationFactory {
    if (!this._instance) {
      this._instance = new MessageSerializationFactory();
    }
    return this._instance;
  }

  private _getSerializer(
    dataFormat: string,
    msgType: string,
    msgName?: string
  ): IRawMessageSerializer | null {
    // find by type if JSON or by format and name if not
    const existing = this._serializers.find(
      (s) =>
        (dataFormat === MessageDataFormats.JSON && msgType === s.msgType) ||
        (dataFormat !== MessageDataFormats.JSON &&
          s.dataFormat === dataFormat &&
          s.msgName === msgName)
    );

    return existing || null;
  }

  private _getHeaderValue(
    headers: IRawMessageHeader[],
    name: string
  ): string | null {
    const header = headers.find((value) => value[name]);
    return header ? header[name].toString() : null;
  }

  register(newSerde: IRawMessageSerializer): this {
    if (newSerde.dataFormat !== MessageDataFormats.JSON && !newSerde.msgName) {
      throw new Error('Non-JSON serializer must have a msgName');
    }

    // find by type if JSON or by format and name if not
    const existing = this._getSerializer(
      newSerde.dataFormat,
      newSerde.msgType,
      newSerde?.msgName
    );

    if (existing) {
      throw new Error(
        `Serializer already exists for dataFormat: ${newSerde.dataFormat}, type: ${newSerde.msgType} and msg: ${newSerde.msgName}`
      );
    }
    this._serializers.push(newSerde);

    return this;
  }

  serialize(msg: IMessage): IRawMessage {
    const serializer = this._getSerializer(
      msg.msgDataFormat,
      msg.msgType,
      msg.msgName
    );
    if (!serializer) {
      throw new MissingSerializerError(
        `No serializer found for dataFormat: ${msg.msgDataFormat}, type: ${msg.msgType} and message: ${msg.msgName}`
      );
    }

    const payloadData = serializer.serializeMsg(msg);

    const headers: IRawMessageHeader[] = [
      { [MSG_HEADER_MSG_TYPE]: msg.msgType },
      { [MSG_HEADER_MSG_NAME]: msg.msgName },
      { [MSG_HEADER_MSG_DATA_FORMAT]: msg.msgDataFormat }
    ];

    const rawMsg: IRawMessage = {
      topic: msg.msgTopic,
      key: msg.msgKey,
      timestamp: msg.msgTimestamp,
      value: payloadData,
      offset: msg.msgOffset,
      partition: msg.msgPartition,
      headers: headers
    };

    return rawMsg;
  }

  deserialize(rawMsg: IRawMessage): IMessage {
    if (!rawMsg.headers) {
      throw new Error('Invalid message, missing headers');
    }
    const msgFormat = this._getHeaderValue(
      rawMsg.headers,
      MSG_HEADER_MSG_DATA_FORMAT
    );
    const msgType = this._getHeaderValue(rawMsg.headers, MSG_HEADER_MSG_TYPE);
    const msgName = this._getHeaderValue(rawMsg.headers, MSG_HEADER_MSG_NAME);

    if (!msgFormat || !msgType || !msgName) {
      throw new Error(
        'Invalid message, missing one or more of msgFormat, msgType or msgName'
      );
    }

    const serializer = this._getSerializer(msgFormat, msgType, msgName);
    if (!serializer) {
      throw new MissingSerializerError(
        `No serializer found for dataFormat: ${msgFormat}, msgType: ${msgType} and message: ${msgName}`
      );
    }

    const msg = serializer.deserializeMsg(rawMsg.value as Uint8Array);

    // put back common stuff the specialized serializer can't know of
    msg.msgPartition = rawMsg.partition;
    msg.msgOffset = rawMsg.offset;
    msg.msgTopic = rawMsg.topic;
    msg.msgKey = rawMsg.key ? rawMsg.key.toString() : null;

    return msg;
  }
}
