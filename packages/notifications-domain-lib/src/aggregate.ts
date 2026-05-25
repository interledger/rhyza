'use strict';

import { Notification } from './entity';
import {
  INotificationRepository,
  INotificationSenderService
} from './interfaces';

export class NotificationAggregate {
  private _repo: INotificationRepository;
  private _notificationSenderService: INotificationSenderService;

  constructor(
    repo: INotificationRepository,
    notificationSenderService: INotificationSenderService
  ) {
    this._repo = repo;
    this._notificationSenderService = notificationSenderService;
  }

  async createAndSendNotification(
    data: Record<string, unknown>
  ): Promise<string> {
    const id = crypto.randomUUID();
    const notification = new Notification(id, data);
    await this._repo.store(notification.toObject());
    try {
      await this._notificationSenderService.send(notification);
      notification.markAsSent();
      return id;
    } catch (error) {
      notification.markAsFailed();
      throw error;
    } finally {
      await this._repo.store(notification.toObject());
    }
  }
}
