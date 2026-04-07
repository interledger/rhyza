'use strict';

import { Notification } from './entity';
import {
  INotificationRepository,
  INotificationSenderService,
  NotificationStatus
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

  async createAndSendNotification(id: string): Promise<void> {
    const notification = new Notification(id);
    await this._repo.store(notification.toObject());
    try {
      await this._notificationSenderService.send(notification);
      notification.status = NotificationStatus.SENT;
      notification.sentAt = new Date();
    } catch (error) {
      notification.status = NotificationStatus.FAILED;
      throw error;
    } finally {
      await this._repo.store(notification.toObject());
    }
  }

  async getNotification(id: string): Promise<Notification | null> {
    const found = await this._repo.fetch(id);
    return found ? Notification.fromObject(found) : null;
  }
}
