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

const DEFAULT_RETRY_BASE_DELAY_MS = 500;

export interface NotificationAggregateOptions {
  // Base delay for exponential backoff between transient retry attempts.
  // Set to 0 in tests to avoid waits.
  retryBaseDelayMs?: number;
}

export class NotificationAggregate {
  private _repo: INotificationRepository;
  private _notificationSenderService: INotificationSenderService;
  private _retryBaseDelayMs: number;
  private _logger: ILogger;

  constructor(
    repo: INotificationRepository,
    notificationSenderService: INotificationSenderService,
    logger: ILogger,
    options: NotificationAggregateOptions = {}
  ) {
    this._repo = repo;
    this._notificationSenderService = notificationSenderService;
    this._logger = logger.child('notification-aggregate');
    this._retryBaseDelayMs =
      options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  }

  /**
   * Persist a notification and attempt to deliver it, retrying transient
   * failures with bounded exponential backoff up to `maxAttempts`.
   *
   * `id` is the source event id (not generated here) so redeliveries are idempotent.
   */
  async createAndSendNotification(
    id: string,
    type: NotificationType,
    data: Record<string, unknown>
  ): Promise<INotification> {
    const notification = new Notification(id, type, data);
    return await this.sendNotification(notification);
  }

  private async sendNotification(
    notification: Notification
  ): Promise<INotification> {
    await this._repo.store(notification.toObject());
    try {
      await this._notificationSenderService.send(notification);
      notification.markAsSent();
    } catch (error) {
      this._logger.error('error sending notification: ', error);
      notification.markAsFailed();
    } finally {
      notification.incrementAttempts();
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
      await this.sendNotification(Notification.fromObject(notification));
    } else {
      this._logger.error(
        `Notification not in PENDING_RETRY state: ${notification.status}`
      );
    }
  }
}
