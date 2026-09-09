import {
  DomainEventTopics,
  IMessage,
  IMessageConsumer,
  IMessageProducer
} from 'common-types-lib';
import {
  CreateNotificationCmd,
  NotificationType
} from 'notifications-domain-lib';
import {
  PaymentCompletedEvent,
  PaymentCompleteFailedEvent,
  PaymentCreatedEvent,
  PaymentIntentCompletedEvent,
  PaymentIntentCreatedEvent
} from 'payments-public-types-lib';

export class IntegrationEventHandler {
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
    await this._msgConsumer.startAndWaitForRebalance();
  }

  async stop(): Promise<void> {
    await this._msgConsumer.stop();
    await this._msgConsumer.disconnect(true);
  }

  private readonly messageToNotificationType: Record<string, NotificationType> =
    {
      [PaymentIntentCreatedEvent.name]: NotificationType.PaymentIntentCreated,
      [PaymentIntentCompletedEvent.name]:
        NotificationType.PaymentIntentCompleted,
      [PaymentCreatedEvent.name]: NotificationType.PaymentCreated,
      [PaymentCompletedEvent.name]: NotificationType.PaymentCompleted,
      [PaymentCompleteFailedEvent.name]: NotificationType.PaymentFailed
    };

  private async _handleEvent(message: IMessage) {
    const type = this.messageToNotificationType[message.msgName];

    if (!type) {
      console.warn(`Unhandled message: ${message.msgName}`);
      return;
    }

    await this.handleNotificationMessage(message, type);
  }

  private async handleNotificationMessage(
    message: IMessage,
    type: NotificationType
  ) {
    console.log(`${message.msgName} received with id ${message.msgId}`);
    const cmd = new CreateNotificationCmd(
      { id: message.msgId, type, data: message.payload },
      message.requestId
    );
    await this._msgProducer.send(cmd);
  }
}
