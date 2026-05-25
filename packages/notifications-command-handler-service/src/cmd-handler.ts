import { CommandTopics, IMessage, IMessageConsumer } from 'common-types-lib';
import {
  CreateNotificationCmd,
  NotificationAggregate
} from 'notifications-domain-lib';

export class NotificationsCommandHandler {
  private _msgConsumer: IMessageConsumer;
  private _notificationAggregate: NotificationAggregate;

  constructor(
    msgConsumer: IMessageConsumer,
    notificationAggregate: NotificationAggregate
  ) {
    this._msgConsumer = msgConsumer;
    this._notificationAggregate = notificationAggregate;
  }

  async start(): Promise<void> {
    this._msgConsumer.setTopics([CommandTopics.PaymentCommands]);
    this._msgConsumer.setBatchCallbackFn(this._handleBatch.bind(this));
    await this._msgConsumer.connect();
    await this._msgConsumer.startAndWaitForRebalance();
  }

  async stop(): Promise<void> {
    await this._msgConsumer.stop();
    await this._msgConsumer.disconnect(true);
  }

  private async _handleBatch(messages: IMessage[]): Promise<void> {
    const unhandled: IMessage[] = [];

    for (const msg of messages) {
      switch (msg.msgName) {
        case CreateNotificationCmd.name: {
          await this._notificationAggregate.createAndSendNotification(
            (msg as CreateNotificationCmd).payload.data
          );
          break;
        }
        default: {
          unhandled.push(msg);
          break;
        }
      }
    }

    if (unhandled.length > 0) {
      console.warn(
        `Unhandled Notification command: ${[...new Set(unhandled.map((m) => m.msgName))].join(', ')}`
      );
    }
  }
}
