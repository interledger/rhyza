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

  // TODO: add a type so that we can create different types of notifications (e.g webhook, email, etc)
  // NOT SURE!
  async createNotification(id: string, eventId: string, type: string) {
    let notification;
    switch (type) {
      case 'webhook':
        notification = new Notification(id, eventId);
        break;
      default:
        throw new Error(`Unknown notification type: ${type}`);
    }
    await this._repo.store(notification.toObject());
  }

  async createWebhook(id: string, eventId: string): Promise<void> {
    const notification = new Notification(id, eventId);
    await this._repo.store(notification.toObject());
  }

  async getWebhook(id: string): Promise<Notification | null> {
    const found = await this._repo.fetch(id);
    return found ? Notification.fromObject(found) : null;
  }

  async send(id: string): Promise<NotificationStatus> {
    const notification = await this.getWebhook(id);
    if (!notification) {
      throw new Error(`Notification with id ${id} not found`);
    }
    return await this._notificationSenderService.send(notification);
  }
}
