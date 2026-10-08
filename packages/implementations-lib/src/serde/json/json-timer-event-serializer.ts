import { IMessage, MessageTypes } from 'common-types-lib';
import { JsonBaseMessageSerializer } from './json-base-msg-serializer';

export class JsonTimerEventSerializer extends JsonBaseMessageSerializer {
  public msgType: MessageTypes = MessageTypes.TIMER;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unused-vars
  protected _deserializeSpecific(inputObj: any, outputMsg: IMessage): void {}
}
