import { IMessage, MessageDataFormats } from 'common-types-lib';
import { IRawMessageSerializer } from '../types';
import { Any as PbAny } from 'google-protobuf/google/protobuf/any_pb';

export abstract class ProtoBufBaseMessageSerializer
  implements IRawMessageSerializer
{
  readonly dataFormat: MessageDataFormats = MessageDataFormats.PROTOBUF;

  protected abstract readonly _payloadPbClassName: string;

  abstract readonly msgType: string;
  abstract readonly msgName: string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected abstract _serializePayload(payload: any): Uint8Array;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected abstract _deserializePayload(pbAny: PbAny, msgName: string): any;

  abstract serializeMsg(msg: IMessage): Uint8Array;
  abstract deserializeMsg(msgBytes: Uint8Array): IMessage;
}
