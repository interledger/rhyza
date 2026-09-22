'use strict';

import { ILogger } from 'common-types-lib';
import { Notification } from './entity';
import {
  INotification,
  INotificationRepository,
  INotificationSenderService,
  NotificationStatus,
  NotificationType
} from './interfaces';

export class NotificationAggregate {
  private _repo: INotificationRepository;
  private _notificationSenderService: INotificationSenderService;
  private _logger: ILogger;

  constructor(
    repo: INotificationRepository,
    notificationSenderService: INotificationSenderService,
    logger: ILogger
  ) {
    this._repo = repo;
    this._notificationSenderService = notificationSenderService;
    this._logger = logger.child('notification-aggregate');
  }

  /**
   * Persist a notification and attempt to deliver it.
   *
   * `id` is the source event id (not generated here) so redeliveries are idempotent.
   */
  async createAndSendNotification(
    id: string,
    type: NotificationType,
    data: Record<string, unknown>
  ): Promise<INotification> {
    const notification = new Notification(id, type, { data });
    return await this.sendNotification(notification);
  }

  private async sendNotification(
    notification: Notification
  ): Promise<INotification> {
    notification.incrementAttempts();
    await this._repo.store(notification.toObject());
    try {
      await this._notificationSenderService.send(notification);
      notification.markAsSent();
    } catch (error) {
      this._logger.error('error sending notification: ', error);
      notification.markAsFailed();
    } finally {
      await this._repo.store(notification.toObject());
    }
    return notification.toObject();
  }

  async retryNotification(id: string): Promise<void> {
    const notification = await this._repo.get(id);
    if (!notification) {
      throw new Error(`Notification not found: ${id}`);
    }
    if (notification.status === NotificationStatus.PENDING_RETRY) {
      const notificationEntity = Notification.fromObject(notification);
      notificationEntity.markAsSending();
      await this.sendNotification(notificationEntity);
    } else {
      this._logger.error(
        `Notification not in PENDING_RETRY state: ${notification.status}`
      );
    }
  }
}
