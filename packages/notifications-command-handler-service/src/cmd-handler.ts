import {
  CommandTopics,
  DomainRetryTopics,
  IMessage,
  IMessageConsumer
} from 'common-types-lib';
import {
  CreateNotificationCmd,
  NotificationAggregate,
  NotificationStatus,
  RetryNotificationTickCmd
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
    this._msgConsumer.setTopics([
      CommandTopics.NotificationCommands,
      DomainRetryTopics.NotificationRetryCommands
    ]);
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
          const payload = (msg as CreateNotificationCmd).payload;
          const notification =
            await this._notificationAggregate.createAndSendNotification(
              payload.id,
              payload.type,
              payload.data
            );
          if (notification.status === NotificationStatus.SENT) {
            console.log(
              `Notification sent for command ${msg.msgName} — id ${notification.id} (${notification.attempts} attempt(s))`
            );
          } else {
            console.error(
              `Notification NOT sent for command ${msg.msgName} — id ${notification.id}, type ${payload.type}, status ${notification.status} after ${notification.attempts} attempt(s). Skipping to avoid blocking the partition.`
            );
          }
          break;
        }
        case RetryNotificationTickCmd.name: {
          const payload = (msg as RetryNotificationTickCmd).payload;
          await this._notificationAggregate.retryNotification(payload.id);
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
