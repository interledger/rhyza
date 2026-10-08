import {
  IMessage,
  IMessageProducer,
  IMessageProducerAcks,
  MessageTypes,
  StateEvent
} from 'common-types-lib';

export class MockMessageProducer implements IMessageProducer {
  private _messages: IMessage[] = [];

  constructor(mockMessageStore: IMessage[]) {
    this._messages = mockMessageStore;
  }

  get messages(): IMessage[] {
    return this._messages;
  }

  destroy(): Promise<void> {
    throw new Error('Method not implemented.');
  }
  connect(): Promise<void> {
    throw new Error('Method not implemented.');
  }
  disconnect(): Promise<void> {
    throw new Error('Method not implemented.');
  }
  send(message: IMessage[]): Promise<IMessageProducerAcks[]> {
    if (!Array.isArray(message)) {
      message = [message];
    }
    if (message.length === 0 || !message[0]) {
      return Promise.resolve([]);
    }
    this._messages.push(...message);
    return Promise.resolve([
      { topic: message[0].msgTopic, lastMsgOffset: 0, partition: 0 }
    ]);
  }

  sendWithoutAcks(events: IMessage[]): Promise<void> {
    this._messages.push(...events);
    return Promise.resolve();
  }

  fetchStateEvents(aggId: string): Promise<StateEvent[]> {
    const filtered = this._messages.filter(
      (e) => e.msgType === MessageTypes.STATE_EVENT && e.msgKey === aggId
    );
    return Promise.resolve(filtered as StateEvent[]);
  }
}
