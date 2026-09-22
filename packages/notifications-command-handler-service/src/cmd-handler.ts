import {
  CommandTopics,
  ILogger,
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
  private _logger: ILogger;

  constructor(
    msgConsumer: IMessageConsumer,
    notificationAggregate: NotificationAggregate,
    logger: ILogger
  ) {
    this._msgConsumer = msgConsumer;
    this._notificationAggregate = notificationAggregate;
    this._logger = logger;
  }

  async start(): Promise<void> {
    this._msgConsumer.setTopics([CommandTopics.NotificationCommands]);
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
            this._logger.info(
              `Notification sent for command ${msg.msgName} — id ${notification.id}`
            );
          } else {
            this._logger.error(
              `Notification NOT sent for command ${msg.msgName} — id ${notification.id}, type ${payload.type}, status ${notification.status}`
            );
          }
          break;
        }
        case RetryNotificationTickCmd.name: {
          const payload = (msg as RetryNotificationTickCmd).payload;
          try {
            await this._notificationAggregate.retryNotification(payload.id);
            this._logger.info(
              `Notification sent for command ${msg.msgName} — id ${payload.id}`
            );
          } catch (err) {
            this._logger.error('error retrying notification: ', err);
          }
          break;
        }
        default: {
          unhandled.push(msg);
          break;
        }
      }
    }

    if (unhandled.length > 0) {
      this._logger.warn(
        `Unhandled Notification command: ${[...new Set(unhandled.map((m) => m.msgName))].join(', ')}`
      );
    }
  }
}
