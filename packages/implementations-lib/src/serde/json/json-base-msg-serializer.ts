import { IMessage, MessageDataFormats } from 'common-types-lib';
import { IRawMessageSerializer } from '../types';

export abstract class JsonBaseMessageSerializer
  implements IRawMessageSerializer
{
  readonly dataFormat: MessageDataFormats = MessageDataFormats.JSON;

  abstract readonly msgType: string;

  protected abstract _deserializeSpecific(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inputObj: any,
    outputMsg: IMessage
  ): void;

  serializeMsg(msg: IMessage): Uint8Array {
    const str = JSON.stringify(msg);
    return Buffer.from(str);
  }

  deserializeMsg(msgBytes: Uint8Array): IMessage {
    const str = msgBytes.toString();
    const msgObj = JSON.parse(str);

    const evt: IMessage = {
      msgDataFormat: MessageDataFormats.JSON,
      msgType: msgObj.msgType ? msgObj.msgType : null,
      msgId: msgObj.msgId ? msgObj.msgId : null,
      msgTimestamp: parseInt(msgObj.msgTimestamp),
      msgName: msgObj.msgName,
      msgBatchId: msgObj.msgBatchId ? msgObj.msgBatchId : null,

      /* These four might be empty here, but are going to be
        updated by the top level deserializer from the kafka data */
      msgKey: msgObj.msgKey ? msgObj.msgKey : null,
      msgTopic: msgObj.msgTopic ? msgObj.msgTopic : null,
      msgPartition:
        msgObj.msgPartition != undefined ? msgObj.msgPartition : null,
      msgOffset: msgObj.msgOffset != undefined ? msgObj.msgOffset : null,

      payload: msgObj.payload,

      tracingInfo: msgObj.tracingInfo ? msgObj.tracingInfo : null,
      requestId: msgObj.requestId ? msgObj.requestId : null
    };

    this._deserializeSpecific(msgObj, evt);

    return evt;
  }
}
