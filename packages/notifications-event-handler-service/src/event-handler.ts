import {
  DomainEventTopics,
  IMessage,
  IMessageConsumer,
  IMessageProducer
} from 'common-types-lib';
import { CreateNotificationCmd } from 'notifications-domain-lib';

export class NotificationsEventHandler {
  private _msgConsumer: IMessageConsumer;
  private _msgProducer: IMessageProducer;

  constructor(msgConsumer: IMessageConsumer, msgProducer: IMessageProducer) {
    this._msgConsumer = msgConsumer;
    this._msgProducer = msgProducer;
  }

  async start(): Promise<void> {
    this._msgConsumer.setTopics([DomainEventTopics.PaymentEvents]);
    this._msgConsumer.setBatchCallbackFn(async (messages: IMessage[]) => {
      for (const message of messages) {
        await this._handleEvent(message);
      }
    });
    await this._msgConsumer.connect();
  }

  async stop(): Promise<void> {
    await this._msgConsumer.stop();
    await this._msgConsumer.disconnect(true);
  }

  private async _handleEvent(message: IMessage) {
    const cmd = new CreateNotificationCmd(message.payload, message.requestId);
    await this._msgProducer.send(cmd);
  }
}
